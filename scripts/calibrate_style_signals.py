#!/usr/bin/env python3
"""Calibrate compiled signals in SQLite using checked-in sampling configuration."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

import context_database as corpus
import research_store as store

ROOT = corpus.ROOT


def prepare(db, run_id, binary, config_path, baseline_run):
    if db.execute('SELECT 1 FROM analysis_runs WHERE run_id=?',(run_id,)).fetchone():
        raise ValueError('Experiment already frozen; choose a new --run')
    config = json.loads(config_path.read_text())
    rows = list(db.execute('SELECT m.*,s.record_json split_record FROM messages m JOIN splits s USING(message_id) ORDER BY message_id'))
    if len(rows) != db.execute('SELECT count(*) FROM messages').fetchone()[0]:
        raise ValueError('Freeze a complete thread split before calibration')
    old = {r['message_id']:r for r in store.records(db,baseline_run,'prediction')}
    if set(old) != {r['message_id'] for r in rows}:
        raise ValueError('Baseline must cover this entire corpus')
    new = store.compiled(db,binary,'evaluate')
    differences = sum(old[r['message_id']] != r for r in new)
    if differences:
        raise ValueError(f'Denial policy changed on {differences} bodies')
    reports = store.compiled(db,binary,'inspect')
    report_by_id = {r['message_id']:r for r in reports}
    records = []
    for row in rows:
        split = json.loads(row['split_record'])
        checks = {c['rule']:c for c in report_by_id[row['message_id']]['checks']}
        records.append({'message_id':row['message_id'],'is_input':bool(row['is_input']),
                        'split':split['split'],'component':split['component'],'characters':row['characters'],
                        'signals':{rule:checks[rule] for rule in config['rules']}})
    eligible = [r for r in records if r['is_input'] and r['characters'] <= config['maximum_characters']]
    text_by_id = {r['message_id']:r['text'] for r in rows}
    sampled = []
    for split in config['splits']:
        chosen = set()
        for rule in config['rules']:
            pool = [r for r in eligible if r['split']==split and r['signals'][rule]['status']=='warn']
            pool.sort(key=lambda r:corpus.digest(config['seed']+r['message_id']))
            unique = set()
            for row in pool:
                signature = re.sub(r'[0-9]+','N',text_by_id[row['message_id']])
                if signature in unique:
                    continue
                unique.add(signature)
                chosen.add(row['message_id'])
                if len(unique) == config['hits_per_rule_per_split']:
                    break
        controls = [r for r in eligible if r['split']==split and not any(s['status']=='warn' for s in r['signals'].values())]
        controls.sort(key=lambda r:corpus.digest(config['control_seed']+r['message_id']))
        chosen.update(r['message_id'] for r in controls[:config['controls_per_split']])
        sampled.extend(r for r in records if r['message_id'] in chosen)
    components = [{r['component'] for r in sampled if r['split']==split} for split in config['splits']]
    if len(components)==2 and components[0] & components[1]:
        raise ValueError('Thread components overlap')
    metadata = {'config_path':str(config_path.relative_to(ROOT)) if config_path.is_relative_to(ROOT) else str(config_path),
                'config_sha256':corpus.checksum(config_path),'rubric_sha256':corpus.checksum(ROOT/config['rubric']),
                'source_sha256':corpus.checksum(ROOT/'src/style_signals.rs'),
                'binary_sha256':corpus.checksum(binary),'baseline_run':baseline_run,
                'corpus_bodies':len(rows),'sample_count':len(sampled),'policy_differences':differences}
    with db:
        store.create_run(db,run_id,'style-calibration',metadata)
        for result in reports:
            store.put(db,run_id,'inspection',result['message_id'],result,result['message_id'])
        for row in sampled:
            store.put(db,run_id,'sample',row['message_id'],row,row['message_id'])
    return metadata


def frozen(db,run_id,check_source=False):
    row = db.execute("SELECT metadata_json FROM analysis_runs WHERE run_id=? AND kind='style-calibration'",(run_id,)).fetchone()
    if not row:
        raise ValueError('Unknown calibration run')
    metadata = json.loads(row[0])
    if check_source and metadata['source_sha256'] != corpus.checksum(ROOT/'src/style_signals.rs'):
        raise ValueError('Rules changed after experiment was frozen; start a new run')
    return metadata


def label(db,run_id,split,labels):
    frozen(db,run_id,check_source=True)
    sample = [r for r in store.records(db,run_id,'sample') if r['split']==split]
    expected = {r['message_id'] for r in sample}
    if not expected or len(labels)!=len(expected) or {r['message_id'] for r in labels}!=expected:
        raise ValueError('Labels must cover the exact frozen split once each')
    for record in labels:
        if record.get('style_label') not in {'normal','pathological','ambiguous'}:
            raise ValueError('Invalid style label')
        if any(record.get(rule) not in {'present','absent','ambiguous'} for rule in ['punctuation_spacing','needless_shorthand']):
            raise ValueError('Label each signal as present, absent, or ambiguous')
        if not record.get('note') or not record.get('reviewer'):
            raise ValueError('Provide a note and reviewer')
    with db:
        for record in labels:
            store.put(db,run_id,'label',record['message_id'],record,record['message_id'])
    return {'recorded':len(labels),'split':split}


def summarize(db,run_id):
    metadata = frozen(db,run_id)
    sample = {r['message_id']:r for r in store.records(db,run_id,'sample')}
    labels = {r['message_id']:r for r in store.records(db,run_id,'label')}
    if not sample or sample.keys()!=labels.keys():
        raise ValueError('Manual review coverage mismatch')
    result = {'corpus':metadata,'results':{},'limitations':['Targeted calibration sample, not a prevalence or corpus accuracy estimate.','Preserve ambiguous labels; this command does not promote signals to blocking.']}
    for split in ['tuning','heldout']:
        selected = [mid for mid,r in sample.items() if r['split']==split]
        summary = {'messages':len(selected),'thread_components':len({sample[mid]['component'] for mid in selected})}
        for rule in ['punctuation_spacing','needless_shorthand']:
            counts = dict.fromkeys(['true_positive','false_positive','true_negative','miss','ambiguous'],0)
            for mid in selected:
                predicted = sample[mid]['signals'][rule]['status']=='warn'
                truth = labels[mid][rule]
                key = 'ambiguous' if truth=='ambiguous' else 'true_positive' if truth=='present' and predicted else 'miss' if truth=='present' else 'false_positive' if predicted else 'true_negative'
                counts[key] += 1
            summary[rule] = counts
        result['results'][split] = summary
    with db:
        store.put(db,run_id,'report','evaluation-sqlite-v1',result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['prepare','show','label','summarize'])
    parser.add_argument('--database',type=Path,default=store.DATABASE)
    parser.add_argument('--run',required=True)
    parser.add_argument('--config',type=Path,default=ROOT/'config/calibration.json')
    parser.add_argument('--binary',type=Path,default=ROOT/'target/release/handoff-guard')
    parser.add_argument('--baseline-run',default='pre-style-signals-policy')
    parser.add_argument('--split',choices=['tuning','heldout'],default='tuning')
    args = parser.parse_args()
    db = corpus.connect(args.database)
    try:
        if args.command=='prepare':
            result = prepare(db,args.run,args.binary,args.config,args.baseline_run)
        elif args.command=='summarize':
            result = summarize(db,args.run)
        elif args.command=='label':
            result = label(db,args.run,args.split,json.load(sys.stdin))
        else:
            frozen(db,args.run,check_source=True)
            result = []
            for record in store.records(db,args.run,'sample'):
                if record['split']==args.split:
                    result.append({**record,'text':db.execute('SELECT text FROM messages WHERE message_id=?',(record['message_id'],)).fetchone()[0]})
        print(corpus.js(result))
    finally:
        db.close()


if __name__=='__main__':
    main()
