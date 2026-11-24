#!/usr/bin/env python3
"""Freeze and validate blind Sol reviews without changing the Luna baseline."""
import argparse
import collections
import hashlib
import json
import os
from pathlib import Path
import random
import re
from statistics import NormalDist

from triage_handoffs import ROOT, ISSUES, read_jsonl

BASE = ROOT / 'data/private/triage-20261123'
RUN = ROOT / 'data/private/triage-sol-20261123'
STYLES = {'normal', 'pathological', 'ambiguous'}
MODEL = 'gpt-6.1-sol'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value, jsonl=False):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with path.open('x') as out:
        os.chmod(path, 0o600)
        if jsonl:
            for row in value:
                out.write(json.dumps(row, ensure_ascii=False) + '\n')
        else:
            json.dump(value, out, ensure_ascii=False, indent=2)
            out.write('\n')


def family(text):
    return hashlib.sha256(re.sub(r'^Act as the [^\n]{1,60} sub-agent for this task\.\s*\n', '', text).encode()).hexdigest()


def prepare(batches, sample_size, seed):
    assert batches > 0 and sample_size > 0
    assert not (RUN/'manifest.json').exists(), 'Review inputs already frozen'
    RUN.mkdir(mode=0o700, parents=True, exist_ok=True)
    prior = read_jsonl(BASE/'labels-full.jsonl')
    public = json.loads((ROOT/'data/triage.json').read_text())
    assert digest(BASE/'labels-full.jsonl') == public['labels_sha256'], 'Baseline changed'
    sources = {r['message_id']:r for r in read_jsonl(BASE/'inputs.jsonl')}
    assert set(sources) == {r['message_id'] for r in prior}
    rng = random.Random(seed)
    selected = [r for r in prior if r['style_label'] == 'ambiguous']
    for style in ['normal', 'pathological']:
        frame = sorted([r for r in prior if r['style_label'] == style], key=lambda r:r['message_id'])
        assert len(frame) >= sample_size
        selected.extend(rng.sample(frame, sample_size))
    groups = collections.defaultdict(list)
    for row in selected:
        source = sources[row['message_id']]
        groups[family(source['text'])].append({'message_id':source['message_id'], 'characters':len(source['text']), 'text':source['text']})
    bins = [[] for _ in range(batches)]
    sizes = [0]*batches
    for key, rows in sorted(groups.items(),key=lambda pair:(-sum(r['characters'] for r in pair[1]),pair[0])):
        number = min(range(batches),key=lambda n:(sizes[n],n))
        bins[number].extend(rows)
        sizes[number] += sum(r['characters'] for r in rows)
    index = []
    for number, rows in enumerate(bins):
        rows.sort(key=lambda r:hashlib.sha256((str(seed)+r['message_id']).encode()).hexdigest())
        pages, current, size = [], [], 0
        for row in rows:
            if current and size + row['characters'] > 12000:
                pages.append(current); current=[]; size=0
            current.append(row); size+=row['characters']
        if current:
            pages.append(current)
        save(RUN/'inputs'/f'{number:02d}.json',{'batch':number,'pages':pages})
        index.append({'batch':number,'messages':len(rows),'characters':sizes[number],'pages':len(pages),
                      'message_ids':[r['message_id'] for r in rows]})
    save(RUN/'selection.jsonl',[{'message_id':r['message_id'],'prior_style':r['style_label']} for r in selected],jsonl=True)
    manifest = {'model':MODEL,'seed':seed,'sample_size_per_definite_label':sample_size,
                'selection_method':'All ambiguous bodies; seeded uniform samples without replacement from sorted normal and pathological body IDs, in that stratum order.',
                'baseline_labels_sha256':digest(BASE/'labels-full.jsonl'), 'source_inputs_sha256':digest(BASE/'inputs.jsonl'),
                'baseline_counts':dict(collections.Counter(r['style_label'] for r in prior)),
                'selected_counts':dict(collections.Counter(r['style_label'] for r in selected)),
                'selected':len(selected),'characters':sum(sizes),'batches':index,
                'delegation_note':'User explicitly requested 6.1 Sol subagents. No multi-agent skill locator exists in the available catalog; explicit tool instructions apply. Capabilities were already checked in this thread; inherited model is gpt-6.1-sol.'}
    save(RUN/'manifest.json',manifest)
    print(json.dumps({k:v for k,v in manifest.items() if k not in {'batches','delegation_note'}},indent=2))
    print(json.dumps([{k:v for k,v in b.items() if k!='message_ids'} for b in index],indent=2))


