#!/usr/bin/env python3
"""Audit index drift, prepare blind Luna re-reviews, and consolidate full coverage."""
import argparse
import collections
import hashlib
import json
import os
from pathlib import Path
import re

from triage_handoffs import RUN, SOURCE, ISSUES, read_jsonl, private_json, private_jsonl


def primary():
    rows = []
    for path in sorted((RUN/'labels').glob('*.jsonl')):
        rows.extend(read_jsonl(path))
    assert len(rows)==len({r['message_id'] for r in rows}), 'Duplicate primary label IDs'
    return {r['message_id']:r for r in rows}


def prepare(count):
    assert not (RUN/'repair-manifest.json').exists(), 'Re-review inputs already frozen'
    manifest = json.loads((RUN/'manifest.json').read_text())
    old = primary()
    targets, sources, defects = {}, {}, []
    for batch in manifest['batches']:
        number = batch['batch']
        data = json.loads((RUN/'batches'/f'{number:02d}.json').read_text())
        for page in data['pages']:
            for row in page:
                sources[row['message_id']] = {**row, 'primary_batch':number}
                if row['message_id'] not in old:
                    targets[row['message_id']] = 'missing_primary_review'
        if number in {0,3,8,10}:
            # Severe global offset errors or explicit reviewer disclaimer.
            for page in data['pages']:
                for row in page:
                    targets[row['message_id']] = 'quarantined_primary_batch'
        for path in RUN.glob(f'decisions-{number:02d}-*.json'):
            match = re.fullmatch(r'decisions-\d+-(\d+)\.json',path.name)
            if not match:
                continue
            page_number = int(match[1])
            if page_number >= len(data['pages']):
                continue
            expected = {r['index'] for r in data['pages'][page_number]}
            rows = json.loads(path.read_text())
            found = {r['index'] for r in rows}
            if found != expected:
                affected = expected | found
                defects.append({'batch':number,'page':page_number,'indices':sorted(affected)})
                for page in data['pages']:
                    for row in page:
                        if row['index'] in affected:
                            targets[row['message_id']] = 'page_index_drift'
    # Small independent calibration check, stratified within primary reviewer/label.
    audit = []
    for batch in manifest['batches']:
        for style in ['normal','pathological','ambiguous']:
            available = [r for r in old.values() if r['batch']==batch['batch'] and r['style_label']==style and r['message_id'] not in targets]
            for row in sorted(available,key=lambda r:hashlib.sha256(('audit-v1:'+r['message_id']).encode()).hexdigest())[:2]:
                targets[row['message_id']] = 'calibration_audit'
                audit.append(row['message_id'])
    bins = [[] for _ in range(count)]
    sizes = [0]*count
    for mid in sorted(targets,key=lambda m:(-sources[m]['characters'],m)):
        number = min(range(count), key=lambda n:(sizes[n],n))
        bins[number].append(sources[mid]); sizes[number] += sources[mid]['characters']
    batches=[]
    for number, rows in enumerate(bins):
        rows.sort(key=lambda r:r['message_id'])
        pages, current, size = [], [], 0
        for row in rows:
            if current and size + row['characters'] > 14000:
                pages.append(current);current=[];size=0
            current.append(row);size+=row['characters']
        if current: pages.append(current)
        private_json(RUN/'repair-inputs'/f'{number:02d}.json',{'pages':pages})
        batches.append({'batch':number,'messages':len(rows),'pages':len(pages),'characters':sizes[number]})
    private_json(RUN/'repair-manifest.json',{'batches':batches,'targets':targets,'calibration_ids':audit,'defects':defects,
        'reason':'Primary page/index drift is quarantined; fresh reviewers see source text without prior labels.'})
    print(json.dumps({'targets':len(targets),'reason_counts':dict(collections.Counter(targets.values())),'batches':batches},indent=2))


def page(number, page_number):
    data=json.loads((RUN/'repair-inputs'/f'{number:02d}.json').read_text())
    rows=data['pages'][page_number]
    private_json(RUN/'repair-views'/f'{number:02d}-{page_number:02d}.json',{'message_ids':[r['message_id'] for r in rows]})
    print(json.dumps({'repair_batch':number,'page':page_number,'total_pages':len(data['pages']),'messages':rows},ensure_ascii=False))


