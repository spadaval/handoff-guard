#!/usr/bin/env python3
"""Evaluate every recovered body with the compiled guard; keep raw results private.

prepare freezes connected-thread splits BEFORE tuning. No automatic style labels
are ground truth. Manual labels live separately and survive corpus regeneration.
"""
import argparse
import collections
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / 'data/private'
WORKER = {'worker_assistant_output', 'worker_commentary', 'worker_final_answer', 'worker_report', 'cached_worker_report', 'completion_notification'}
INPUTS = {'assignment', 'agent_message', 'followup_assignment', 'cached_agent_message', 'agent_delivery'}


def read(name):
    return [json.loads(line) for line in (PRIVATE / name).open()]


def write_private(name, rows):
    path = PRIVATE / name
    with path.open('w') as out:
        os.chmod(path, 0o600)
        for row in rows:
            out.write(json.dumps(row, ensure_ascii=False) + '\n')


def prepare():
    if (PRIVATE / 'split.jsonl').exists():
        raise SystemExit('split.jsonl already exists; refusing to change a reserved set')
    messages, observations = read('messages.jsonl'), read('observations.jsonl')
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
                     'split': 'heldout' if int(component[:8], 16) % 5 == 0 else 'tuning'})
    write_private('split.jsonl', rows)
    print(json.dumps({'bodies': dict(collections.Counter(r['split'] for r in rows)),
                      'thread_components': len(groups), 'threads': len(parent)}, indent=2))


def evaluate(binary, output):
    manifest = json.loads((PRIVATE / 'manifest.json').read_text())
    for name in ['messages.jsonl', 'observations.jsonl']:
        assert hashlib.sha256((PRIVATE / name).read_bytes()).hexdigest() == manifest['files'][name]['sha256'], 'Corpus checksum mismatch'
    messages = read('messages.jsonl')
    split = {r['message_id']: r['split'] for r in read('split.jsonl')}
    labels = {r['message_id']: r for r in read('labels.jsonl')} if (PRIVATE / 'labels.jsonl').exists() else {}
    message_ids = {r['message_id'] for r in messages}
    assert split.keys() == message_ids, 'Reserved split does not match this corpus'
    assert labels.keys() <= message_ids, 'Labels reference unknown bodies'
    assert all(r['style_label'] in {'normal', 'pathological', 'ambiguous'} for r in labels.values()), 'Unknown style label'
    with (PRIVATE / 'messages.jsonl').open() as inp:
        run = subprocess.run([str(binary), 'evaluate'], stdin=inp, capture_output=True, text=True, check=True)
    predictions = [json.loads(line) for line in run.stdout.splitlines()]
    assert len(predictions) == len(messages)
    by_id = {r['message_id']: r for r in predictions}
    assert by_id.keys() == {r['message_id'] for r in messages}
    report = {'manifest_sha256': hashlib.sha256((PRIVATE / 'manifest.json').read_bytes()).hexdigest(),
              'binary_sha256': hashlib.sha256(binary.read_bytes()).hexdigest(),
              'policy': {'characters': 12000, 'words': 1500}, 'groups': {},
              'annotation_limit': '80 opening excerpts reviewed by the implementation agent. This is not independent full-message ground truth. Heldout excerpts were previewed before narrowing the path exemption; final heldout scores are exploratory, not a blind estimate.',
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
    write_private('evaluation.jsonl', details)
    output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'evaluate'])
    parser.add_argument('--binary', type=Path, default=ROOT / 'target/release/handoff-guard')
    parser.add_argument('--output', type=Path, default=ROOT / 'data/evaluation.json')
    args = parser.parse_args()
    prepare() if args.action == 'prepare' else evaluate(args.binary, args.output)
