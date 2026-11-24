"""Synthetic fixtures only; no historical message contents."""
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('context_database', Path(__file__).resolve().parents[1] / 'scripts/context_database.py')
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


class DatabaseTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        self.dbpath = self.path / 'private/test.sqlite3'
        self.db = c.connect(self.dbpath)
        self.addCleanup(self.db.close)

    def fixture(self):
        directory = self.path / 'corpus'
        directory.mkdir()
        rollout = self.path / 'rollout.jsonl'
        records = [
            {'type':'session_meta','payload':{'id':'synthetic','cwd':'/missing/synthetic'}},
            {'type':'response_item','payload':{'role':'user','content':[{'text':'Please check the synthetic example.'}]}},
            {'type':'response_item','payload':{'type':'function_call_output','output':'Synthetic tool result.'}},
            {'type':'response_item','payload':{'type':'function_call','name':'spawn_agent','arguments':'{}'}}]
        rollout.write_text(''.join(c.js(r)+'\n' for r in records))
        text = 'Check sample.rs.\nKeep exact whitespace. '
        mid = c.digest(text)
        msg = dict(message_id=mid,text=text,characters=len(text),words=len(text.split()),kinds=['assignment','worker_report'],projects=['synthetic'])
        obs = dict(message_id=mid,kind='assignment',source='codex_rollout',locator=str(rollout),line=4)
        (directory/'messages.jsonl').write_text(c.js(msg)+'\n')
        (directory/'observations.jsonl').write_text(c.js(obs)+'\n'+c.js({**obs,'kind':'worker_report'})+'\n')
        manifest = {'files':{n:{'sha256':c.checksum(directory/n)} for n in ['messages.jsonl','observations.jsonl']},'counts':{'unique_plaintext_bodies':1,'plaintext_observations':2}}
        (directory/'manifest.json').write_text(c.js(manifest))
        return directory, mid

    def test_import_resume_snapshot_and_provenance(self):
        directory, mid = self.fixture()
        c.import_corpus(self.db,directory)
        c.recover(self.db)
        first = c.validate(self.db)
        c.import_corpus(self.db,directory)
        c.recover(self.db)
        self.assertEqual(first,c.validate(self.db))
        self.assertEqual(first['observations'],2)
        self.assertEqual(first['input_bodies_with_preceding_evidence'],1)
        snapshot = self.path/'snapshot.json'
        c.export_snapshot(self.db,snapshot,self.dbpath)
        data = json.loads(snapshot.read_text())
        self.assertEqual(data['messages'][0]['text'],'Check sample.rs.\nKeep exact whitespace. ')
        contexts = data['messages'][0]['contexts']
        self.assertEqual(len(contexts),2)
        self.assertEqual(contexts[0]['analyses'],[])
        for ctx in contexts:
            body_ev = next(e for e in ctx['evidence'] if e['kind']=='recorded_handoff_body')
            self.assertEqual(body_ev['visibility'],'recipient_visible' if ctx['kind']=='assignment' else 'unknown')
        evidence = contexts[0]['evidence']
        self.assertTrue(any(e['kind']=='preceding_function_call_output' for e in evidence))
        self.assertTrue(all(e['visibility']=='sender_context' for e in evidence if e['kind']!='recorded_handoff_body'))
        self.assertTrue(all(r['availability']=='unavailable' for r in contexts[0]['references']))
        self.assertEqual(snapshot.stat().st_mode & 0o777,0o600)
        self.assertEqual(self.dbpath.stat().st_mode & 0o777,0o600)
        (directory/'messages.jsonl').write_text('changed')
        with self.assertRaises(ValueError):
            c.import_corpus(self.db,directory)

    def test_reviews_bind_message_context_run_and_evidence(self):
        directory,mid = self.fixture()
        c.import_corpus(self.db,directory)
        c.recover(self.db)
        cid = self.db.execute('SELECT context_id FROM contexts LIMIT 1').fetchone()[0]
        self.db.execute('INSERT INTO review_runs VALUES(?,?,?,?,?)',('synthetic-run','v1','test',c.now(),'{}'))
        record = {k:{'grade':'unknown','reason':'Synthetic fixture.'} for k in ('purpose','information_selection','clarity','overall')}
        record['rationale'] = 'Synthetic review rationale.'
        record['evidence_ids'] = ['foreign-evidence']
        with self.assertRaises(ValueError):
            c.insert_review(self.db,'synthetic-run',cid,mid,record)
        record['evidence_ids'] = []
        with self.assertRaises(sqlite3.IntegrityError):
            c.insert_review(self.db,'synthetic-run',cid,'wrong-body',record)
        c.insert_review(self.db,'synthetic-run',cid,mid,record)
        self.assertEqual(c.summary(self.db)['reviews'],1)

    def test_missing_sources_and_noninput_are_explicit(self):
        directory, mid = self.fixture()
        observations = [json.loads(l) for l in (directory/'observations.jsonl').read_text().splitlines()]
        for o in observations:
            o['locator'] = str(self.path/'unavailable-rollout.jsonl')
        (directory/'observations.jsonl').write_text(''.join(c.js(o)+'\n' for o in observations))
        manifest = json.loads((directory/'manifest.json').read_text())
        manifest['files']['observations.jsonl']['sha256'] = c.checksum(directory/'observations.jsonl')
        (directory/'manifest.json').write_text(c.js(manifest))
        c.import_corpus(self.db,directory)
        c.recover(self.db)
        self.assertEqual(c.validate(self.db)['context_status'],{'unavailable':2})
        details = json.loads(self.db.execute('SELECT metadata_json FROM contexts LIMIT 1').fetchone()[0])
        self.assertTrue(any(g['reason']=='rollout_unavailable_or_target_outside_scan' for g in details['gaps']))
        self.db.execute('DELETE FROM context_evidence')
        self.db.execute('UPDATE messages SET is_input=0')
        self.db.execute("UPDATE contexts SET status='pending'")
        self.db.commit()
        c.recover(self.db)
        details = json.loads(self.db.execute('SELECT metadata_json FROM contexts LIMIT 1').fetchone()[0])
        self.assertIn('non_input_output_path_not_enriched',details['gaps'][0]['reason'])

    def test_evidence_cap_records_omission(self):
        directory,mid = self.fixture()
        c.import_corpus(self.db,directory)
        cid = self.db.execute('SELECT context_id FROM contexts LIMIT 1').fetchone()[0]
        c.add_evidence(self.db,cid,'synthetic','x'*(c.MAX_TEXT+15),{'fixture':True})
        evidence = self.db.execute('SELECT text,provenance FROM evidence').fetchone()
        self.assertEqual(len(evidence[0]),c.MAX_TEXT)
        self.assertEqual(json.loads(evidence[1])['omitted_characters'],15)
        snapshot = self.path/'capped.json'
        c.export_snapshot(self.db,snapshot,self.dbpath,text_limit=20)
        data = json.loads(snapshot.read_text())
        saved = next(e for ctx in data['messages'][0]['contexts'] for e in ctx['evidence'])
        self.assertEqual(len(saved['text']),20)
        self.assertEqual(saved['snapshot_omitted_characters'],c.MAX_TEXT-20)
        self.assertEqual(data['messages'][0]['text'],'Check sample.rs.\nKeep exact whitespace. ')

    def test_empty_snapshot(self):
        target = self.path/'empty.json'
        c.export_snapshot(self.db,target,self.dbpath)
        data = json.loads(target.read_text())
        self.assertEqual(data['schema_version'],1)
        self.assertEqual(data['messages'],[])
        self.assertEqual(data['summary']['reviews'],0)

    def test_cache_origin_exact_match_does_not_imply_recipient_access(self):
        directory,mid = self.fixture()
        observations = [json.loads(l) for l in (directory/'observations.jsonl').read_text().splitlines()]
        original = Path(observations[0]['locator'])
        records = [json.loads(l) for l in original.read_text().splitlines()]
        body = json.loads((directory/'messages.jsonl').read_text())['text']
        records[-1]['payload']['arguments'] = c.js({'message':body})
        original.write_text(''.join(c.js(r)+'\n' for r in records))
        cache = self.path/'cache.json'
        cache.write_text('[{"context":{}}]')
        for o in observations:
            o.update(source='audit_cache',locator=str(cache),item_id='0',original_rollout=str(original))
        (directory/'observations.jsonl').write_text(''.join(c.js(o)+'\n' for o in observations))
        manifest = json.loads((directory/'manifest.json').read_text())
        manifest['files']['observations.jsonl']['sha256'] = c.checksum(directory/'observations.jsonl')
        (directory/'manifest.json').write_text(c.js(manifest))
        c.import_corpus(self.db,directory)
        c.recover(self.db)
        evidence = self.db.execute("SELECT visibility FROM evidence WHERE kind='cache_origin_preceding_user'").fetchall()
        self.assertTrue(evidence)
        self.assertTrue(all(e[0]=='unknown' for e in evidence))
        info = json.loads(self.db.execute('SELECT metadata_json FROM contexts LIMIT 1').fetchone()[0])['cache_original_rollout_recovery']
        self.assertEqual(info['exact_body_matches'],1)
        before = c.validate(self.db)
        c.recover(self.db)
        self.assertEqual(before,c.validate(self.db))

    def test_current_mapping_cannot_backdate_a_later_session_revision(self):
        source = self.path/'mapped.jsonl'
        source.write_text(c.js({'type':'session_meta','payload':{'id':'later','timestamp':'2026-02-01T00:00:00Z','git':{'commit_hash':'a'*40}}})+'\n')
        recovery = c.Recovery(self.db)
        recovery.t3_native = {'thread':['later']}
        recovery.native_paths = {'later':str(source)}
        earlier = recovery.session_metadata({'thread_id':'thread','timestamp':'2026-01-01T00:00:00Z'})
        self.assertNotIn('git',earlier)
        later = recovery.session_metadata({'thread_id':'thread','timestamp':'2026-03-01T00:00:00Z'})
        self.assertEqual(later['git']['commit_hash'],'a'*40)
        recovery.t3_native['thread'].append('unavailable-session')
        ambiguous = recovery.session_metadata({'thread_id':'thread','timestamp':'2026-03-01T00:00:00Z'})
        self.assertNotIn('git',ambiguous)
        self.assertEqual(ambiguous['mapping_candidates'],2)

    def test_historical_git_only(self):
        import subprocess
        repo = self.path/'repo'
        repo.mkdir()
        def git(*args):
            return subprocess.check_output(['git','-C',str(repo),*args],stderr=subprocess.DEVNULL).decode().strip()
        git('init')
        git('config','user.email','synthetic@example.invalid')
        git('config','user.name','Synthetic')
        (repo/'AGENTS.md').write_text('Historical synthetic instruction.')
        git('add','AGENTS.md')
        git('commit','-m','synthetic fixture')
        sha = git('rev-parse','HEAD')
        (repo/'AGENTS.md').write_text('Current text must not be evidence.')
        recovery = c.Recovery(self.db)
        result = recovery.git_reference(str(repo),sha,'AGENTS.md')
        self.assertEqual(result['text'],'Historical synthetic instruction.')
        self.assertEqual(result['availability'],'recovered')
        self.assertNotEqual(recovery.git_reference(str(repo),sha,'../outside.md').get('availability'),'recovered')


if __name__ == '__main__':
    unittest.main()
