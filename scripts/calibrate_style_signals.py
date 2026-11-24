#!/usr/bin/env python3
"""Freeze a thread-split advisory-check calibration set and compare compiled policy."""
import argparse
import hashlib
import json
import re
from pathlib import Path
import sqlite3
import subprocess

ROOT = Path(__file__).resolve().parents[1]
DEFAULT = ROOT / 'data/private/style-signals-v3'


def prepare(directory, binary, baseline):
    if (directory/'rule-freeze.json').exists():
        raise ValueError('This calibration is frozen; use a new --directory for another experiment')
    directory.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(f'file:{ROOT}/data/private/handoffs.sqlite3?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    rows = list(db.execute('SELECT m.*,s.record_json split_record FROM messages m JOIN splits s USING(message_id) ORDER BY message_id'))
    source = directory / 'inspection-input.jsonl'
    with source.open('w') as f:
        for row in rows:
            assert hashlib.sha256(row['text'].encode()).hexdigest() == row['message_id']
            f.write(json.dumps({'message_id': row['message_id'], 'text': row['text']})+'\n')
    with source.open() as stdin, (directory/'inspection.jsonl').open('w') as stdout:
        subprocess.run([str(binary), 'inspect'], stdin=stdin, stdout=stdout, check=True)
    old, new = {}, {}
    for executable, target in [(baseline, old), (binary, new)]:
        with source.open() as stdin:
            output = subprocess.run([str(executable), 'evaluate'], stdin=stdin, text=True, capture_output=True, check=True)
        target.update({r['message_id']: r for r in map(json.loads, output.stdout.splitlines())})
    differences = [mid for mid in old if old[mid] != new[mid]]
    if differences:
        raise ValueError(f'Denial policy changed on {len(differences)} bodies')
    reports = {r['message_id']: r for r in map(json.loads, (directory/'inspection.jsonl').read_text().splitlines())}
    records = []
    for row in rows:
        split = json.loads(row['split_record'])
        signals = {c['rule']: c for c in reports[row['message_id']]['checks'] if c.get('enforcement') == 'advisory'}
        records.append({'message_id': row['message_id'], 'is_input': bool(row['is_input']), 'split': split['split'], 'component': split['component'], 'characters': row['characters'], 'signals': signals})
    (directory/'signals.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in records))
    sampled = []
    # Bound manual-reading burden; this is calibration, not a prevalence sample.
    eligible = [r for r in records if r['is_input'] and r['characters'] <= 8000]
    for split in ['tuning', 'heldout']:
        chosen = set()
        for rule in ['punctuation_spacing', 'needless_shorthand']:
            pool = [r for r in eligible if r['split'] == split and r['signals'][rule]['status'] == 'warn']
            pool.sort(key=lambda r: hashlib.sha256(('signals-v1-'+r['message_id']).encode()).hexdigest())
            unique = set()
            for row in pool:
                text = next(m['text'] for m in rows if m['message_id']==row['message_id'])
                signature = re.sub(r'[0-9]+','N',text)
                if signature in unique:
                    continue
                unique.add(signature)
                chosen.add(row['message_id'])
                if len(unique)==3:
                    break
        controls = [r for r in eligible if r['split'] == split and not any(s['status'] == 'warn' for s in r['signals'].values())]
        controls.sort(key=lambda r: hashlib.sha256(('signals-control-'+r['message_id']).encode()).hexdigest())
        chosen.update(r['message_id'] for r in controls[:3])
        sampled.extend(r for r in records if r['message_id'] in chosen)
    assert not ({r['component'] for r in sampled if r['split']=='tuning'} & {r['component'] for r in sampled if r['split']=='heldout'})
    (directory/'sample.json').write_text(json.dumps(sampled, indent=2)+'\n')
    by_id = {r['message_id']:r for r in rows}
    for split in ['tuning','heldout']:
        views=[]
        for n, row in enumerate(r for r in sampled if r['split']==split):
            text=by_id[row['message_id']]['text']
            views.append({'index':n,'message_id':row['message_id'],'text':text,'signals':{k:{'matches':v['measurements']['matches'],'snippets':[text[s['start']:s['end']] for s in v['spans']]} for k,v in row['signals'].items()}})
        (directory/(split+'-review.json')).write_text(json.dumps(views,ensure_ascii=False,indent=2)+'\n')
    counts = {scope:{rule:sum(r['signals'][rule]['status']=='warn' for r in records if r['is_input']==scope) for rule in ['punctuation_spacing','needless_shorthand']} for scope in [True, False]}
    result={'corpus_bodies':len(rows),'input_bodies':sum(r['is_input'] for r in records),'worker_or_other_bodies':sum(not r['is_input'] for r in records),'flags_by_input_status':counts,'sample_count':len(sampled),'policy_differences':len(differences),'binary_sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'source_sha256':hashlib.sha256((ROOT/'src/style_signals.rs').read_bytes()).hexdigest(),'sample_scope':'seeded hits plus non-hit controls; inputs up to 8000 characters; existing thread-component splits'}
    (directory/'summary.json').write_text(json.dumps(result,indent=2)+'\n')
    source.unlink()
    return result

def summarize(directory):
    summary=json.loads((directory/'summary.json').read_text())
    freeze=json.loads((directory/'rule-freeze.json').read_text())
    if freeze['source_sha256'] != hashlib.sha256((ROOT/'src/style_signals.rs').read_bytes()).hexdigest():
        raise ValueError('Rules changed after tuning was frozen')
    sample={r['message_id']:r for r in json.loads((directory/'sample.json').read_text())}
    result={'corpus':summary,'reviewer':'One parent Codex model; full-body manual review; no independence claim','sample':{'selection':'Seeded signal hits and non-hit controls, inputs at most 8000 characters; not prevalence sampling','thread_components':{split:len({r['component'] for r in sample.values() if r['split']==split}) for split in ['tuning','heldout']}},'results':{}}
    for split in ['tuning','heldout']:
        labels=json.loads((directory/(split+'-labels.json')).read_text())
        if {r['message_id'] for r in labels}!={mid for mid,r in sample.items() if r['split']==split}:
            raise ValueError('Manual review coverage mismatch')
        result['results'][split]={'messages':len(labels),'style_labels':{label:sum(r['style_label']==label for r in labels) for label in ['normal','pathological','ambiguous']}}
        for rule in ['punctuation_spacing','needless_shorthand']:
            counts={'true_positive':0,'false_positive':0,'true_negative':0,'miss':0,'ambiguous':0}
            for label in labels:
                predicted=sample[label['message_id']]['signals'][rule]['status']=='warn'
                truth=label[rule]
                key='ambiguous' if truth=='ambiguous' else 'true_positive' if truth=='present' and predicted else 'miss' if truth=='present' else 'false_positive' if predicted else 'true_negative'
                counts[key]+=1
            result['results'][split][rule]=counts
    result['limitations']=['Small targeted sample; related near-duplicates remain; not a corpus precision/recall estimate','Broad semantic shorthand labels include forms beyond the two narrow recognizers','Heldout source was not retuned after manual inspection','New signals are advisory; existing deny outcomes are identical on all recoverable plaintext bodies']
    (directory/'evaluation.json').write_text(json.dumps(result,indent=2)+'\n')
    return result


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--directory',type=Path,default=DEFAULT)
    p.add_argument('--binary',type=Path,default=ROOT/'target/release/handoff-guard')
    p.add_argument('--baseline',type=Path,default=ROOT/'data/private/context-db-work/pre-style-signals-guard')
    p.add_argument('--summarize',action='store_true')
    a=p.parse_args()
    print(json.dumps(summarize(a.directory) if a.summarize else prepare(a.directory,a.binary,a.baseline)))