def record(number, page_number, path):
    data=json.loads((RUN/'repair-inputs'/f'{number:02d}.json').read_text())
    lookup={r['message_id']:r for r in data['pages'][page_number]}
    rows=json.loads(path.read_text())
    assert len(rows)==len(lookup) and {r['message_id'] for r in rows}==lookup.keys(), 'Use exact message_id values for this page, once each'
    assert (RUN/'repair-views'/f'{number:02d}-{page_number:02d}.json').exists(),'Read the full page first'
    target=RUN/'repairs'/f'{number:02d}-{page_number:02d}.jsonl'
    assert not target.exists(),'Page already recorded; never silently overwrite'
    for row in rows:
        source=lookup[row['message_id']]
        assert row['style_label'] in {'normal','pathological','ambiguous'}
        assert row['confidence'] in {'high','medium','low'}
        assert set(row['issues']) <= ISSUES
        assert isinstance(row['rationale'],str) and 12<=len(row['rationale'])<=700
        assert row['full_message_reviewed'] is True
        if row['style_label']=='normal': assert not row['issues']
        if row['style_label']=='pathological': assert row['issues']
        row.update({'index':source['index'],'batch':source['primary_batch'],'reviewer':f'gpt-6-luna:repair-{number:02d}',
                    'repair_batch':number,'reviewed_characters':source['characters'],'review_depth':'full_message'})
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with target.open('x') as out:
        os.chmod(target,0o600)
        for row in rows:
            out.write(json.dumps(row,ensure_ascii=False)+'\n')
    print(json.dumps({'repair_batch':number,'page':page_number,'recorded':len(rows)}))


