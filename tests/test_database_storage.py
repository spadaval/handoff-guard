"""Invented records verify lossless deduplication and obsolete-data removal."""
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import context_database as corpus
import database_storage as storage
import compact_database as maintenance
import research_store as store


class StorageTests(unittest.TestCase):
    def test_v1_migration_shares_text_without_merging_provenance(self):
        db=sqlite3.connect(':memory:')
        self.addCleanup(db.close)
        storage.configure(db)
        db.executescript('''CREATE TABLE contexts(context_id TEXT PRIMARY KEY);
          CREATE TABLE evidence(evidence_id TEXT PRIMARY KEY,kind TEXT,text TEXT,provenance TEXT,visibility TEXT);
          CREATE TABLE context_references(reference_id TEXT PRIMARY KEY,context_id TEXT,record_json TEXT);
          CREATE TABLE context_evidence(context_id TEXT,evidence_id TEXT,PRIMARY KEY(context_id,evidence_id));
          INSERT INTO contexts VALUES('c');''')
        text='  Invented shared file. 😀\n'
        for n in range(2):
            db.execute('INSERT INTO evidence VALUES(?,?,?,?,?)',(str(n),'instructions',text,json.dumps({'line':n}),'unknown'))
            db.execute('INSERT INTO context_evidence VALUES(?,?)',('c',str(n)))
            db.execute('INSERT INTO context_references VALUES(?,?,?)',(str(n),'c',json.dumps({'text':text,'revision':str(n)})))
        db.commit()
        before={t:storage.fingerprint(db,t) for t in ['evidence','context_references','context_evidence']}
        storage.upgrade(db)
        self.assertEqual(before,{t:storage.fingerprint(db,t) for t in before})
        self.assertEqual(db.execute('SELECT count(*) FROM context_texts').fetchone()[0],1)
        db.execute('INSERT INTO evidence VALUES(?,?,?,?,?)',('new','instruction',text,'{}','sender_context'))
        db.execute('INSERT INTO context_references VALUES(?,?,?)',('missing','c','{"availability":"unavailable"}'))
        self.assertEqual(db.execute('SELECT count(*) FROM context_texts').fetchone()[0],1)
        self.assertNotIn('text',json.loads(db.execute("SELECT record_json FROM context_references WHERE reference_id='missing'").fetchone()[0]))
        self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])

    def test_cleanup_preserves_reviews_and_newest_diagnostics(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'test.sqlite3';db=corpus.connect(path)
            text='An invented handoff.';mid=corpus.digest(text)
            db.execute('INSERT INTO messages VALUES(?,?,?,?,?,?,?)',(mid,text,len(text),3,'[]','[]',1))
            db.execute('INSERT INTO metadata VALUES(?,?)',('manifest',corpus.js({'counts':{'unique_plaintext_bodies':1,'plaintext_observations':0}})))
            for rid,date in [('old','2020'),('new','2021')]:
                db.execute('INSERT INTO mechanical_runs VALUES(?,?,?)',(rid,date,'{}'))
                db.execute('INSERT INTO mechanical_results VALUES(?,?,?)',(rid,mid,corpus.js({'message_id':mid,'run':rid})))
            store.create_run(db,'scratch','migration',{})
            store.put(db,'scratch','cleanup','inventory',[])
            db.executescript('CREATE TABLE archived_blobs(sha256 TEXT PRIMARY KEY,compressed BLOB); CREATE TABLE archived_files(path TEXT);')
            db.commit();db.close()
            maintenance.compact(path)
            db=corpus.connect(path)
            self.addCleanup(db.close)
            self.assertEqual(db.execute('SELECT run_id FROM mechanical_results').fetchone()[0],'new')
            self.assertEqual(db.execute('SELECT count(*) FROM analysis_runs').fetchone()[0],0)
            self.assertEqual(db.execute("SELECT count(*) FROM sqlite_master WHERE name LIKE 'archived_%'").fetchone()[0],0)
            self.assertEqual(db.execute('SELECT text FROM messages').fetchone()[0],text)
