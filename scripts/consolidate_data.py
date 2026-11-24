#!/usr/bin/env python3
"""Import historical working data into SQLite, verify it, then optionally clean up."""
import argparse
import json
from pathlib import Path

import context_database as corpus
import research_store as store

ROOT = corpus.ROOT
RUN = 'sqlite-consolidation-1'
RESULT_DOCS = ['checkpoint.md', 'context-pilot.md', 'context-pilot-v2.md',
               'evaluation.md', 'triage.md', 'triage-sol.md', 'style-signals-calibration.md']
CONTROL_FILES = {
    'triage-20261123/RUBRIC.md': 'docs/review-instructions/luna-triage.md',
    'triage-20261123/SMALL_REVIEW.md': 'docs/review-instructions/luna-repair.md',
    'triage-sol-20261123/SOL_REVIEW.md': 'docs/review-instructions/sol-blind-review.md',
}
CORE = ['messages','observations','contexts','evidence','context_evidence',
        'context_references','historical_reviews','splits','reviews','mechanical_results']


def counts(db):
    return {name: db.execute('SELECT count(*) FROM '+name).fetchone()[0] for name in CORE}


def consolidate(db, directory):
    if db.execute('SELECT 1 FROM analysis_runs WHERE run_id=?', (RUN,)).fetchone():
        return
    before = counts(db)
    corpus.validate(db)
    inventory = []
    database_path = Path(db.execute('PRAGMA database_list').fetchone()[2]).resolve()
    with db:
        store.create_run(db, RUN, 'migration', {'preserved_counts': before, 'version': 1})
        baseline = directory/'context-db-work/pre-style-signals-guard'
        if baseline.exists():
            store.create_run(db, 'pre-style-signals-policy', 'policy-baseline',
                             {'binary_sha256': corpus.checksum(baseline), 'scope': 'all plaintext bodies'})
            for result in store.compiled(db, baseline, 'evaluate'):
                store.put(db, 'pre-style-signals-policy', 'prediction', result['message_id'], result, result['message_id'])
        for p in sorted(directory.rglob('*')):
            if not p.is_file() or p.resolve() == database_path or str(p.resolve()).startswith(str(database_path)+'-'):
                continue
            relative = p.relative_to(directory).as_posix()
            sha = corpus.checksum(p)
            disposition = 'archived'
            if relative in CONTROL_FILES:
                target = ROOT/CONTROL_FILES[relative]
                if corpus.checksum(target) != sha:
                    raise ValueError('Save the control file in Git before migrating: '+relative)
                disposition = 'control moved to '+CONTROL_FILES[relative]
            elif p.suffix == '.png' or relative == 'dashboard.json' or p == baseline:
                disposition = 'disposable screenshot/export/build'
            else:
                store.archive(db,p)
            inventory.append({'path':str(p.resolve()),'sha256':sha,'disposition':disposition})
        # Previously checked-in outputs belong with the private research, including aggregates.
        for p in sorted((ROOT/'data').iterdir()):
            if p.is_file() and p.name != 'README.md':
                store.archive(db,p,'former checked-in result')
        for name in RESULT_DOCS:
            store.archive(db,ROOT/'docs'/name,'former checked-in result report')
        for path in sorted(directory.glob('style-signals-v*')):
            summary_path = path/'summary.json'
            if not summary_path.exists():
                continue
            summary = json.loads(summary_path.read_text())
            run = path.name
            store.create_run(db, run, 'style-calibration', summary)
            for name, kind in [('sample.json','sample'),('tuning-labels.json','label'),('heldout-labels.json','label')]:
                source = path/name
                if source.exists():
                    for record in json.loads(source.read_text()):
                        store.put(db,run,kind,record['message_id'],record,record['message_id'])
            for name in ['evaluation.json','rule-freeze.json']:
                if (path/name).exists():
                    store.put(db,run,'report',name,json.loads((path/name).read_text()))
        store.put(db,RUN,'cleanup','inventory',inventory)
        if counts(db) != before:
            raise ValueError('Migration changed existing research rows')
    verify(db)


def verify(db):
    result = corpus.validate(db)
    result['archive_payloads_verified'] = store.validate_archives(db)
    row = db.execute('SELECT metadata_json FROM analysis_runs WHERE run_id=?',(RUN,)).fetchone()
    if not row or counts(db) != json.loads(row[0])['preserved_counts']:
        raise ValueError('Existing corpus/reviews changed during consolidation')
    inventory = store.records(db,RUN,'cleanup')[0]
    for record in inventory:
        if record['disposition'] == 'archived':
            saved = db.execute('SELECT sha256 FROM archived_files WHERE path=?',(record['path'],)).fetchone()
            if not saved or saved[0] != record['sha256']:
                raise ValueError('Unpreserved file: '+record['path'])
    result['working_files_accounted_for'] = len(inventory)
    return result


def cleanup(db,directory):
    verify(db)
    inventory = store.records(db,RUN,'cleanup')[0]
    # Check every candidate before deleting any. A changed/unregistered file is left alone.
    for row in inventory:
        p = Path(row['path'])
        if not p.is_relative_to(directory.resolve()):
            raise ValueError('Cleanup path outside data directory')
        if p.exists() and corpus.checksum(p) != row['sha256']:
            raise ValueError('Working file changed after migration: '+str(p))
    for row in inventory:
        Path(row['path']).unlink(missing_ok=True)
    for p in sorted(directory.rglob('*'),key=lambda p:len(p.parts),reverse=True):
        if p.is_dir() and not any(p.iterdir()):
            p.rmdir()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database',type=Path,default=store.DATABASE)
    parser.add_argument('--legacy-directory',type=Path,help='Explicit directory of old working data to import; never the current data/ directory')
    parser.add_argument('--cleanup',action='store_true')
    args = parser.parse_args()
    with corpus.connect(args.database) as db:
        migrated = db.execute('SELECT 1 FROM analysis_runs WHERE run_id=?',(RUN,)).fetchone()
        if not migrated and not args.legacy_directory:
            raise ValueError('A first migration requires --legacy-directory; do not import the current data/ directory')
        directory = args.legacy_directory or args.database.parent
        if not migrated and directory.resolve() == (ROOT/'data').resolve():
            raise ValueError('The current data/ directory contains tracked documentation, not legacy working files')
        consolidate(db,directory)
        if args.cleanup:
            cleanup(db,directory)
        print(corpus.js(verify(db)))
    db.close()


if __name__ == '__main__':
    main()
