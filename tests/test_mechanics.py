"""Compiled-rule integration using synthetic corpus bodies only."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import context_database as corpus
from analyze_mechanics import analyze

BINARY = Path(__file__).resolve().parents[1] / 'target/release/handoff-guard'


@unittest.skipUnless(BINARY.is_file(), 'Build the release executable first')
class MechanicalStorageTest(unittest.TestCase):
    def test_compiled_results_are_idempotent_bound_and_exported(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'private/test.sqlite3'
            db = corpus.connect(path)
            text = '😀\n' + 'repeat ' * 100
            mid = hashlib.sha256(text.encode()).hexdigest()
            db.execute('INSERT INTO messages VALUES(?,?,?,?,?,?,?)',
                       (mid,text,len(text),len(text.split()),'["assignment"]','["synthetic"]',1))
            other = 'SYNTHETIC worker completion'
            output_id = hashlib.sha256(other.encode()).hexdigest()
            db.execute('INSERT INTO messages VALUES(?,?,?,?,?,?,?)',
                       (output_id,other,len(other),len(other.split()),'["worker_report"]','[]',0))
            db.commit(); db.close()
            first = analyze(path,BINARY)
            self.assertEqual(first,analyze(path,BINARY))
            self.assertEqual(first['bodies'],1)
            self.assertEqual(first['blocked'],1)
            db = corpus.connect(path)
            self.assertEqual(db.execute('SELECT count(*) FROM mechanical_results').fetchone()[0],1)
            snapshot = Path(directory)/'dashboard.json'
            corpus.export_snapshot(db,snapshot,path)
            values = {m['message_id']:m for m in json.loads(snapshot.read_text())['messages']}
            report = values[mid]['mechanical']
            self.assertEqual(report['message_id'],mid)
            self.assertEqual(report['engine_metadata']['engine'],'compiled Rust')
            self.assertIsNone(values[output_id]['mechanical'])
            repeated = next(c for c in report['checks'] if c['rule']=='repeated_token')
            for span in repeated['spans']:
                self.assertEqual(text[span['start']:span['end']],'repeat')
            db.execute('UPDATE messages SET text=? WHERE message_id=?',('changed',mid))
            db.commit();db.close()
            with self.assertRaises(ValueError):analyze(path,BINARY)


if __name__=='__main__':unittest.main()
