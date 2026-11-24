#!/usr/bin/env python3
"""Prepare rough triage and full-message review; never modify hook policy or old labels."""
import argparse
import collections
import hashlib
import json
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data/private'
RUN = SOURCE / 'triage-20261123'
INPUT_KINDS = {'assignment', 'agent_message', 'followup_assignment',
               'cached_agent_message', 'agent_delivery'}
ISSUES = {'glued_prose', 'extreme_repetition', 'incoherent', 'overcompressed', 'other'}


def read_jsonl(path):
    with path.open() as stream:
        return [json.loads(line) for line in stream if line.strip()]


def private_json(path, value):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with path.open('w') as out:
        os.chmod(path, 0o600)
        json.dump(value, out, ensure_ascii=False, indent=2)
        out.write('\n')


def private_jsonl(path, rows):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with path.open('w') as out:
        os.chmod(path, 0o600)
        for row in rows:
            out.write(json.dumps(row, ensure_ascii=False) + '\n')


def features(text):
    """Broad review-priority hints, deliberately more sensitive than the guard."""
    words = text.split()
    prose = re.sub(r'```.*?```|~~~.*?~~~', ' ', text, flags=re.S)
    # These are crude signals, not judgments about whether a token is valid prose.
    runs = re.findall(r'[A-Za-z]{24,}', prose)
    token_counts = collections.Counter(words)
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    longest = max((len(run) for run in runs), default=0)
    long_letters = sum(map(len, runs))
    whitespace = sum(c.isspace() for c in text) / max(1, len(text))
    max_token_share = max(token_counts.values(), default=0) / max(1, len(words))
    repeated_line_share = max(collections.Counter(lines).values(), default=0) / max(1, len(lines))
    hints = []
    if long_letters >= 100 or longest >= 60:
        hints.append('long_alphabetic_runs')
    if len(text) >= 300 and whitespace < 0.09:
        hints.append('low_whitespace')
    if len(words) >= 50 and max_token_share >= 0.3:
        hints.append('repeated_tokens')
    if len(lines) >= 8 and repeated_line_share >= 0.5:
        hints.append('repeated_lines')
    if len(text) >= 6000:
        hints.append('long_brief')
    priority = 'suspicious' if any(h != 'long_brief' for h in hints) else ('needs_context' if hints else 'ordinary_candidate')
    return {'priority': priority, 'hints': hints, 'characters': len(text),
            'words': len(words), 'longest_alphabetic_run': longest,
            'long_run_letters': long_letters, 'whitespace_fraction': round(whitespace, 4),
            'max_token_share': round(max_token_share, 4),
            'over_character_policy': len(text) > 12000,
            'over_word_policy': len(words) > 1500}


