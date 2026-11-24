#!/usr/bin/env python3
"""Offline, resumable corpus/context collection. Never executes recorded commands."""
import argparse
import bisect
import functools
import collections
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
INPUT_KINDS = {'assignment', 'agent_message', 'followup_assignment',
               'cached_agent_message', 'agent_delivery'}
MAX_TEXT = 24000
MAX_FILE = 65536
MAX_SCAN = 128 * 1024 * 1024
MAX_RECORDS = 12
VERSION = 'context-collector-1'


def js(x):
    return json.dumps(x, ensure_ascii=False, sort_keys=True)


def digest(x):
    return hashlib.sha256(x.encode() if isinstance(x, str) else x).hexdigest()


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def timestamp(value):
    try:
        if isinstance(value,(int,float)):
            return datetime.datetime.fromtimestamp(value/1000,datetime.timezone.utc)
        result = datetime.datetime.fromisoformat(value.replace('Z','+00:00'))
        return result if result.tzinfo else None
    except (ValueError,TypeError,AttributeError,OverflowError):
        return None


def checksum(p):
    h = hashlib.sha256()
    with Path(p).open('rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''):
            h.update(b)
    return h.hexdigest()


def ro(p):
    d = sqlite3.connect('file:' + quote(str(Path(p).resolve())) + '?mode=ro', uri=True)
    d.row_factory = sqlite3.Row
    d.execute('PRAGMA query_only=ON')
    return d


def connect(p):
    p = Path(p)
    p.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(p.parent, 0o700)
    d = sqlite3.connect(p)
    os.chmod(p, 0o600)
    d.row_factory = sqlite3.Row
    d.execute('PRAGMA foreign_keys=ON')
    version = d.execute('PRAGMA user_version').fetchone()[0]
    if version not in (0,1):
        raise ValueError('Unsupported database schema version')
    d.execute('PRAGMA user_version=1')
    d.executescript('''
    CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS source_files(path TEXT PRIMARY KEY, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, purpose TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages(message_id TEXT PRIMARY KEY, text TEXT NOT NULL, characters INTEGER NOT NULL, words INTEGER NOT NULL, kinds TEXT NOT NULL, projects TEXT NOT NULL, is_input INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS observations(observation_id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages, export_line INTEGER UNIQUE NOT NULL, source TEXT NOT NULL, record_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS contexts(context_id TEXT PRIMARY KEY, observation_id TEXT UNIQUE NOT NULL REFERENCES observations, message_id TEXT NOT NULL REFERENCES messages, status TEXT NOT NULL CHECK(status IN ('pending','partial','recovered','unavailable')), metadata_json TEXT NOT NULL, UNIQUE(context_id,message_id));
    CREATE TABLE IF NOT EXISTS evidence(evidence_id TEXT PRIMARY KEY, kind TEXT NOT NULL, text TEXT NOT NULL, provenance TEXT NOT NULL, visibility TEXT NOT NULL CHECK(visibility IN ('sender_context','recipient_visible','unknown')));
    CREATE TABLE IF NOT EXISTS context_evidence(context_id TEXT NOT NULL REFERENCES contexts, evidence_id TEXT NOT NULL REFERENCES evidence, PRIMARY KEY(context_id,evidence_id));
    CREATE TABLE IF NOT EXISTS context_references(reference_id TEXT PRIMARY KEY, context_id TEXT NOT NULL REFERENCES contexts, record_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS historical_reviews(id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages, source_path TEXT NOT NULL, record_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS splits(message_id TEXT PRIMARY KEY REFERENCES messages, record_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS corpus_gaps(line INTEGER PRIMARY KEY, record_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS review_runs(run_id TEXT PRIMARY KEY, rubric_version TEXT NOT NULL, reviewer TEXT NOT NULL, created_at TEXT NOT NULL, metadata_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reviews(review_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES review_runs, context_id TEXT NOT NULL, message_id TEXT NOT NULL, record_json TEXT NOT NULL, FOREIGN KEY(context_id,message_id) REFERENCES contexts(context_id,message_id));
    CREATE TABLE IF NOT EXISTS mechanical_runs(run_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, metadata_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS mechanical_results(run_id TEXT NOT NULL REFERENCES mechanical_runs, message_id TEXT NOT NULL REFERENCES messages, result_json TEXT NOT NULL, PRIMARY KEY(run_id,message_id));
    CREATE INDEX IF NOT EXISTS mechanics_message ON mechanical_results(message_id);
    CREATE INDEX IF NOT EXISTS obs_message ON observations(message_id);
    CREATE INDEX IF NOT EXISTS ctx_message ON contexts(message_id);
    CREATE INDEX IF NOT EXISTS ctx_status ON contexts(status);
    CREATE INDEX IF NOT EXISTS history_message ON historical_reviews(message_id);
    CREATE INDEX IF NOT EXISTS review_context ON reviews(context_id);
    CREATE INDEX IF NOT EXISTS ref_context ON context_references(context_id);
    CREATE TABLE IF NOT EXISTS archived_blobs(sha256 TEXT PRIMARY KEY, bytes INTEGER NOT NULL, compressed BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS archived_files(path TEXT PRIMARY KEY, sha256 TEXT NOT NULL REFERENCES archived_blobs, category TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS analysis_runs(run_id TEXT PRIMARY KEY, kind TEXT NOT NULL, created_at TEXT NOT NULL, metadata_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS analysis_records(run_id TEXT NOT NULL REFERENCES analysis_runs, kind TEXT NOT NULL, record_key TEXT NOT NULL, message_id TEXT REFERENCES messages, record_json TEXT NOT NULL, PRIMARY KEY(run_id,kind,record_key));
    CREATE INDEX IF NOT EXISTS analysis_message ON analysis_records(message_id);
    CREATE VIEW IF NOT EXISTS input_contexts AS SELECT c.*,o.source,o.record_json AS observation_json FROM contexts c JOIN messages m USING(message_id) JOIN observations o USING(observation_id) WHERE m.is_input=1;
    ''')
    return d


def bind_file(db, p, purpose):
    p = Path(p)
    value = checksum(p)
    old = db.execute('SELECT sha256 FROM source_files WHERE path=?', (str(p),)).fetchone()
    if old and old[0] != value:
        raise ValueError('Source changed; use a fresh DB to preserve checksum binding: ' + str(p))
    db.execute('INSERT OR IGNORE INTO source_files VALUES(?,?,?,?)', (str(p), value, p.stat().st_size, purpose))
    from research_store import archive
    archive(db,p,purpose)
    return value


def lines(p):
    with Path(p).open() as f:
        for n, l in enumerate(f, 1):
            if l.strip():
                yield n, json.loads(l)


def import_corpus(db, directory):
    directory = Path(directory).resolve()
    manifest = json.loads((directory / 'manifest.json').read_text())
    for name, value in manifest['files'].items():
        if bind_file(db, directory / name, 'exact corpus export') != value['sha256']:
            raise ValueError('Manifest checksum mismatch: ' + name)
    bind_file(db, directory / 'manifest.json', 'manifest')
    db.execute('INSERT OR IGNORE INTO metadata VALUES(?,?)', ('manifest', js(manifest)))
    db.execute('INSERT OR IGNORE INTO metadata VALUES(?,?)', ('collector_version', VERSION))
    for _, r in lines(directory / 'messages.jsonl'):
        if digest(r['text']) != r['message_id']:
            raise ValueError('Body hash mismatch')
        db.execute('INSERT OR IGNORE INTO messages VALUES(?,?,?,?,?,?,?)',
                   (r['message_id'], r['text'], r['characters'], r['words'], js(r['kinds']), js(r['projects']), bool(INPUT_KINDS.intersection(r['kinds']))))
    for n, r in lines(directory / 'observations.jsonl'):
        oid = digest(str(n) + ':' + js(r))
        db.execute('INSERT OR IGNORE INTO observations VALUES(?,?,?,?,?)', (oid, r['message_id'], n, r['source'], js(r)))
        db.execute('INSERT OR IGNORE INTO contexts VALUES(?,?,?,?,?)', ('ctx-' + oid, oid, r['message_id'], 'pending', '{}'))
    label_paths = [directory / 'labels.jsonl', directory / 'triage-20261123/labels-full.jsonl',
                   directory / 'triage-sol-20261123/labels-sol.jsonl', directory / 'triage-sol-20261123/labels-reconciled.jsonl']
    for p in label_paths:
        if not p.exists():
            continue
        bind_file(db, p, 'historical review ledger')
        for n, r in lines(p):
            db.execute('INSERT OR IGNORE INTO historical_reviews VALUES(?,?,?,?)', (digest(str(p) + ':' + str(n)), r['message_id'], str(p), js(r)))
    p = directory / 'split.jsonl'
    if p.exists():
        bind_file(db, p, 'frozen split')
        for _, r in lines(p):
            db.execute('INSERT OR IGNORE INTO splits VALUES(?,?)', (r['message_id'], js(r)))
    p = directory / 'gaps.jsonl'
    if p.exists():
        for n, r in lines(p):
            db.execute('INSERT OR IGNORE INTO corpus_gaps VALUES(?,?)', (n, js(r)))
    db.commit()


def add_evidence(db, cid, kind, text, provenance, visibility='sender_context'):
    if not isinstance(text, str) or not text:
        return
    provenance = {**provenance, 'original_characters': len(text), 'omitted_characters': max(0, len(text)-MAX_TEXT)}
    text = text[:MAX_TEXT]
    eid = 'ev-' + digest(js([kind, text, provenance, visibility]))
    db.execute('INSERT OR IGNORE INTO evidence VALUES(?,?,?,?,?)', (eid, kind, text, js(provenance), visibility))
    db.execute('INSERT OR IGNORE INTO context_evidence VALUES(?,?)', (cid, eid))


def text_of(p):
    if isinstance(p, str):
        return p
    if not isinstance(p, dict):
        return ''
    for key in ['text', 'message', 'prompt', 'output', 'arguments', 'input', 'result', 'aggregatedOutput', 'command']:
        if isinstance(p.get(key), str):
            return p[key]
    if any(k in p for k in ('arguments', 'input', 'result', 'command', 'aggregatedOutput')):
        return js({k:p[k] for k in ('type','toolName','tool','name','arguments','input','result','command','aggregatedOutput','error') if k in p})
    content = p.get('content')
    if isinstance(content, list):
        return '\n'.join(x.get('text', '') for x in content if isinstance(x, dict) and isinstance(x.get('text'), str))
    return ''


class Recovery:
    def __init__(self, db):
        self.db = db
        self.rollouts = {}
        self.connections = {}
        self.repo_cache = {}
        self.ref_cache = {}
        self.session_cache = {}
        self.native_paths = {}
        self.t3_native = {}
        self.source_map_gaps = []
        try:
            state = ro(Path.home()/'.codex/state_5.sqlite')
            self.native_paths = dict(state.execute('SELECT id,rollout_path FROM threads'))
            state.close()
        except (sqlite3.Error,OSError):
            self.source_map_gaps.append('Codex state mapping unavailable')
        try:
            t3 = ro(Path.home()/'.t3/userdata/statev2.sqlite')
            for tid,raw in t3.execute('SELECT thread_id,payload_json FROM orchestration_v2_projection_provider_threads'):
                native = (json.loads(raw).get('nativeThreadRef') or {}).get('nativeId')
                if native:
                    self.t3_native.setdefault(tid,[]).append(native)
            t3.close()
        except (sqlite3.Error,OSError):
            self.source_map_gaps.append('T3 native-thread mapping unavailable')

    def session_metadata(self, o):
        mapped = set(self.t3_native.get(o.get('thread_id'),[]))
        if not o.get('native_thread_id') and not o.get('original_rollout') and len(mapped)>1:
            return {'mapping_candidates':len(mapped),'gap':'multiple recorded provider sessions; observation does not identify one'}
        candidates = []
        if o.get('original_rollout'):
            candidates.append(o['original_rollout'])
        ids = [o.get('native_thread_id'), *self.t3_native.get(o.get('thread_id'),[])]
        candidates.extend(self.native_paths[n] for n in ids if n in self.native_paths)
        found = []
        for path in dict.fromkeys(candidates):
            if path not in self.session_cache:
                result = {}
                try:
                    with Path(path).open('rb') as f:
                        # session_meta is normally the first record; cap lookup to 1 MiB.
                        prefix = f.read(1024*1024)
                    for raw in prefix.splitlines()[:32]:
                        r = json.loads(raw)
                        if r.get('type') == 'session_meta':
                            pld = r.get('payload') or {}
                            result = {k:pld.get(k) for k in ('id','cwd','git','source','originator','timestamp')}
                            result['timestamp'] = pld.get('timestamp') or r.get('timestamp')
                            result['provenance'] = {'path':path,'record_sha256':digest(raw),'lookup':'first 32 lines within 1 MiB; state/provider mapping is a locator only'}
                            break
                except (OSError,ValueError):
                    pass
                self.session_cache[path] = result
            if self.session_cache[path]:
                candidate = self.session_cache[path]
                started = timestamp(candidate.get('timestamp'))
                observed = timestamp(o.get('timestamp') or o.get('timestamp_ms'))
                # Current mappings locate files; they cannot move a later
                # session's revision backwards onto an earlier observation.
                if started and observed and started > observed:
                    continue
                if not o.get('native_thread_id') and not o.get('original_rollout') and not (started and observed):
                    continue
                found.append(candidate)
        # Multiple provider sessions cannot honestly supply one historical revision.
        return found[0] if len(found)==1 else {'mapping_candidates':len(found), 'gap':'no unique recorded session metadata'}


    @functools.lru_cache(maxsize=8)
    def t3_tools(self, path, tid):
        # Parse each thread's startedAt values once, rather than rescanning large
        # JSON payloads for each observed handoff. Keep a bounded thread cache.
        rows = self.database(path).execute("SELECT json_extract(payload_json,'$.startedAt'),turn_item_id FROM orchestration_v2_projection_turn_items WHERE thread_id=? AND json_extract(payload_json,'$.startedAt') IS NOT NULL ORDER BY json_extract(payload_json,'$.startedAt') DESC LIMIT 20001", (tid,)).fetchall()
        return sorted((r[0],r[1]) for r in rows[:20000] if isinstance(r[0],str)), len(rows)>20000

    def database(self, p):
        if p not in self.connections:
            self.connections[p] = ro(p)
        return self.connections[p]

    def rollout(self, p, targets):
        # One bounded streaming pass per file. Store selected preceding records per target only.
        selected = {}
        recent = collections.deque(maxlen=MAX_RECORDS)
        assignment = None
        latest_user = None
        meta = {}
        instructions = None
        session_instructions = []
        developer_instructions = collections.deque(maxlen=8)
        errors = []
        scanned = 0
        h = hashlib.sha256()
        with Path(p).open('rb') as f:
            initial_size = os.fstat(f.fileno()).st_size
            n = 0
            while scanned < min(initial_size, MAX_SCAN):
                raw = f.readline(min(initial_size, MAX_SCAN)-scanned)
                if not raw:
                    break
                n += 1
                scanned += len(raw)
                h.update(raw)
                if n in targets:
                    selected[n] = (list({(a[0],a[1]): a for a in [*session_instructions, *developer_instructions, assignment, latest_user, instructions, *recent] if a}.values()), dict(meta))
                try:
                    r = json.loads(raw)
                except (ValueError, UnicodeDecodeError):
                    errors.append(n)
                    continue
                pld = r.get('payload') or {}
                if not isinstance(pld, dict):
                    continue
                if r.get('type') == 'session_meta':
                    meta = {k: pld.get(k) for k in ['id','cwd','git','source','originator']}
                    for key in ['base_instructions','developer_instructions']:
                        value = pld.get(key)
                        if isinstance(value, dict):
                            value = value.get('text')
                        if isinstance(value, str):
                            session_instructions.append((n, 'recorded_' + key, value, digest(raw)))
                if r.get('type') == 'turn_context':
                    # Capture recorded turn settings/instructions, never current configuration.
                    instructions = (n, 'recorded_turn_context', js(pld), digest(raw))
                txt = text_of(pld)
                if not txt:
                    continue
                kind = pld.get('role') or pld.get('type') or r.get('type')
                if kind in ('developer','system') and r.get('type') == 'response_item':
                    developer_instructions.append((n, 'recorded_' + kind + '_instructions', txt, digest(raw)))
                if kind == 'user':
                    latest_user = (n, 'preceding_user', txt, digest(raw))
                    if assignment is None:
                        assignment = (n, 'first_recorded_user', txt, digest(raw))
                if r.get('type') == 'response_item' and kind in ('user','assistant','function_call','function_call_output','custom_tool_call','custom_tool_call_output'):
                    recent.append((n, 'preceding_' + kind, txt, digest(raw)))
        binding = {'path': str(p), 'prefix_sha256': h.hexdigest(), 'bytes_scanned': scanned,
                   'initial_bytes': initial_size, 'omitted_bytes': max(0, initial_size-scanned),
                   'parse_error_lines': errors[:100], 'parse_error_count': len(errors),
                   'selection': 'session base/developer instructions, last 8 developer/system response items, first recorded user, latest preceding user, latest turn context, last 12 text response items; older items omitted and prior unrelated turns may occur'}
        return selected, binding

    def recover_group(self, rows):
        obs = [json.loads(r['record_json']) for r in rows]
        path = obs[0]['locator']
        source = obs[0]['source']
        roll = {}
        binding = {}
        failure = None
        if source == 'codex_rollout':
            try:
                roll, binding = self.rollout(path, {o['line'] for o in obs})
            except OSError as e:
                failure = type(e).__name__
        for row, o in zip(rows, obs):
            cid = row['context_id']
            gaps = []
            meta = self.session_metadata(o) if source != 'codex_rollout' else {}
            binding = {} if source != 'codex_rollout' else binding
            records = []
            if source == 'codex_rollout':
                entries, meta = roll.get(o.get('line'), ([], {}))
                if o.get('line') not in roll:
                    gaps.append({'reason': 'rollout_unavailable_or_target_outside_scan', 'error': failure})
                for n, kind, txt, raw_hash in entries:
                    add_evidence(self.db, cid, kind, txt, {**binding, 'line': n, 'record_sha256': raw_hash})
                gaps.append({'reason': 'bounded_preceding_selection', **binding})
            elif source in ('t3_messages','t3_turn_items','t3_subagents','codex_history'):
                try:
                    d = self.database(path)
                    if source == 'codex_history':
                        tid = o.get('native_thread_id')
                        anchor = d.execute('SELECT rollout_ordinal,item_json FROM thread_items WHERE thread_id=? AND item_id=? ORDER BY rollout_ordinal LIMIT 1', (tid, o.get('item_id'))).fetchone()
                        if anchor:
                            records = [(r['item_id'], r['item_json']) for r in d.execute('SELECT item_id,item_json FROM thread_items WHERE thread_id=? AND rollout_ordinal<? ORDER BY rollout_ordinal DESC LIMIT ?', (tid, anchor[0], MAX_RECORDS))]
                            first = d.execute("SELECT item_id,item_json FROM thread_items WHERE thread_id=? AND item_type='userMessage' AND rollout_ordinal<? ORDER BY rollout_ordinal LIMIT 1", (tid, anchor[0])).fetchone()
                            if first:
                                records.append(tuple(first))
                            binding = {'database': path, 'anchor_sha256': digest(anchor[1]), 'anchor_ordinal': anchor[0]}
                        else:
                            gaps.append({'reason': 'history_anchor_missing'})
                    else:
                        tid = o.get('thread_id')
                        stamp = o.get('timestamp')
                        table, idcol = {'t3_messages': ('orchestration_v2_projection_messages','message_id'), 't3_turn_items': ('orchestration_v2_projection_turn_items','turn_item_id'), 't3_subagents': ('orchestration_v2_projection_subagents','subagent_id')}[source]
                        anchor = d.execute(f'SELECT payload_json FROM {table} WHERE {idcol}=?', (o.get('item_id'),)).fetchone()
                        binding = {'database': path, 'anchor_sha256': digest(anchor[0]) if anchor else None}
                        if not anchor:
                            gaps.append({'reason': 't3_anchor_missing'})
                        if stamp:
                            records = [(r[0],r[1]) for r in d.execute('SELECT message_id,payload_json FROM orchestration_v2_projection_messages WHERE thread_id=? AND created_at<? ORDER BY created_at DESC LIMIT ?', (tid, stamp, MAX_RECORDS))]
                            first = d.execute("SELECT message_id,payload_json FROM orchestration_v2_projection_messages WHERE thread_id=? AND role='user' AND created_at<? ORDER BY created_at LIMIT 1", (tid, stamp)).fetchone()
                            if first:
                                records.append(tuple(first))
                            # Tool evidence ordered by recorded startedAt, not a current project projection.
                            tools, tool_cap_hit = self.t3_tools(path, tid)
                            end = bisect.bisect_left(tools, (stamp,))
                            for _, iid in tools[max(0,end-4):end]:
                                r = d.execute('SELECT turn_item_id,payload_json FROM orchestration_v2_projection_turn_items WHERE turn_item_id=?', (iid,)).fetchone()
                                if r:
                                    records.append(tuple(r))
                            if tool_cap_hit:
                                gaps.append({'reason':'tool_index_cap', 'most_recent_tool_records_retained':20000,'older_records_omitted':True})
                        else:
                            gaps.append({'reason': 'historical_timestamp_unavailable_no_preceding_order_assumed'})
                    for iid, raw in records:
                        pld = json.loads(raw)
                        txt = text_of(pld)
                        if txt:
                            visibility = 'unknown' if source == 't3_messages' else 'sender_context'
                            add_evidence(self.db, cid, 'preceding_recorded_' + str(pld.get('role') or pld.get('type') or 'item'), txt,
                                         {**binding, 'item_id': iid, 'record_sha256': digest(raw), 'selection': 'first preceding user plus up to 12 preceding messages and 4 tools'}, visibility)
                    gaps.append({'reason': 'bounded_projection_context; earlier context and provider-private state not reconstructed', 'selected_records': len(records)})
                except (OSError, sqlite3.Error, ValueError) as e:
                    gaps.append({'reason': 'source_unavailable', 'error': type(e).__name__})
            elif source == 'audit_cache':
                try:
                    p = Path(path)
                    if p.stat().st_size > MAX_SCAN:
                        raise ValueError('cache exceeds bound')
                    if path not in self.rollouts:
                        self.rollouts[path] = (json.loads(p.read_text()), checksum(p))
                    cache, ch = self.rollouts[path]
                    record = cache[int(o['item_id'])]
                    if record.get('context'):
                        add_evidence(self.db, cid, 'recorded_cache_context', js(record['context']), {'path': path, 'sha256': ch, 'index': o['item_id']}, 'unknown')
                    gaps.append({'reason': 'cache_only; original conversation ordering and recipient access unavailable', 'original_rollout': o.get('original_rollout')})
                except (OSError, ValueError, IndexError, KeyError) as e:
                    gaps.append({'reason': 'cache_unavailable', 'error': type(e).__name__})
            # The exact input is recipient-visible; sender-side prior conversation never inherits that visibility.
            add_evidence(self.db, cid, 'recorded_handoff_body', row['text'], {'observation_id': row['observation_id'], 'source': source, 'locator': path, 'line': o.get('line'), 'item_id': o.get('item_id'), 'body_sha256': row['message_id']}, 'recipient_visible' if o['kind'] in (INPUT_KINDS | {'native_agent_prompt','native_agent_message'}) and source != 'audit_cache' else 'unknown')
            gaps.append({'reason': 'recipient_access_to_sender_history_unknown; mirrors_not_unique_deliveries'})
            self.references(cid, row['text'], meta, o)
            count = self.db.execute("SELECT count(*) FROM context_evidence ce JOIN evidence e USING(evidence_id) WHERE context_id=? AND kind!='recorded_handoff_body'", (cid,)).fetchone()[0]
            count += self.db.execute("SELECT count(*) FROM context_references WHERE context_id=? AND json_extract(record_json,'$.availability')='recovered'", (cid,)).fetchone()[0]
            self.db.execute('UPDATE contexts SET status=?,metadata_json=? WHERE context_id=?', ('partial' if count else 'unavailable', js({'gaps': gaps, 'historical_session': meta, 'source_binding': binding, 'collector_version': VERSION}), cid))

    def references(self, cid, text, meta, o):
        cwd = meta.get('cwd') or o.get('cwd')
        git = meta.get('git') or {}
        revision = git.get('commit_hash') if isinstance(git, dict) else None
        paths = list(dict.fromkeys(re.findall(r'(?<![\w])(?:/[\w.~-]+)+(?:\.[\w-]+)?|(?:[\w.-]+/)*[\w.-]+\.(?:md|rs|py|json|toml|yaml|yml)\b|\b[A-Z][A-Z0-9]+-\d+\b', text)))
        # Historical defaults are candidates, not evidence until git show succeeds.
        if revision and cwd:
            paths.extend(p for p in ['AGENTS.md','SPEC.md','README.md'] if p not in paths)
        for i, path in enumerate(paths[:24]):
            ref = {'path': path, 'historical_revision': revision, 'availability': 'unavailable', 'text': None,
                   'visibility': 'unknown', 'provenance': {'recorded_cwd': cwd, 'revision_source': 'recorded_session_meta.git.commit_hash' if revision else None}}
            if re.fullmatch(r'[A-Z][A-Z0-9]+-\d+', path):
                ref['reason'] = 'issue tracker unavailable offline; identifier only'
            elif not cwd or not revision:
                ref['reason'] = 'historical repository revision unavailable; current documents not used'
            else:
                key = (cwd, revision, path)
                if key not in self.ref_cache:
                    self.ref_cache[key] = self.git_reference(cwd, revision, path)
                ref.update(self.ref_cache[key])
            self.db.execute('INSERT OR IGNORE INTO context_references VALUES(?,?,?)', ('ref-' + digest(cid + ':' + str(i) + ':' + path), cid, js(ref)))
        if len(paths) > 24:
            self.db.execute('INSERT OR IGNORE INTO context_references VALUES(?,?,?)', ('ref-' + digest(cid + ':cap'), cid, js({'path': None, 'availability': 'omitted', 'reason': 'reference cap', 'candidate_count': len(paths), 'omitted_count': len(paths)-24})))

    def git_reference(self, cwd, revision, path):
        if not re.fullmatch('[0-9a-fA-F]{40,64}', revision):
            return {'reason': 'invalid recorded revision'}
        try:
            if cwd not in self.repo_cache:
                r = subprocess.run(['git','-c','protocol.allow=never','-C',cwd,'rev-parse','--show-toplevel'], capture_output=True, timeout=5, env={**os.environ,'GIT_NO_LAZY_FETCH':'1','GIT_TERMINAL_PROMPT':'0','GIT_OPTIONAL_LOCKS':'0','GIT_NO_REPLACE_OBJECTS':'1'})
                self.repo_cache[cwd] = r.stdout.decode().strip() if r.returncode == 0 else None
            root = self.repo_cache[cwd]
            if not root:
                return {'reason': 'recorded repository unavailable'}
            candidate = Path(path) if Path(path).is_absolute() else Path(cwd) / path
            relative = os.path.relpath(os.path.normpath(candidate), root)
            if relative.startswith('../'):
                return {'reason': 'reference outside recorded repository'}
            # cat-file size first prevents unbounded blob dumps.
            spec = revision + ':' + relative
            r = subprocess.run(['git','-c','protocol.allow=never','-C',root,'cat-file','-s',spec], capture_output=True, timeout=5, env={**os.environ,'GIT_NO_LAZY_FETCH':'1','GIT_TERMINAL_PROMPT':'0','GIT_OPTIONAL_LOCKS':'0','GIT_NO_REPLACE_OBJECTS':'1'})
            if r.returncode:
                return {'reason': 'path or revision unavailable in local git objects'}
            size = int(r.stdout)
            if size > MAX_FILE:
                return {'reason': 'historical blob exceeds 65536-byte cap', 'omitted_bytes': size}
            r = subprocess.run(['git','-c','protocol.allow=never','-C',root,'show',spec], capture_output=True, timeout=5, env={**os.environ,'GIT_NO_LAZY_FETCH':'1','GIT_TERMINAL_PROMPT':'0','GIT_OPTIONAL_LOCKS':'0','GIT_NO_REPLACE_OBJECTS':'1'})
            if r.returncode or b'\0' in r.stdout:
                return {'reason': 'historical blob unavailable or nontext'}
            return {'availability': 'recovered', 'text': r.stdout.decode('utf-8'), 'blob_sha256': digest(r.stdout), 'repository': root, 'repository_path': relative,
                    'reason': 'recorded session revision; this does not prove recipient read access or file state at handoff time'}
        except (OSError, ValueError, subprocess.TimeoutExpired):
            return {'reason': 'historical git read failed'}


def recover_cache_origins(db, collector):
    """Use exact recorded body matches to link cache references to source logs."""
    groups = collections.defaultdict(list)
    for row in db.execute("SELECT c.context_id,c.message_id,c.metadata_json,o.record_json FROM contexts c JOIN observations o USING(observation_id) JOIN messages m ON m.message_id=c.message_id WHERE o.source='audit_cache' AND m.is_input=1 AND json_extract(c.metadata_json,'$.cache_original_rollout_recovery') IS NULL"):
        o = json.loads(row['record_json'])
        if o.get('original_rollout'):
            groups[o['original_rollout']].append(row)
    for index,(path,rows) in enumerate(groups.items(),1):
        wanted = {r['message_id'] for r in rows}
        anchors = collections.defaultdict(list)
        matches = collections.Counter()
        errors = 0
        scanned = 0
        scan_hash = hashlib.sha256()
        failure = None
        try:
            with Path(path).open('rb') as f:
                size = os.fstat(f.fileno()).st_size
                number = 0
                while scanned < min(size,MAX_SCAN):
                    raw = f.readline(min(size,MAX_SCAN)-scanned)
                    if not raw:
                        break
                    scanned += len(raw)
                    scan_hash.update(raw)
                    number += 1
                    try:
                        pld = json.loads(raw).get('payload') or {}
                        if not isinstance(pld,dict):
                            continue
                        candidates = [text_of(pld)]
                        candidates.extend(pld.get(k) for k in ('text','message','prompt'))
                        # The original exporter reads task/message tool fields and
                        # joins recorded multipart text blocks with newlines.
                        args = pld.get('arguments')
                        if isinstance(args,str):
                            try:
                                args = json.loads(args)
                            except ValueError:
                                args = None
                        if isinstance(args,dict):
                            candidates.extend(args.get(k) for k in ('task','message','prompt'))
                        found = {digest(t) for t in candidates if isinstance(t,str) and t}
                        for mid in found & wanted:
                            matches[mid] += 1
                            if len(anchors[mid])<3:
                                anchors[mid].append(number)
                    except (ValueError,UnicodeDecodeError,AttributeError):
                        errors += 1
            selected,binding = collector.rollout(path,{n for ns in anchors.values() for n in ns}) if anchors else ({},{'prefix_sha256':scan_hash.hexdigest(),'bytes_scanned':scanned,'initial_bytes':size,'omitted_bytes':max(0,size-scanned)})
        except OSError as e:
            selected,binding = {},{}
            failure = type(e).__name__
        changed = bool(anchors and binding.get('prefix_sha256') != scan_hash.hexdigest())
        if changed:
            selected = {}
        with db:
            for row in rows:
                cid,mid = row['context_id'],row['message_id']
                info = {'path':path,'exact_body_matches':matches[mid],'anchor_lines':anchors[mid],
                        'omitted_anchor_count':max(0,matches[mid]-3),'scan_parse_errors':errors,
                        'source_binding':binding,'matching_scan_sha256':scan_hash.hexdigest(),'source_changed_between_passes':changed,'error':failure,
                        'limitation':'exact body match links evidence only; delivery identity and recipient visibility are unproven'}
                for anchor in anchors[mid]:
                    for n,kind,txt,record_hash in selected.get(anchor,([],{}))[0]:
                        add_evidence(db,cid,'cache_origin_'+kind,txt,{**binding,'path':path,'line':n,'record_sha256':record_hash,'matched_body_line':anchor,'link_basis':'exact body hash in referenced rollout'},'unknown')
                meta = json.loads(row['metadata_json'])
                meta['cache_original_rollout_recovery'] = info
                if not matches[mid]:
                    meta.setdefault('gaps',[]).append({'reason':'referenced_cache_rollout_has_no_exact_recorded_body_match_within_scan'})
                count = db.execute("SELECT count(*) FROM context_evidence ce JOIN evidence e USING(evidence_id) WHERE ce.context_id=? AND e.kind!='recorded_handoff_body'",(cid,)).fetchone()[0]
                count += db.execute("SELECT count(*) FROM context_references WHERE context_id=? AND json_extract(record_json,'$.availability')='recovered'",(cid,)).fetchone()[0]
                db.execute('UPDATE contexts SET status=?,metadata_json=? WHERE context_id=?',('partial' if count else 'unavailable',js(meta),cid))
        if index % 100 == 0:
            print('Recovered cache-origin groups',index,'/',len(groups),flush=True)


def recover(db):
    db.execute("UPDATE contexts SET status='unavailable',metadata_json=? WHERE status='pending' AND message_id IN (SELECT message_id FROM messages WHERE is_input=0)", (js({'gaps': [{'reason': 'non_input_output_path_not_enriched; body and provenance retained'}]}),))
    db.commit()
    collector = Recovery(db)
    groups = collections.defaultdict(list)
    for r in db.execute("SELECT c.context_id,c.observation_id,c.message_id,o.record_json,m.text FROM contexts c JOIN observations o USING(observation_id) JOIN messages m ON m.message_id=c.message_id WHERE c.status='pending' ORDER BY o.export_line"):
        o = json.loads(r['record_json'])
        groups[(o['source'], o['locator'])].append(r)
    for i, ((source, _), rows) in enumerate(groups.items(), 1):
        batch_size = len(rows) if source=='codex_rollout' else 100
        for start in range(0,len(rows),batch_size):
            with db:
                collector.recover_group(rows[start:start+batch_size])
            if len(rows)>100:
                print('Recovered',source,min(start+batch_size,len(rows)),'/',len(rows),flush=True)
        if i % 100 == 0:
            print('Recovered source groups', i, '/', len(groups), flush=True)
    recover_cache_origins(db,collector)
    for d in collector.connections.values():
        d.close()


def insert_review(db, run_id, context_id, message_id, record):
    """Stable Python API: use an existing run; all grades and evidence links checked."""
    run = db.execute('SELECT * FROM review_runs WHERE run_id=?', (run_id,)).fetchone()
    if not run:
        raise ValueError('Create review_runs metadata first')
    for dimension in ('purpose','information_selection','clarity','overall'):
        obj = record.get(dimension)
        if not isinstance(obj, dict) or obj.get('grade') not in ('pass','fail','ambiguous','unknown') or not isinstance(obj.get('reason'), str):
            raise ValueError('Invalid dimension: ' + dimension)
    if not isinstance(record.get('rationale'),str):
        raise ValueError('Review rationale must be text')
    if not isinstance(record.get('evidence_ids'),list) or not all(isinstance(x,str) for x in record['evidence_ids']):
        raise ValueError('evidence_ids must be a list of IDs')
    allowed = {r[0] for r in db.execute('SELECT evidence_id FROM context_evidence WHERE context_id=?', (context_id,))}
    if not set(record.get('evidence_ids', [])).issubset(allowed):
        raise ValueError('Evidence does not belong to this context')
    rid = record.get('review_id') or 'review-' + digest(js([run_id,context_id,message_id,record]))
    value = {**record, 'review_id':rid, 'run_id': run_id, 'rubric_version':run['rubric_version'], 'reviewer':run['reviewer']}
    db.execute('INSERT INTO reviews VALUES(?,?,?,?,?)', (rid,run_id,context_id,message_id,js(value)))
    return rid


def summary(db):
    result = {t:db.execute('SELECT count(*) FROM '+t).fetchone()[0] for t in ('messages','observations','contexts','evidence','context_references','historical_reviews','splits','reviews','review_runs','corpus_gaps')}
    result['input_bodies'] = db.execute('SELECT count(*) FROM messages WHERE is_input=1').fetchone()[0]
    result['context_status'] = dict(db.execute('SELECT status,count(*) FROM contexts GROUP BY status'))
    result['input_bodies_with_preceding_evidence'] = db.execute("SELECT count(DISTINCT c.message_id) FROM contexts c JOIN context_evidence ce USING(context_id) JOIN evidence e USING(evidence_id) WHERE e.kind!='recorded_handoff_body'").fetchone()[0]
    result['input_bodies_with_auxiliary_evidence'] = result['input_bodies_with_preceding_evidence']
    result['input_bodies_with_preceding_evidence'] = db.execute("SELECT count(DISTINCT c.message_id) FROM contexts c JOIN context_evidence ce USING(context_id) JOIN evidence e USING(evidence_id) WHERE e.kind LIKE 'preceding_%' OR e.kind='first_recorded_user' OR e.kind LIKE 'cache_origin_preceding_%' OR e.kind='cache_origin_first_recorded_user'").fetchone()[0]
    result['input_bodies_with_historical_files'] = db.execute("SELECT count(DISTINCT c.message_id) FROM contexts c JOIN context_references r USING(context_id) WHERE json_extract(r.record_json,'$.availability')='recovered'").fetchone()[0]
    result['reference_availability'] = dict(db.execute("SELECT json_extract(record_json,'$.availability'),count(*) FROM context_references GROUP BY 1"))
    return result


def validate(db):
    if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok' or db.execute('PRAGMA foreign_key_check').fetchall():
        raise ValueError('Database integrity failed')
    if db.execute('SELECT count(*) FROM observations o LEFT JOIN contexts c USING(observation_id) WHERE c.context_id IS NULL').fetchone()[0]:
        raise ValueError('Missing contexts')
    for r in db.execute('SELECT message_id,text FROM messages'):
        if digest(r['text']) != r['message_id']:
            raise ValueError('Stored text hash mismatch')
    for r in db.execute('SELECT * FROM observations'):
        value = json.loads(r['record_json'])
        if digest(str(r['export_line'])+':'+js(value)) != r['observation_id'] or value['message_id'] != r['message_id']:
            raise ValueError('Stored observation binding mismatch')
    if db.execute("SELECT count(*) FROM contexts c JOIN observations o USING(observation_id) WHERE c.message_id!=o.message_id OR c.context_id!='ctx-'||o.observation_id").fetchone()[0]:
        raise ValueError('Context/observation binding mismatch')
    for r in db.execute('SELECT * FROM source_files'):
        archived = db.execute('SELECT sha256 FROM archived_files WHERE path=?', (r['path'],)).fetchone()
        if archived:
            from research_store import archived_bytes
            value = digest(archived_bytes(db,r['path']))
        else:
            value = checksum(r['path'])
        if value != r['sha256']:
            raise ValueError('Bound input changed: ' + r['path'])
    manifest = json.loads(db.execute("SELECT value FROM metadata WHERE key='manifest'").fetchone()[0])
    s = summary(db)
    if s['messages'] != manifest['counts']['unique_plaintext_bodies'] or s['observations'] != manifest['counts']['plaintext_observations']:
        raise ValueError('Manifest count mismatch')
    if s['context_status'].get('pending',0):
        raise ValueError('Recovery incomplete; rerun collect')
    from research_store import validate_archives
    validate_archives(db)
    return s


def export_snapshot(db, target, dbpath, text_limit=1000):
    target = Path(target)
    temp = target.with_suffix('.tmp')
    with temp.open('w') as f:
        f.write('{"schema_version":1,"generated_at":'+js(now())+',"database_path":'+js(str(Path(dbpath).resolve()))+',"summary":'+js(summary(db))+',"messages":[')
        first = True
        for m in db.execute('SELECT * FROM messages ORDER BY message_id'):
            row = dict(m)
            row['kinds'], row['projects'] = json.loads(row['kinds']), json.loads(row['projects'])
            mechanical = db.execute('SELECT r.result_json FROM mechanical_results r JOIN mechanical_runs mr USING(run_id) WHERE r.message_id=? ORDER BY mr.created_at DESC,mr.run_id DESC LIMIT 1', (m['message_id'],)).fetchone()
            row['mechanical'] = json.loads(mechanical[0]) if mechanical else None
            row['historical_reviews'] = [dict(json.loads(r[0]), source_path=r[1]) for r in db.execute('SELECT record_json,source_path FROM historical_reviews WHERE message_id=? ORDER BY id', (m['message_id'],))]
            row['contexts'] = []
            for c in db.execute('SELECT c.*,o.record_json FROM contexts c JOIN observations o USING(observation_id) WHERE c.message_id=? ORDER BY context_id', (m['message_id'],)):
                o = json.loads(c['record_json'])
                ctx = {k:o.get(k) for k in ('kind','tool','timestamp','project','source','locator','sender_thread_id','target_thread_id')}
                if not ctx['timestamp'] and o.get('timestamp_ms') is not None:
                    stamp = timestamp(o['timestamp_ms'])
                    ctx['timestamp'] = stamp.isoformat() if stamp else None
                ctx.update(source_item_id=o.get('item_id'),source_line=o.get('line'),source_thread_id=o.get('thread_id'),native_thread_id=o.get('native_thread_id'),model=o.get('model'),model_attribution=o.get('model_attribution'),recorded_target=o.get('target'),context_id=c['context_id'],task_summary=None,context_status=c['status'],availability=json.loads(c['metadata_json']),observation_id=c['observation_id'])
                ctx['evidence'] = [{**dict(e), 'provenance':json.loads(e['provenance'])} for e in db.execute('SELECT e.* FROM evidence e JOIN context_evidence ce USING(evidence_id) WHERE context_id=? ORDER BY evidence_id', (c['context_id'],))]
                ctx['references'] = [dict(json.loads(r['record_json']), reference_id=r['reference_id']) for r in db.execute('SELECT * FROM context_references WHERE context_id=? ORDER BY reference_id', (c['context_id'],))]
                for item in [*ctx['evidence'], *ctx['references']]:
                    value = item.get('text')
                    if text_limit and isinstance(value,str) and len(value)>text_limit:
                        item['snapshot_original_characters'] = len(value)
                        item['snapshot_omitted_characters'] = len(value)-text_limit
                        item['text'] = value[:text_limit]
                ctx['analyses'] = [dict(json.loads(r[0]), reviewed_at=r[1]) for r in db.execute('SELECT r.record_json,rr.created_at FROM reviews r JOIN review_runs rr USING(run_id) WHERE r.context_id=? ORDER BY rr.created_at DESC,r.review_id DESC', (c['context_id'],))]
                row['contexts'].append(ctx)
            if not first:
                f.write(',')
            f.write(js(row))
            first = False
        f.write(']}\n')
    os.chmod(temp,0o600)
    temp.replace(target)


def main():
    os.umask(0o077)
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command',choices=['collect','validate','export'])
    p.add_argument('--directory',type=Path,default=ROOT/'data')
    p.add_argument('--database',type=Path)
    p.add_argument('--snapshot',type=Path)
    p.add_argument('--snapshot-text-limit',type=int,default=1000,help='Evidence/reference characters in snapshot only; 0 retains all stored text')
    args = p.parse_args()
    dbpath = args.database or args.directory/'handoffs.sqlite3'
    db = connect(dbpath)
    if args.command == 'collect':
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('PRAGMA synchronous=NORMAL')
        if not db.execute('SELECT 1 FROM messages LIMIT 1').fetchone():
            import_corpus(db,args.directory)
        recover(db)
    result = validate(db)
    if args.command == 'export' or args.snapshot:
        export_snapshot(db,args.snapshot or args.directory/'dashboard.json',dbpath,args.snapshot_text_limit)
    db.commit()
    if args.command == 'collect':
        db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    print(js(result))
    db.close()


if __name__ == '__main__':
    main()