def finalize(public_report=None):
    manifest=json.loads((RUN/'manifest.json').read_text())
    repair_manifest=json.loads((RUN/'repair-manifest.json').read_text())
    old=primary(); repairs=[]
    for batch in repair_manifest['batches']:
        for p in range(batch['pages']):
            path=RUN/'repairs'/f"{batch['batch']:02d}-{p:02d}.jsonl"
            assert path.exists(),f'Missing re-review {path.name}'
            repairs.extend(read_jsonl(path))
    corrected={r['message_id']:r for r in repairs}
    assert len(corrected)==len(repairs) and corrected.keys()==repair_manifest['targets'].keys()
    labels={**old,**corrected}
    # Preserve disagreement on the independent calibration sample as uncertainty.
    disagreements=[]
    for mid in repair_manifest['calibration_ids']:
        if old[mid]['style_label'] != corrected[mid]['style_label']:
            disagreements.append(mid)
            labels[mid]={**corrected[mid], 'style_label':'ambiguous','confidence':'low',
                         'rationale':'Independent full-message Luna reviewers disagreed; retain ambiguity rather than forcing a binary label.',
                         'reviewer_disagreement':[old[mid]['style_label'],corrected[mid]['style_label']],
                         'issues':sorted(set(old[mid]['issues']) | set(corrected[mid]['issues']))}
    expected={m for b in manifest['batches'] for m in b['message_ids']}
    assert labels.keys()==expected and len(labels)==manifest['messages']
    for batch in manifest['batches']:
        for p in range(batch['pages']):
            if not (RUN/'views'/f"{batch['batch']:02d}-{p:02d}.json").exists():
                source=json.loads((RUN/'batches'/f"{batch['batch']:02d}.json").read_text())
                assert all(r['message_id'] in corrected for r in source['pages'][p]), 'Missing full-message read coverage'
    for batch in repair_manifest['batches']:
        source=json.loads((RUN/'repair-inputs'/f"{batch['batch']:02d}.json").read_text())
        for p, rows in enumerate(source['pages']):
            receipt=json.loads((RUN/'repair-views'/f"{batch['batch']:02d}-{p:02d}.json").read_text())
            assert set(receipt['message_ids'])=={r['message_id'] for r in rows}, 'Wrong re-review read receipt'
            actual=read_jsonl(RUN/'repairs'/f"{batch['batch']:02d}-{p:02d}.jsonl")
            assert len(actual)==len(rows) and {r['message_id'] for r in actual}==set(receipt['message_ids']), 'Wrong re-review output IDs'

    # Wrapper-only variants share the same underlying message. Inconsistent
    # votes are uncertainty, not evidence of different underlying readability.
    families=collections.defaultdict(list)
    for source in read_jsonl(RUN/'inputs.jsonl'):
        body=re.sub(r'^Act as the [^\n]{1,60} sub-agent for this task\.\s*\n','',source['text'])
        families[hashlib.sha256(body.encode()).hexdigest()].append(source['message_id'])
    family_disagreements=[]
    for mids in families.values():
        votes={labels[mid]['style_label'] for mid in mids}
        if len(votes)>1:
            family_disagreements.append(mids)
            for mid in mids:
                labels[mid]={**labels[mid], 'style_label':'ambiguous','confidence':'low',
                             'rationale':'Wrapper-only variants received inconsistent Luna style judgments; retain ambiguity.',
                             'family_disagreement':True,'family_votes':sorted(votes)}
    adjudications=RUN/'adjudications.jsonl'
    if adjudications.exists():
        for row in read_jsonl(adjudications):
            assert row['message_id'] in labels
            labels[row['message_id']]={**labels[row['message_id']],**row}
    hints={r['message_id']:r for r in read_jsonl(RUN/'heuristics.jsonl')}
    by_priority={priority:dict(collections.Counter(r['style_label'] for m,r in labels.items() if hints[m]['priority']==priority))
                 for priority in ['ordinary_candidate','needs_context','suspicious']}
    matrix=collections.Counter()
    for mid in repair_manifest['calibration_ids']:
        matrix[old[mid]['style_label']+' -> '+corrected[mid]['style_label']]+=1
    report={'scope':manifest['scope'],'reviewed':len(labels),'expected':manifest['messages'],'missing':0,
            'style_counts':dict(collections.Counter(r['style_label'] for r in labels.values())),
            'confidence_counts':dict(collections.Counter(r['confidence'] for r in labels.values())),
            'issue_counts':dict(collections.Counter(i for r in labels.values() for i in r['issues'])),
            'heuristic_counts':manifest['heuristic_counts'],'style_by_heuristic':by_priority,
            'size_policy':{k:sum(r[k] for r in hints.values()) for k in ['over_character_policy','over_word_policy']},
            're_reviewed':len(repairs),'repair_reason_counts':dict(collections.Counter(repair_manifest['targets'].values())),
            'calibration_audit':{'messages':len(repair_manifest['calibration_ids']),'transitions':dict(matrix),'disagreements_retained_ambiguous':len(disagreements),'selection':'two per available initial label per primary batch; stratified, not prevalence weighted'},
            'wrapper_family_consistency':{'families':len(families),'inconsistent_families':len(family_disagreements),'bodies_retained_ambiguous':sum(map(len,family_disagreements))},
            'source_manifest_sha256':manifest['source_manifest_sha256'],
            'limitations':['Luna model triage, not human ground truth. Readability thresholds remain subjective.',
                            'Every input has a full-message review; re-review replaces quarantined mapping errors and fills missing primary labels.',
                            'All inputs are now exposed to triage; there is no untouched test set for new rule tuning.',
                            'Distinct bodies, not deliveries; wrapper-only variants count separately; size policy is separate from style.']}
    assert all(len({labels[mid]['style_label'] for mid in mids})==1 for mids in families.values()), 'Adjudication split a wrapper family'
    report['wrapper_family_counts']=dict(collections.Counter(labels[mids[0]]['style_label'] for mids in families.values()))
    report['percentages']={k:round(v/len(labels)*100,2) for k,v in report['style_counts'].items()}
    inputs=read_jsonl(RUN/'inputs.jsonl')
    report['style_by_size_policy']={key:dict(collections.Counter(labels[r['message_id']]['style_label'] for r in inputs
                                     if (r['characters']>12000 or r['words']>1500)==over))
                                    for key,over in [('within_limits',False),('over_limits',True)]}
    report['date']='2026-11-23'
    report['spot_audit']={'complete_messages_checked':6,'pathological_to_normal_corrections':1,
                          'reviewer':'gpt-6.1-sol','note':'Small qualitative check; not an independent accuracy estimate.'}
    private_jsonl(RUN/'labels-full.jsonl',sorted(labels.values(),key=lambda r:r['message_id']))
    report['labels_sha256']=hashlib.sha256((RUN/'labels-full.jsonl').read_bytes()).hexdigest()
    private_json(RUN/'summary.json',report)
    if public_report:
        public_report.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='action',required=True)
    prep=sub.add_parser('prepare');prep.add_argument('--batches',type=int,default=8)
    view=sub.add_parser('page');view.add_argument('batch',type=int);view.add_argument('page',type=int)
    rec=sub.add_parser('record');rec.add_argument('batch',type=int);rec.add_argument('page',type=int);rec.add_argument('file',type=Path)
    finish=sub.add_parser('finalize');finish.add_argument('--public-report',type=Path);a=parser.parse_args()
    if a.action=='prepare':prepare(a.batches)
    elif a.action=='page':page(a.batch,a.page)
    elif a.action=='record':record(a.batch,a.page,a.file)
    else:finalize(a.public_report)
