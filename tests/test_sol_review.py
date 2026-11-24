"""Synthetic checks for blind sampling, exact IDs, and preservation of the baseline."""
import collections
import contextlib
import hashlib
import importlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/legacy'))
sol=importlib.import_module('review_sol')


class SolReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name); self.base=self.root/'base'; self.run=self.root/'review'
        self.base.mkdir(); (self.root/'data').mkdir()
        stack=contextlib.ExitStack(); self.addCleanup(stack.close)
        for name,value in [('ROOT',self.root),('BASE',self.base),('RUN',self.run)]:
            stack.enter_context(patch.object(sol,name,value))
        self.prior=[]; self.inputs=[]
        for style,n in [('normal',5),('pathological',5),('ambiguous',3)]:
            for number in range(n):
                text=f'Synthetic fixture {style} {number}.'
                mid=hashlib.sha256(text.encode()).hexdigest()
                self.prior.append({'message_id':mid,'style_label':style})
                self.inputs.append({'message_id':mid,'text':text,'characters':len(text),'words':len(text.split())})
        for name,rows in [('labels-full.jsonl',self.prior),('inputs.jsonl',self.inputs)]:
            (self.base/name).write_text(''.join(json.dumps(r)+'\n' for r in rows))
        self.before=(self.base/'labels-full.jsonl').read_bytes()
        (self.root/'data/triage.json').write_text(json.dumps({'labels_sha256':sol.digest(self.base/'labels-full.jsonl')}))

    def quiet(self,fn,*args):
        with contextlib.redirect_stdout(io.StringIO()):
            return fn(*args)

    def prepare(self):
        self.quiet(sol.prepare,2,2,37)
        return json.loads((self.run/'manifest.json').read_text())

    def decision_file(self,batch,page):
        _,sources=sol.load_page(batch,page)
        rows=[{'message_id':r['message_id'],'style_label':'normal','confidence':'high','issues':[],
               'rationale':'Synthetic readable fixture for testing the review ledger.','full_message_reviewed':True} for r in sources]
        path=self.root/f'decisions-{batch}-{page}.json';path.write_text(json.dumps(rows))
        return path

    def test_sampling_is_seeded_complete_for_ambiguous_and_blind(self):
        manifest=self.prepare()
        self.assertEqual(manifest['selected_counts'],{'ambiguous':3,'normal':2,'pathological':2})
        selection=(self.run/'selection.jsonl').read_bytes()
        for b in manifest['batches']:
            data=json.loads((self.run/'inputs'/f"{b['batch']:02d}.json").read_text())
            for page in data['pages']:
                for row in page:
                    self.assertEqual(set(row),{'message_id','characters','text'})
        with patch.object(sol,'RUN',self.root/'second-review'):
            self.quiet(sol.prepare,2,2,37)
            self.assertEqual((sol.RUN/'selection.jsonl').read_bytes(),selection)

    def test_record_requires_full_page_ids_and_refuses_overwrite(self):
        self.prepare();path=self.decision_file(0,0)
        with self.assertRaisesRegex(AssertionError,'complete page'):
            sol.record(0,0,path)
        self.quiet(sol.show_page,0,0)
        rows=json.loads(path.read_text()); rows[0]['message_id']='f'*64
        wrong=self.root/'wrong.json';wrong.write_text(json.dumps(rows))
        with self.assertRaisesRegex(AssertionError,'exact full message IDs'):
            sol.record(0,0,wrong)
        self.quiet(sol.record,0,0,path)
        with self.assertRaises(FileExistsError):
            sol.record(0,0,path)

    def test_finalize_checks_coverage_and_preserves_baseline(self):
        manifest=self.prepare()
        with self.assertRaises(FileNotFoundError):
            sol.finalize()
        for b in manifest['batches']:
            for page in range(b['pages']):
                self.quiet(sol.show_page,b['batch'],page)
                self.quiet(sol.record,b['batch'],page,self.decision_file(b['batch'],page))
        self.quiet(sol.finalize)
        report=json.loads((self.run/'summary.json').read_text())
        self.assertEqual(report['reviewed'],7)
        self.assertEqual(report['transitions'],{'ambiguous':{'normal':3},'normal':{'normal':2},'pathological':{'normal':2}})
        self.assertEqual(report['provisional_reconciled_counts'],{'normal':8,'pathological':3,'ambiguous':2})
        self.assertEqual((self.base/'labels-full.jsonl').read_bytes(),self.before)
        self.quiet(sol.finalize)  # Identical finalization is safe and deterministic.

    def test_frozen_pages_must_match_original_full_text(self):
        self.prepare()
        path=self.run/'inputs/00.json'
        data=json.loads(path.read_text())
        data['pages'][0][0]['text']+=' altered'
        data['pages'][0][0]['characters']=len(data['pages'][0][0]['text'])
        path.write_text(json.dumps(data))
        with self.assertRaisesRegex(AssertionError,'original full message'):
            sol.finalize()

    def test_negative_page_is_rejected_and_interval_bounds_are_sane(self):
        self.prepare()
        with self.assertRaisesRegex(AssertionError,'start at zero'):
            sol.load_page(0,-1)
        self.assertEqual(sol.wilson(0,100),[0.0,0.037])
        self.assertEqual(sol.wilson(100,100),[0.963,1.0])
