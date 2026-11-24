"""Storage and review backend checks with invented bodies. No UI tests."""
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import context_database as corpus
import research_store as store
import research
import consolidate_data as consolidation
import calibrate_style_signals as calibration


class ResearchStoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.db = corpus.connect(self.root/'private/test.sqlite3')
        self.addCleanup(self.db.close)

    def body(self,text):
        mid = corpus.digest(text)
        self.db.execute('INSERT INTO messages VALUES(?,?,?,?,?,?,?)',(mid,text,len(text),len(text.split()),'["assignment"]','[]',1))
        self.db.execute('INSERT INTO splits VALUES(?,?)',(mid,corpus.js({'message_id':mid,'split':'tuning','component':mid})))
        self.db.commit()
        return mid

    def test_archive_survives_removal_and_deduplicates_exact_bytes(self):
        source = self.root/'original.jsonl'; duplicate = self.root/'duplicate.jsonl'
        data = b'{"text":"Invented\\nmessage."}\n\x00'
        source.write_bytes(data); duplicate.write_bytes(data)
        with self.db:
            store.archive(self.db,source); store.archive(self.db,duplicate)
        source.unlink(); duplicate.unlink()
        self.assertEqual(store.archived_bytes(self.db,source),data)
        self.assertEqual(self.db.execute('SELECT count(*) FROM archived_blobs').fetchone()[0],1)
        self.assertEqual(store.validate_archives(self.db),1)
        self.db.execute('UPDATE archived_blobs SET compressed=?',(b'broken',))
        with self.assertRaises(Exception):
            store.archived_bytes(self.db,source)

    def test_cleanup_refuses_changed_files_then_leaves_only_sqlite(self):
        self.body('Check an invented migration fixture.')
        self.db.execute('INSERT INTO metadata VALUES(?,?)',('manifest',corpus.js({'counts':{'unique_plaintext_bodies':1,'plaintext_observations':0}})))
        self.db.commit()
        (self.root/'data').mkdir()
        (self.root/'data/README.md').write_text('Synthetic instructions.')
        (self.root/'docs').mkdir()
        for name in consolidation.RESULT_DOCS:
            (self.root/'docs'/name).write_text('Synthetic prior analysis.')
        directory = self.root/'private'
        source = directory/'labels.json'
        source.write_text('{"label":"normal"}')
        with patch.object(consolidation,'ROOT',self.root):
            consolidation.consolidate(self.db,directory)
            consolidation.consolidate(self.db,directory)  # Identical reruns do not duplicate.
            saved = source.read_bytes()
            source.write_text('changed after import')
            with self.assertRaises(ValueError):
                consolidation.cleanup(self.db,directory)
            self.assertTrue(source.exists())
            source.write_bytes(saved)
            consolidation.cleanup(self.db,directory)
            self.assertEqual([p.name for p in directory.iterdir()],['test.sqlite3'])
            self.assertEqual(store.archived_bytes(self.db,source),saved)
            self.assertEqual(self.db.execute('SELECT count(*) FROM messages').fetchone()[0],1)

    def test_run_and_record_retries_are_immutable_and_transactional(self):
        mid = self.body('Check the invented fixture.')
        with self.db:
            store.create_run(self.db,'r','review',{'rubric':'test'})
            store.put(self.db,'r','label',mid,{'label':'normal'},mid)
        store.create_run(self.db,'r','review',{'rubric':'test'})
        store.put(self.db,'r','label',mid,{'label':'normal'},mid)
        with self.assertRaises(ValueError):
            store.put(self.db,'r','label',mid,{'label':'pathological'},mid)
        with self.assertRaises(sqlite3.IntegrityError):
            store.put(self.db,'r','label','unknown',{},'missing-body')
        self.assertEqual(store.records(self.db,'r','label'),[{'label':'normal'}])

    def test_calibration_requires_exact_split_labels_and_preserves_ambiguity(self):
        a = self.body('Check the first fixture.')
        b = self.body('Check the second fixture.')
        with self.db:
            store.create_run(self.db,'style','style-calibration',{'source_sha256':corpus.checksum(corpus.ROOT/'src/style_signals.rs')})
            for mid,split in [(a,'tuning'),(b,'heldout')]:
                record = {'message_id':mid,'split':split,'component':mid,'signals':{r:{'status':'warn'} for r in ['punctuation_spacing','needless_shorthand']}}
                store.put(self.db,'style','sample',mid,record,mid)
        def label(mid):
            return {'message_id':mid,'style_label':'ambiguous','punctuation_spacing':'absent','needless_shorthand':'ambiguous','note':'Invented ambiguity.','reviewer':'synthetic'}
        with self.assertRaises(ValueError):
            calibration.label(self.db,'style','tuning',[label(a),label(b)])
        calibration.label(self.db,'style','tuning',[label(a)])
        calibration.label(self.db,'style','heldout',[label(b)])
        result = calibration.summarize(self.db,'style')
        self.assertEqual(result['results']['heldout']['punctuation_spacing']['false_positive'],1)
        self.assertEqual(result['results']['heldout']['needless_shorthand']['ambiguous'],1)
        changed = label(a); changed['note']='Different verdict.'
        with self.assertRaises(ValueError):
            calibration.label(self.db,'style','tuning',[changed])

    @unittest.skipUnless((corpus.ROOT/'target/release/handoff-guard').is_file(),'Build the release executable first')
    def test_calibration_preparation_uses_database_baseline_and_frozen_sampling(self):
        a = self.body('Read the first invented fixture.')
        b = self.body('Read the second invented fixture.')
        self.db.execute('UPDATE splits SET record_json=? WHERE message_id=?',
                        (corpus.js({'message_id':b,'component':b,'split':'heldout'}),b))
        self.db.commit()
        binary = corpus.ROOT/'target/release/handoff-guard'
        with self.db:
            store.create_run(self.db,'baseline','policy-baseline',{})
            for record in store.compiled(self.db,binary,'evaluate'):
                store.put(self.db,'baseline','prediction',record['message_id'],record,record['message_id'])
        config = corpus.ROOT/'config/calibration.json'
        metadata = calibration.prepare(self.db,'trial',binary,config,'baseline')
        self.assertEqual(metadata['policy_differences'],0)
        self.assertEqual({r['message_id'] for r in store.records(self.db,'trial','sample')},{a,b})
        self.assertEqual(len(store.records(self.db,'trial','inspection')),2)
        with self.assertRaises(ValueError):
            calibration.prepare(self.db,'trial',binary,config,'baseline')
        with self.assertRaises(ValueError):
            calibration.prepare(self.db,'other',binary,config,'missing-baseline')

    def test_frozen_review_rejects_unsampled_body_and_invalid_scores(self):
        mid = self.body('Check this fixture.')
        config = self.root/'review.json'
        config.write_text(corpus.js({'seed':17,'rubric':'docs/communication-rubric.md'}))
        research.sample(self.db,'review',1,config,'synthetic')
        record = {'message_id':mid,'context_id':None,'full_message_reviewed':True,
                  'classification':{'task':'An invented task.'},'purpose':{'reason':'Check a fixture.'},
                  'information_selection':{'score':None,'reason':'Missing context.'},
                  'presentation':{'score':5,'reason':'Plain instruction.'}}
        research.record_review(self.db,'review',record)
        with self.assertRaises(ValueError):
            research.record_review(self.db,'review',{**record,'message_id':'missing'})
        with self.assertRaises(ValueError):
            research.record_review(self.db,'review',{**record,'presentation':{'score':True,'reason':'Wrong type.'}})
        with self.assertRaises(ValueError):
            research.record_review(self.db,'review',{**record,'evidence_ids':['unrelated']})


if __name__=='__main__':
    unittest.main()
