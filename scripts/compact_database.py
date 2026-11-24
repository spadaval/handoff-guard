#!/usr/bin/env python3
"""Deduplicate context, discard obsolete working data, and reclaim SQLite pages."""
import argparse
import json
from pathlib import Path

import context_database as corpus
from database_storage import fingerprint
from research_store import DATABASE

KEEP = ('messages','observations','contexts','evidence','context_references','context_evidence',
        'historical_reviews','splits','review_runs','reviews','corpus_gaps','source_files')


def compact(path):
    before_bytes=path.stat().st_size
    db=corpus.connect(path)  # The v2 migration verifies reconstructed context before committing.
    before={table:fingerprint(db,table) for table in KEEP}
    latest={r['message_id']:r['result_json'] for r in db.execute('''SELECT message_id,result_json FROM (
      SELECT r.*,row_number() OVER(PARTITION BY message_id ORDER BY m.created_at DESC,r.run_id DESC) AS n
      FROM mechanical_results r JOIN mechanical_runs m USING(run_id)) WHERE n=1''')}
    with db:
        db.execute('''DELETE FROM mechanical_results WHERE rowid IN (
          SELECT rid FROM (SELECT r.rowid AS rid,row_number() OVER(
            PARTITION BY message_id ORDER BY m.created_at DESC,r.run_id DESC) AS n
            FROM mechanical_results r JOIN mechanical_runs m USING(run_id)) WHERE n>1)''')
        db.execute('DELETE FROM mechanical_runs WHERE run_id NOT IN (SELECT run_id FROM mechanical_results)')
        seen=set()
        for row in db.execute('SELECT * FROM analysis_runs ORDER BY created_at DESC,run_id DESC').fetchall():
            rid,kind=row['run_id'],row['kind']
            remove=kind in ('migration','hook-integration')
            if kind=='style-calibration':
                remove=not db.execute("SELECT 1 FROM analysis_records WHERE run_id=? AND kind='label' LIMIT 1",(rid,)).fetchone()
            if kind=='corpus-evaluation':
                key=json.loads(row['metadata_json']).get('label_source')
                count=db.execute("SELECT count(*) FROM analysis_records WHERE run_id=? AND kind='prediction'",(rid,)).fetchone()[0]
                if count!=db.execute('SELECT count(*) FROM messages').fetchone()[0]:
                    raise ValueError('Incomplete evaluation; inspect it before pruning')
                remove=key in seen
                seen.add(key)
            if remove:
                db.execute('DELETE FROM analysis_records WHERE run_id=?',(rid,))
                db.execute('DELETE FROM analysis_runs WHERE run_id=?',(rid,))
        db.execute('DROP TABLE IF EXISTS archived_files')
        db.execute('DROP TABLE IF EXISTS archived_blobs')
        # Empty databases created by the v1 bootstrap must not accumulate archives again.
        db.execute("INSERT OR REPLACE INTO metadata VALUES('storage_policy','shared context; no working-file archive')")
        after={table:fingerprint(db,table) for table in KEEP}
        if before!=after: raise ValueError('Essential research data changed during cleanup')
        actual={r['message_id']:r['result_json'] for r in db.execute('SELECT * FROM mechanical_results')}
        if actual!=latest: raise ValueError('Latest diagnostics changed')
        corpus.validate(db)
    db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    db.execute('VACUUM')
    db.execute('PRAGMA optimize')
    corpus.validate(db)
    db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    result={'before_bytes':before_bytes,'after_bytes':path.stat().st_size,
            'preserved_tables':list(KEEP),'latest_diagnostics':len(latest)}
    db.close()
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--database',type=Path,default=DATABASE)
    print(corpus.js(compact(p.parse_args().database)))