def prepare(batch_count):
    if (RUN / 'manifest.json').exists():
        raise SystemExit('Run already prepared; refusing to replace review inputs')
    messages = read_jsonl(SOURCE / 'messages.jsonl')
    manifest = json.loads((SOURCE / 'manifest.json').read_text())
    for name in ['messages.jsonl', 'observations.jsonl']:
        assert hashlib.sha256((SOURCE / name).read_bytes()).hexdigest() == manifest['files'][name]['sha256']
    selected = [r for r in messages if INPUT_KINDS.intersection(r['kinds'])]
    split = {r['message_id']: r['split'] for r in read_jsonl(SOURCE / 'split.jsonl')}
    hints = [{ 'message_id': row['message_id'], **features(row['text'])} for row in selected]
    by_id = {r['message_id']: r for r in hints}
    # Balance full text volume; keep wrapper-only variants in the same batch.
    families = collections.defaultdict(list)
    for row in selected:
        body = re.sub(r'^Act as the [^\n]{1,60} sub-agent for this task\.\s*\n', '', row['text'])
        family = hashlib.sha256(body.encode()).hexdigest()
        families[family].append(row)
    batches = [[] for _ in range(batch_count)]
    sizes = [0] * batch_count
    for family, rows in sorted(families.items(), key=lambda pair: (-sum(r['characters'] for r in pair[1]), pair[0])):
        batch = min(range(batch_count), key=lambda n: (sizes[n], n))
        for row in rows:
            batches[batch].append({**row, 'family_id': family, 'original_split': split[row['message_id']]})
            sizes[batch] += row['characters']
    records = []
    for batch, rows in enumerate(batches):
        # Mixed order keeps all hint strata represented without displaying predictions.
        rows.sort(key=lambda row: row['message_id'])
        pages, page, characters = [], [], 0
        for index, row in enumerate(rows):
            record = {'index': index, 'message_id': row['message_id'], 'characters': row['characters'], 'text': row['text']}
            if page and characters + row['characters'] > 18000:
                pages.append(page); page, characters = [], 0
            page.append(record); characters += row['characters']
        if page:
            pages.append(page)
        private_json(RUN / 'batches' / f'{batch:02d}.json', {'batch': batch, 'pages': pages})
        records.append({'batch': batch, 'messages': len(rows), 'characters': sizes[batch], 'pages': len(pages),
                        'message_ids': [r['message_id'] for r in rows]})
    private_jsonl(RUN / 'heuristics.jsonl', hints)
    private_jsonl(RUN / 'inputs.jsonl', selected)
    prepared = {'source_manifest_sha256': hashlib.sha256((SOURCE/'manifest.json').read_bytes()).hexdigest(),
                'message_sha256': manifest['files']['messages.jsonl']['sha256'],
                'scope': 'all distinct plaintext handoff input bodies; worker output excluded',
                'messages': len(selected), 'characters': sum(r['characters'] for r in selected),
                'families': len(families), 'batches': records,
                'heuristic_counts': dict(collections.Counter(r['priority'] for r in hints)),
                'delegation_note': 'No multi-agent skill or package locator was listed or found locally; follow explicit delegation tool instructions. User explicitly requested Luna agents.'}
    private_json(RUN / 'manifest.json', prepared)
    print(json.dumps({k: v for k, v in prepared.items() if k not in {'batches', 'delegation_note'}}, indent=2))
    print(json.dumps([{k:v for k,v in r.items() if k != 'message_ids'} for r in records], indent=2))


def page(batch, number):
    data = json.loads((RUN/'batches'/f'{batch:02d}.json').read_text())
    rows = data['pages'][number]
    # Audit delivery of complete pages, not a claim that model understanding is provable.
    private_json(RUN/'views'/f'{batch:02d}-{number:02d}.json',
                 {'batch': batch, 'page': number, 'message_ids': [r['message_id'] for r in rows],
                  'characters': sum(r['characters'] for r in rows)})
    print(json.dumps({'batch': batch, 'page': number, 'total_pages':len(data['pages']), 'messages':rows}, ensure_ascii=False))


def record(batch, decisions):
    data = json.loads((RUN/'batches'/f'{batch:02d}.json').read_text())
    lookup = {r['index']:r for page in data['pages'] for r in page}
    path = RUN/'labels'/f'{batch:02d}.jsonl'
    existing = read_jsonl(path) if path.exists() else []
    used = {r['message_id'] for r in existing}
    new = json.loads(decisions.read_text())
    assert isinstance(new, list)
    match = re.fullmatch(r'decisions-(\d+)-(\d+)\.json', decisions.name)
    assert match and int(match[1]) == batch, 'Use decisions-BATCH-PAGE.json for one complete page'
    page_number = int(match[2])
    assert 0 <= page_number < len(data['pages']), 'Page numbers start at zero'
    expected_indices = {r['index'] for r in data['pages'][page_number]}
    assert {r['index'] for r in new} == expected_indices, f'Decisions must match actual page indices {sorted(expected_indices)} exactly; reread page before recording'
    assert (RUN/'views'/f'{batch:02d}-{page_number:02d}.json').exists(), 'Read the full page first'
    for row in new:
        source = lookup[row['index']]
        assert source['message_id'] not in used, 'Duplicate decision; do not silently overwrite'
        assert row['style_label'] in {'normal','pathological','ambiguous'}
        assert row['confidence'] in {'high','medium','low'}
        assert isinstance(row['issues'], list) and set(row['issues']) <= ISSUES
        assert isinstance(row['rationale'], str) and 12 <= len(row['rationale']) <= 700
        assert row['full_message_reviewed'] is True
        if row['style_label'] == 'normal':
            assert not row['issues'], 'Normal messages must not have pathology flags'
        if row['style_label'] == 'pathological':
            assert row['issues'], 'Pathological messages need a specific issue'
        existing.append({**row, 'message_id':source['message_id'], 'reviewed_characters':source['characters'],
                         'reviewer': f'gpt-6-luna:batch-{batch:02d}', 'batch':batch, 'review_depth':'full_message'})
        used.add(source['message_id'])
    private_jsonl(path, existing)
    print(json.dumps({'batch':batch,'recorded':len(new),'total':len(existing),'expected':len(lookup)}))


