"""SQLite storage for message-derived research. Configuration stays in Git files."""
import json
import subprocess
from pathlib import Path

import context_database as corpus

ROOT = corpus.ROOT
DATABASE = ROOT / 'data/handoffs.sqlite3'


def create_run(db, run_id, kind, metadata):
    saved = db.execute('SELECT kind,metadata_json FROM analysis_runs WHERE run_id=?', (run_id,)).fetchone()
    value = corpus.js(metadata)
    if saved:
        if tuple(saved) != (kind, value):
            raise ValueError('Run already frozen with different metadata: ' + run_id)
        return
    db.execute('INSERT INTO analysis_runs VALUES(?,?,?,?)', (run_id, kind, corpus.now(), value))


def put(db, run_id, kind, key, record, message_id=None):
    encoded = corpus.js(record)
    saved = db.execute('SELECT message_id,record_json FROM analysis_records WHERE run_id=? AND kind=? AND record_key=?',
                        (run_id, kind, key)).fetchone()
    if saved:
        if tuple(saved) != (message_id, encoded):
            raise ValueError('Refusing to overwrite a different record: ' + key)
        return
    db.execute('INSERT INTO analysis_records VALUES(?,?,?,?,?)', (run_id, kind, key, message_id, encoded))


def records(db, run_id, kind):
    return [json.loads(row[0]) for row in db.execute(
        'SELECT record_json FROM analysis_records WHERE run_id=? AND kind=? ORDER BY record_key', (run_id, kind))]


def compiled(db, binary, command):
    rows = db.execute('SELECT message_id,text FROM messages ORDER BY message_id').fetchall()
    for row in rows:
        if corpus.digest(row['text']) != row['message_id']:
            raise ValueError('Original body hash mismatch')
    # Temporary streams avoid a corpus-sized stdin/stdout allocation and leave no files.
    import tempfile
    with tempfile.TemporaryFile(mode='w+') as source, tempfile.TemporaryFile(mode='w+') as output:
        for row in rows:
            source.write(corpus.js(dict(row))+'\n')
        source.seek(0)
        subprocess.run([str(Path(binary).resolve()), command], stdin=source, stdout=output, check=True)
        output.seek(0)
        result = [json.loads(line) for line in output]
    if len(result) != len(rows) or {r['message_id'] for r in result} != {r['message_id'] for r in rows}:
        raise ValueError('Compiled result coverage mismatch')
    return result
