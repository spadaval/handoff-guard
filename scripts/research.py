#!/usr/bin/env python3
"""Inspect local research and record reviews without exporting working files."""
import argparse
import json
from pathlib import Path
import sys

import context_database as corpus
import research_store as store


def sample(db,run_id,count,config_path,reviewer):
    config = json.loads(config_path.read_text())
    if count < 1:
        raise ValueError('Sample count must be positive')
    if db.execute('SELECT 1 FROM analysis_runs WHERE run_id=?',(run_id,)).fetchone():
        raise ValueError('Review sample is already frozen')
    rows = list(db.execute('SELECT m.message_id,s.record_json FROM messages m JOIN splits s USING(message_id) WHERE m.is_input=1 ORDER BY m.message_id'))
    rows.sort(key=lambda r:corpus.digest(str(config['seed'])+r['message_id']))
    if count > len(rows):
        raise ValueError('Requested sample exceeds available inputs')
    with db:
        store.create_run(db,run_id,'manual-review',{'config_path':str(config_path),'config_sha256':corpus.checksum(config_path),
                         'rubric_path':config['rubric'],'rubric_sha256':corpus.checksum(corpus.ROOT/config['rubric']),
                         'reviewer':reviewer,'sample_count':count})
        for row in rows[:count]:
            mid = row['message_id']
            # Pick one recorded context; preserve its recovery gaps rather than assert recipient knowledge.
            context = db.execute('SELECT context_id FROM contexts WHERE message_id=? ORDER BY CASE status WHEN \'recovered\' THEN 0 WHEN \'partial\' THEN 1 ELSE 2 END,context_id LIMIT 1',(mid,)).fetchone()
            record = {'message_id':mid,'context_id':context[0] if context else None,**json.loads(row['record_json'])}
            store.put(db,run_id,'sample',mid,record,mid)
    return {'run_id':run_id,'sample_count':count}


def record_review(db,run_id,record):
    mid = record['message_id']
    sample_row = db.execute("SELECT record_json FROM analysis_records WHERE run_id=? AND kind='sample' AND message_id=?",(run_id,mid)).fetchone()
    if not sample_row:
        raise ValueError('Message is outside the frozen sample')
    sample = json.loads(sample_row[0])
    if record.get('context_id') != sample.get('context_id') or record.get('full_message_reviewed') is not True:
        raise ValueError('Review must identify its frozen context and confirm full-body reading')
    for key in ['information_selection','presentation']:
        value = record.get(key,{})
        score = value.get('score')
        if (score is not None and (type(score) is not int or not 1 <= score <= 5)) or not value.get('reason'):
            raise ValueError('Use score 1–5 or null with a reason for '+key)
        if score is not None and score < 5 and not value.get('issues'):
            raise ValueError('Scores 1–4 require a quoted issue and repair')
        text = db.execute('SELECT text FROM messages WHERE message_id=?',(mid,)).fetchone()[0]
        for issue in value.get('issues',[]):
            if not issue.get('quote') or issue['quote'] not in text or not issue.get('effect') or not issue.get('repair'):
                raise ValueError('Issues require an exact body quote, effect and repair')
    if not record.get('classification',{}).get('task') or not record.get('purpose',{}).get('reason'):
        raise ValueError('State the situation and intent before grading')
    known = {r[0] for r in db.execute('SELECT evidence_id FROM context_evidence WHERE context_id=?',(sample.get('context_id'),))}
    if not set(record.get('evidence_ids',[])) <= known:
        raise ValueError('Evidence belongs to another context')
    with db:
        store.put(db,run_id,'review',mid,record,mid)
    return {'recorded':mid}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--database',type=Path,default=store.DATABASE)
    sub = p.add_subparsers(dest='command',required=True)
    sub.add_parser('runs')
    a = sub.add_parser('records'); a.add_argument('run'); a.add_argument('kind'); a.add_argument('--key')
    a = sub.add_parser('archive'); a.add_argument('path')
    sub.add_parser('archives')
    a = sub.add_parser('message'); a.add_argument('message_id'); a.add_argument('--context')
    a = sub.add_parser('sample'); a.add_argument('run'); a.add_argument('--count',type=int,default=30); a.add_argument('--reviewer',required=True); a.add_argument('--config',type=Path,default=corpus.ROOT/'config/review.json')
    a = sub.add_parser('record'); a.add_argument('run')
    args = p.parse_args()
    db = corpus.connect(args.database)
    try:
        if args.command=='runs':
            result = [dict(r) for r in db.execute('SELECT * FROM analysis_runs ORDER BY created_at,run_id')]
            result += [dict(r) for r in db.execute('SELECT * FROM review_runs ORDER BY created_at,run_id')]
            result += [dict(r) for r in db.execute('SELECT * FROM mechanical_runs ORDER BY created_at,run_id')]
        elif args.command=='records':
            if args.key:
                row = db.execute('SELECT record_json FROM analysis_records WHERE run_id=? AND kind=? AND record_key=?',(args.run,args.kind,args.key)).fetchone()
                if row is None: raise ValueError('Unknown record')
                result = json.loads(row[0])
            else: result = store.records(db,args.run,args.kind)
        elif args.command=='archives':
            result = [dict(r) for r in db.execute('SELECT f.path,f.category,b.sha256,b.bytes FROM archived_files f JOIN archived_blobs b USING(sha256) ORDER BY f.path')]
        elif args.command=='archive':
            sys.stdout.buffer.write(store.archived_bytes(db,args.path))
            return
        elif args.command=='sample':
            result = sample(db,args.run,args.count,args.config,args.reviewer)
        elif args.command=='record':
            result = record_review(db,args.run,json.load(sys.stdin))
        else:
            row = db.execute('SELECT * FROM messages WHERE message_id=?',(args.message_id,)).fetchone()
            if row is None: raise ValueError('Unknown message')
            result = dict(row)
            result['contexts'] = [dict(r) for r in db.execute('SELECT * FROM contexts WHERE message_id=? ORDER BY context_id',(args.message_id,))]
            if args.context:
                if args.context not in {c['context_id'] for c in result['contexts']}:
                    raise ValueError('Context is not bound to this message')
                result['evidence'] = [dict(r) for r in db.execute('SELECT e.* FROM evidence e JOIN context_evidence ce USING(evidence_id) WHERE ce.context_id=?',(args.context,))]
                result['references'] = [dict(r) for r in db.execute('SELECT * FROM context_references WHERE context_id=?',(args.context,))]
        print(corpus.js(result))
    finally:
        db.close()


if __name__ == '__main__':
    main()