def validate(require_complete):
    manifest = json.loads((RUN/'manifest.json').read_text())
    decisions, missing = [], []
    for batch in manifest['batches']:
        path = RUN/'labels'/f"{batch['batch']:02d}.jsonl"
        rows = read_jsonl(path) if path.exists() else []
        expected, found = set(batch['message_ids']), {r['message_id'] for r in rows}
        assert len(rows) == len(found) and found <= expected
        for r in rows:
            assert r['full_message_reviewed'] is True and r['review_depth']=='full_message'
        missing.extend(expected-found)
        if require_complete:
            assert found == expected, f"Incomplete batch {batch['batch']}: {len(found)}/{len(expected)}"
            for p in range(batch['pages']):
                assert (RUN/'views'/f"{batch['batch']:02d}-{p:02d}.json").exists(), 'Missing full-page read receipt'
        decisions.extend(rows)
    assert len({r['message_id'] for r in decisions}) == len(decisions)
    report = {'expected':manifest['messages'],'reviewed':len(decisions),'missing':len(missing),
              'style_counts':dict(collections.Counter(r['style_label'] for r in decisions)),
              'issue_counts':dict(collections.Counter(issue for r in decisions for issue in r['issues'])),
              'confidence_counts':dict(collections.Counter(r['confidence'] for r in decisions)),
              'heuristic_counts':manifest['heuristic_counts']}
    if require_complete:
        private_jsonl(RUN/'labels-full.jsonl', sorted(decisions,key=lambda r:r['message_id']))
        hints = {r['message_id']:r for r in read_jsonl(RUN/'heuristics.jsonl')}
        report['style_by_heuristic'] = {}
        for priority in ['ordinary_candidate','needs_context','suspicious']:
            report['style_by_heuristic'][priority] = dict(collections.Counter(r['style_label'] for r in decisions if hints[r['message_id']]['priority']==priority))
        report['size_policy'] = {key:sum(r[key] for r in hints.values()) for key in ['over_character_policy','over_word_policy']}
        report['limitations'] = ['One Luna model pass per full message; model labels are triage, not independent human ground truth.', 'Historical duplicate bodies and wrapper variants are distinct bodies, not delivery counts.', 'All handoff inputs reviewed; this run supplies no untouched test set for later rule tuning. Existing split assignments are preserved.']
        private_json(RUN/'summary.json',report)
    print(json.dumps(report,indent=2))


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='action',required=True)
    prep=sub.add_parser('prepare'); prep.add_argument('--batches',type=int,default=24)
    view=sub.add_parser('page'); view.add_argument('batch',type=int); view.add_argument('number',type=int)
    rec=sub.add_parser('record'); rec.add_argument('batch',type=int); rec.add_argument('decisions',type=Path)
    val=sub.add_parser('validate'); val.add_argument('--complete',action='store_true')
    args=parser.parse_args()
    if args.action=='prepare': prepare(args.batches)
    elif args.action=='page': page(args.batch,args.number)
    elif args.action=='record': record(args.batch,args.decisions)
    else: validate(args.complete)