def load_page(batch, page):
    data=json.loads((RUN/'inputs'/f'{batch:02d}.json').read_text())
    assert 0 <= page < len(data['pages']), 'Page numbers start at zero'
    return data, data['pages'][page]


def show_page(batch, page):
    data, rows=load_page(batch,page)
    receipt=RUN/'views'/f'{batch:02d}-{page:02d}.json'
    if not receipt.exists():
        save(receipt,{'message_ids':[r['message_id'] for r in rows],
                      'page_sha256':hashlib.sha256(json.dumps(rows,sort_keys=True).encode()).hexdigest()})
    print(json.dumps({'batch':batch,'page':page,'total_pages':len(data['pages']),'messages':rows},ensure_ascii=False))


def check_row(row):
    assert row['style_label'] in STYLES
    assert row['confidence'] in {'high','medium','low'}
    assert isinstance(row['issues'],list) and set(row['issues']) <= ISSUES
    assert isinstance(row['rationale'],str) and 12 <= len(row['rationale']) <= 700
    assert row['full_message_reviewed'] is True
    if row['style_label']=='normal':
        assert not row['issues']
    if row['style_label']=='pathological':
        assert row['issues']


def record(batch, page, path):
    _, sources=load_page(batch,page)
    rows=json.loads(path.read_text())
    lookup={r['message_id']:r for r in sources}
    assert isinstance(rows,list) and len(rows)==len(lookup)
    assert {r['message_id'] for r in rows}==lookup.keys(), 'Use exact full message IDs for every message on this page'
    receipt=RUN/'views'/f'{batch:02d}-{page:02d}.json'
    assert receipt.exists(), 'Read the complete page before recording'
    for row in rows:
        check_row(row)
        source=lookup[row['message_id']]
        row.update({'reviewer':f'{MODEL}:batch-{batch:02d}', 'requested_model':MODEL,
                    'batch':batch,'page':page,'review_depth':'full_message','reviewed_characters':len(source['text'])})
    save(RUN/'reviews'/f'{batch:02d}-{page:02d}.jsonl',rows,jsonl=True)
    print(json.dumps({'batch':batch,'page':page,'recorded':len(rows)}))


def wilson(agreed, n):
    # Unweighted within-stratum binomial interval; corpus dependence still limits interpretation.
    z=NormalDist().inv_cdf(0.975); rate=agreed/n; den=1+z*z/n
    center=(rate+z*z/(2*n))/den
    half=z*((rate*(1-rate)/n+z*z/(4*n*n))**0.5)/den
    return [round(center-half,4),round(center+half,4)]


