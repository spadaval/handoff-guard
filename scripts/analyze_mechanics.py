#!/usr/bin/env python3
"""Store compiled hook diagnostics for every input body; never grade in Python."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

import context_database as corpus

ROOT = Path(__file__).resolve().parents[1]


def analyze(database, binary):
    db = corpus.connect(database)
    rows = db.execute('SELECT message_id,text FROM messages WHERE is_input=1 ORDER BY message_id').fetchall()
    identity = hashlib.sha256(Path(binary).read_bytes()).hexdigest()
    sources = {str(p.relative_to(ROOT)):corpus.checksum(p) for p in (ROOT/'src').glob('*.rs')}
    script_hash = corpus.checksum(Path(__file__))
    run_id = 'rust-mechanics-' + hashlib.sha256((identity + corpus.js(sources) + script_hash).encode()).hexdigest()[:24]
    payload = ''.join(corpus.js(dict(r)) + '\n' for r in rows)
    process = subprocess.run([str(Path(binary).resolve()), 'inspect'], input=payload, text=True,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    results = [json.loads(line) for line in process.stdout.splitlines()]
    expected = {r['message_id'] for r in rows}
    if len(results) != len(rows) or {r['message_id'] for r in results} != expected:
        raise ValueError('Compiled diagnostic coverage differs from input bodies')
    if any(hashlib.sha256(r['text'].encode()).hexdigest() != r['message_id'] for r in rows):
        raise ValueError('Original body hash mismatch')
    metadata = {'engine':'compiled Rust','binary_sha256':identity,
                'policy_version':results[0]['policy_version'] if results else None,
                'source_hashes':sources,'analysis_script_sha256':script_hash,
                'scope':'all distinct handoff input bodies; not worker output hook coverage',
                'changes_hook_configuration':False,'composite_score':False}
    with db:
        previous = db.execute('SELECT 1 FROM mechanical_runs WHERE run_id=?',(run_id,)).fetchone()
        if previous:
            saved = {r[0]:json.loads(r[1]) for r in db.execute('SELECT message_id,result_json FROM mechanical_results WHERE run_id=?',(run_id,))}
            comparable = {r['message_id']:{**r,'run_id':run_id,'engine_metadata':metadata} for r in results}
            if saved != comparable:
                raise ValueError('Refusing to overwrite differing mechanical results')
        else:
            db.execute('INSERT INTO mechanical_runs VALUES(?,?,?)',(run_id,corpus.now(),corpus.js(metadata)))
            for result in results:
                result.update(run_id=run_id,engine_metadata=metadata)
                db.execute('INSERT INTO mechanical_results VALUES(?,?,?)',(run_id,result['message_id'],corpus.js(result)))
    db.close()
    return {'run_id':run_id,'bodies':len(results),'blocked':sum(r['blocked'] for r in results),
            'engine':'compiled Rust','changes_hook_configuration':False}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database',type=Path,default=ROOT/'data/private/handoffs.sqlite3')
    parser.add_argument('--binary',type=Path,default=ROOT/'target/release/handoff-guard')
    args=parser.parse_args()
    print(json.dumps(analyze(args.database,args.binary)))


if __name__=='__main__':main()
