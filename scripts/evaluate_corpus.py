#!/usr/bin/env python3
"""Evaluate every recovered body with the compiled guard; keep raw results private.

prepare freezes connected-thread splits BEFORE tuning. Labels, splits and
predictions live in SQLite. No automatic style labels are ground truth.
"""
import argparse
import collections
import hashlib
import json
from pathlib import Path

import context_database as corpus
import research_store as store

ROOT = Path(__file__).resolve().parents[1]
WORKER = {'worker_assistant_output', 'worker_commentary', 'worker_final_answer', 'worker_report', 'cached_worker_report', 'completion_notification'}
INPUTS = {'assignment', 'agent_message', 'followup_assignment', 'cached_agent_message', 'agent_delivery'}


def prepare(db):
    if db.execute('SELECT 1 FROM splits LIMIT 1').fetchone():
        raise ValueError('Reserved split already exists; refusing to change it')
    config = json.loads((ROOT/'config/review.json').read_text())
    messages = [dict(r) for r in db.execute('SELECT message_id FROM messages')]
    observations = [json.loads(r[0]) for r in db.execute('SELECT record_json FROM observations')]
    parent = {}
    def root(x):
        parent.setdefault(x, x)
        if parent[x] != x:
            parent[x] = root(parent[x])
        return parent[x]
    first = {}
    for row in observations:
        # Connect mirrored bodies and both sides of inter-thread deliveries.
        threads = [row[k] for k in ('thread_id', 'sender_thread_id') if row.get(k)]
        for thread in threads:
            message = row['message_id']
            if message in first:
                a, b = root(thread), root(first[message])
                parent[max(a, b)] = min(a, b)
            else:
                first[message] = thread
                root(thread)
    groups = collections.defaultdict(list)
    for thread in parent:
        groups[root(thread)].append(thread)
    # Hash the sorted component identity, never the label or outcome.
    identities = {r: hashlib.sha256('\n'.join(sorted(ts)).encode()).hexdigest() for r, ts in groups.items()}
    rows = []
    for message in messages:
        mid = message['message_id']
        component = identities[root(first[mid])] if mid in first else mid
        rows.append({'message_id': mid, 'component': component,
                     'split': 'heldout' if int(component[:8], 16) % config['heldout_modulus'] == config['heldout_residue'] else 'tuning'})
    with db:
        db.executemany('INSERT INTO splits VALUES(?,?)',[(r['message_id'],corpus.js(r)) for r in rows])
    return {'bodies':dict(collections.Counter(r['split'] for r in rows)),'thread_components':len(groups),'threads':len(parent)}


def evaluate(db, binary, label_source):
    corpus.validate(db)
    messages = [{**dict(r),'kinds':json.loads(r['kinds'])} for r in db.execute('SELECT * FROM messages ORDER BY message_id')]
    split = {r['message_id']:json.loads(r['record_json'])['split'] for r in db.execute('SELECT * FROM splits')}
    labels = {}
    for row in db.execute('SELECT source_path,record_json FROM historical_reviews ORDER BY id'):
        if row['source_path'].endswith('/'+label_source):
            value = json.loads(row['record_json'])
            labels[value['message_id']] = value
    if label_source != 'none' and not labels:
        raise ValueError('No labels for requested source')
    message_ids = {r['message_id'] for r in messages}
    assert split.keys() == message_ids, 'Reserved split does not match this corpus'
    assert labels.keys() <= message_ids, 'Labels reference unknown bodies'
    assert all(r['style_label'] in {'normal', 'pathological', 'ambiguous'} for r in labels.values()), 'Unknown style label'
    predictions = store.compiled(db,binary,'evaluate')
    assert len(predictions) == len(messages)
    by_id = {r['message_id']: r for r in predictions}
    assert by_id.keys() == {r['message_id'] for r in messages}
    manifest_source = db.execute("SELECT sha256 FROM source_files WHERE purpose='manifest'").fetchone()
    report = {'manifest_sha256': manifest_source[0] if manifest_source else None,
              'label_records_sha256':corpus.digest(corpus.js(labels)),
              'split_records_sha256':corpus.digest(corpus.js(split)),
              'binary_sha256': hashlib.sha256(binary.read_bytes()).hexdigest(),
              'policy': {'characters': 12000, 'words': 1500}, 'groups': {},
              'label_source':label_source, 'annotation_limit':'Historical model reviews are fallible; reserved groups have been exposed to earlier triage. This is not an untouched accuracy estimate.',
              'note': 'Distinct bodies, not deliveries. Style errors use only manually reviewed normal/pathological labels. Unreviewed bodies are unassessed, not normal. Ambiguous labels are excluded from error rates.'}
    details = []
    for scope in ['all_plaintext', 'handoff_inputs', 'worker_output_only', 'other_plaintext']:
        rows = [r for r in messages if scope == 'all_plaintext'
                or (scope == 'handoff_inputs' and INPUTS.intersection(r['kinds']))
                or (scope == 'worker_output_only' and WORKER.intersection(r['kinds']) and not INPUTS.intersection(r['kinds']))
                or (scope == 'other_plaintext' and not (INPUTS | WORKER).intersection(r['kinds']))]
        for subset in ['all', 'tuning', 'heldout']:
            selected = [r for r in rows if subset == 'all' or split[r['message_id']] == subset]
            counts = collections.Counter()
            matrix = collections.Counter()
            for row in selected:
                mid = row['message_id']; rule = by_id[mid]['rule']; label = labels.get(mid, {}).get('style_label', 'unassessed')
                counts['bodies'] += 1; counts['denied' if rule else 'allowed'] += 1
                if rule: counts['rule:' + rule] += 1
                counts['label:' + label] += 1
                # Use the compiled validator's decision, not Python's whitespace semantics.
                size = rule in {'characters', 'words'}
                if size: counts['size_policy_denials'] += 1
                if label in {'normal', 'pathological'}:
                    style_reject = rule in {'glued_prose', 'repetition'}
                    if size: matrix['excluded_size_policy'] += 1
                    elif label == 'normal': matrix['false_positive' if style_reject else 'true_negative'] += 1
                    else: matrix['true_positive' if style_reject else 'miss'] += 1
            report['groups'][scope + ':' + subset] = {'counts': dict(counts), 'style_confusion': dict(matrix)}
    for row in messages:
        mid = row['message_id']
        details.append({**by_id[mid], 'split': split[mid], 'kinds': row['kinds'],
                        'style_label': labels.get(mid, {}).get('style_label', 'unassessed')})
    run_id = 'evaluation-' + corpus.digest(corpus.js(report))[:24]
    with db:
        store.create_run(db,run_id,'corpus-evaluation',report)
        for detail in details:
            store.put(db,run_id,'prediction',detail['message_id'],detail,detail['message_id'])
        store.put(db,run_id,'report','summary',report)
    return {'run_id':run_id,**report}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['prepare','evaluate'])
    parser.add_argument('--database',type=Path,default=store.DATABASE)
    parser.add_argument('--binary',type=Path,default=ROOT/'target/release/handoff-guard')
    parser.add_argument('--labels',choices=['labels-full.jsonl','labels-sol.jsonl','labels-reconciled.jsonl','labels.jsonl','none'],default='labels-full.jsonl')
    args = parser.parse_args()
    db = corpus.connect(args.database)
    try:
        print(corpus.js(prepare(db) if args.action=='prepare' else evaluate(db,args.binary,args.labels)))
    finally:
        db.close()