def finalize(public_report=None):
    manifest=json.loads((RUN/'manifest.json').read_text())
    assert digest(BASE/'labels-full.jsonl')==manifest['baseline_labels_sha256'], 'Baseline labels changed'
    assert digest(BASE/'inputs.jsonl')==manifest['source_inputs_sha256'], 'Source bodies changed'
    selected={r['message_id']:r['prior_style'] for r in read_jsonl(RUN/'selection.jsonl')}
    originals={r['message_id']:r for r in read_jsonl(BASE/'inputs.jsonl')}
    reviewed=[]
    for batch in manifest['batches']:
        for page in range(batch['pages']):
            _, source=load_page(batch['batch'],page)
            assert all(r['text']==originals[r['message_id']]['text'] and r['characters']==len(r['text']) for r in source), 'Frozen page differs from the original full message'
            receipt=json.loads((RUN/'views'/f"{batch['batch']:02d}-{page:02d}.json").read_text())
            assert receipt['message_ids']==[r['message_id'] for r in source]
            assert receipt['page_sha256']==hashlib.sha256(json.dumps(source,sort_keys=True).encode()).hexdigest()
            rows=read_jsonl(RUN/'reviews'/f"{batch['batch']:02d}-{page:02d}.jsonl")
            assert len(rows)==len(source) and {r['message_id'] for r in rows}==set(receipt['message_ids'])
            for row in rows:
                check_row(row)
                assert row['reviewed_characters']==len(originals[row['message_id']]['text'])
                assert row['requested_model']==MODEL and row['batch']==batch['batch'] and row['page']==page
            reviewed.extend(rows)
    decisions={r['message_id']:r for r in reviewed}
    assert len(decisions)==len(reviewed)==manifest['selected'] and decisions.keys()==selected.keys()
    # Preserve raw Sol judgments as a separate pass. Sample disagreements are
    # flagged, not extrapolated to unsampled inputs or silently called errors.
    transitions={style:dict(collections.Counter(decisions[mid]['style_label'] for mid,old in selected.items() if old==style)) for style in ['ambiguous','normal','pathological']}
    gut={}
    for style in ['normal','pathological']:
        counts=transitions[style];n=sum(counts.values());agree=counts.get(style,0)
        gut[style]={'sample_size':n,'same_label':agree,'same_label_percent':round(agree/n*100,2),
                    'wilson_95_interval':wilson(agree,n),'sol_labels':counts}
    report={'model':MODEL,'selected':len(reviewed),'reviewed':len(reviewed),'missing':0,
            'baseline_counts':manifest['baseline_counts'],'selection_counts':manifest['selected_counts'],
            'seed':manifest['seed'],'selection_method':manifest['selection_method'],
            'transitions':transitions,'gut_check':gut,
            'confidence_counts':dict(collections.Counter(r['confidence'] for r in reviewed)),
            'baseline_labels_sha256':manifest['baseline_labels_sha256'],
            'limitations':['Independent model judgments, not human ground truth; disagreement is not a proven error.',
                            'Ambiguous cohort is a census; definite-label gut checks are random samples of distinct bodies, not deliveries.',
                            'Within-stratum intervals do not account for correlated threads and wrapper variants; never pool the two samples as a corpus accuracy estimate.',
                            'Original Luna baseline is unchanged. This pass does not tune or validate a rejection policy.']}
    # Reconciled ledger is explicitly provisional and never replaces the baseline.
    prior=read_jsonl(BASE/'labels-full.jsonl'); combined={r['message_id']:dict(r) for r in prior}
    for mid, row in decisions.items():
        old=selected[mid]
        if old=='ambiguous':
            combined[mid]={**row,'previous_style_label':old,'reconciliation':'Sol review of ambiguous input'}
            if row['confidence']=='low':
                combined[mid]['style_label']='ambiguous'
                combined[mid]['reconciliation']='Low-confidence Sol judgment retained ambiguous'
        elif row['style_label']!=old:
            combined[mid]={**row,'previous_style_label':old,'style_label':'ambiguous','reconciliation':'Definite-label gut-check disagreement retained ambiguous'}
    families=collections.defaultdict(list)
    for source in read_jsonl(BASE/'inputs.jsonl'):
        families[family(source['text'])].append(source['message_id'])
    inconsistent=[]
    for mids in families.values():
        if len({combined[mid]['style_label'] for mid in mids})>1:
            inconsistent.append(mids)
            for mid in mids:
                combined[mid]={**combined[mid],'style_label':'ambiguous','reconciliation':'Wrapper-family inconsistency retained ambiguous'}
    report['provisional_reconciled_counts']=dict(collections.Counter(r['style_label'] for r in combined.values()))
    report['wrapper_inconsistencies']={'families':len(inconsistent),'bodies':sum(map(len,inconsistent))}
    for name, rows in [('labels-sol.jsonl',reviewed),('labels-reconciled.jsonl',list(combined.values()))]:
        path=RUN/name
        if path.exists():
            assert read_jsonl(path)==sorted(rows,key=lambda r:r['message_id']), 'Refusing to replace a different finalized ledger'
        else:
            save(path,sorted(rows,key=lambda r:r['message_id']),jsonl=True)
    report['sol_labels_sha256']=digest(RUN/'labels-sol.jsonl')
    report['reconciled_labels_sha256']=digest(RUN/'labels-reconciled.jsonl')
    private=RUN/'summary.json'
    if private.exists():
        assert json.loads(private.read_text())==report, 'Final report already frozen with different data'
    else:
        save(private,report)
    if public_report:
        public_report.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='action',required=True)
    prep=sub.add_parser('prepare');prep.add_argument('--batches',type=int,default=24);prep.add_argument('--sample-size',type=int,default=100);prep.add_argument('--seed',type=int,default=20261123)
    page=sub.add_parser('page');page.add_argument('batch',type=int);page.add_argument('page',type=int)
    rec=sub.add_parser('record');rec.add_argument('batch',type=int);rec.add_argument('page',type=int);rec.add_argument('file',type=Path)
    finish=sub.add_parser('finalize');finish.add_argument('--public-report',type=Path)
    a=parser.parse_args()
    if a.action=='prepare':prepare(a.batches,a.sample_size,a.seed)
    elif a.action=='page':show_page(a.batch,a.page)
    elif a.action=='record':record(a.batch,a.page,a.file)
    else:finalize(a.public_report)
