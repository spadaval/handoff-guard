"""Shared context text and compressed provenance; stable SQL views for readers."""
import hashlib
import json
import zlib


def configure(db):
    db.create_function('text_key',1,lambda s:hashlib.sha256(s.encode()).digest(),deterministic=True)
    db.create_function('pack_text',1,lambda s:zlib.compress(s.encode()),deterministic=True)
    db.create_function('unpack_text',1,unpack,deterministic=True)


def unpack(value):
    return zlib.decompress(value).decode() if isinstance(value,bytes) else value


def fingerprint(db,table):
    h=hashlib.sha256()
    columns=[r[1] for r in db.execute('PRAGMA table_info('+table+')')]
    for row in db.execute('SELECT * FROM '+table+' ORDER BY 1'):
        values=dict(zip(columns,row))
        for key in ('record_json','provenance'):
            if key in values: values[key]=json.loads(values[key])
        h.update(json.dumps(values,sort_keys=True,ensure_ascii=False).encode()+b'\n')
    return h.hexdigest()


def upgrade(db):
    before={t:fingerprint(db,t) for t in ('evidence','context_references','context_evidence')}
    db.execute('PRAGMA foreign_keys=OFF')
    try:
        db.execute('BEGIN IMMEDIATE')
        db.execute('CREATE TABLE context_texts(text_id INTEGER PRIMARY KEY,sha256 BLOB NOT NULL UNIQUE,text TEXT NOT NULL)')
        db.execute('CREATE TABLE evidence_records(evidence_id TEXT PRIMARY KEY,kind TEXT NOT NULL,text_id INTEGER NOT NULL REFERENCES context_texts,provenance BLOB NOT NULL,visibility TEXT NOT NULL) WITHOUT ROWID')
        db.execute('CREATE TABLE reference_records(reference_id TEXT PRIMARY KEY,context_id TEXT NOT NULL REFERENCES contexts,text_id INTEGER REFERENCES context_texts,metadata BLOB NOT NULL) WITHOUT ROWID')
        def intern(text):
            key=hashlib.sha256(text.encode()).digest()
            db.execute('INSERT OR IGNORE INTO context_texts(sha256,text) VALUES(?,?)',(key,text))
            return db.execute('SELECT text_id FROM context_texts WHERE sha256=?',(key,)).fetchone()[0]
        for eid,kind,text,provenance,visibility in db.execute('SELECT * FROM evidence'):
            db.execute('INSERT INTO evidence_records VALUES(?,?,?,?,?)',(eid,kind,intern(text),zlib.compress(provenance.encode()),visibility))
        for rid,cid,encoded in db.execute('SELECT * FROM context_references'):
            record=json.loads(encoded)
            tid=intern(record.pop('text')) if isinstance(record.get('text'),str) else None
            db.execute('INSERT INTO reference_records VALUES(?,?,?,?)',(rid,cid,tid,zlib.compress(json.dumps(record,ensure_ascii=False,sort_keys=True).encode())))
        db.execute('CREATE TABLE new_links(context_id TEXT NOT NULL REFERENCES contexts,evidence_id TEXT NOT NULL REFERENCES evidence_records,PRIMARY KEY(context_id,evidence_id)) WITHOUT ROWID')
        db.execute('INSERT INTO new_links SELECT * FROM context_evidence')
        db.execute('DROP TABLE context_evidence')
        db.execute('ALTER TABLE new_links RENAME TO context_evidence')
        db.execute('DROP TABLE evidence')
        db.execute('DROP TABLE context_references')
        db.execute('CREATE INDEX reference_context ON reference_records(context_id)')
        db.execute('CREATE VIEW evidence AS SELECT e.evidence_id,e.kind,t.text,unpack_text(e.provenance) AS provenance,e.visibility FROM evidence_records e JOIN context_texts t USING(text_id)')
        db.execute("CREATE VIEW context_references AS SELECT r.reference_id,r.context_id,CASE WHEN r.text_id IS NULL THEN unpack_text(r.metadata) ELSE json_set(unpack_text(r.metadata),'$.text',t.text) END AS record_json FROM reference_records r LEFT JOIN context_texts t USING(text_id)")
        db.execute('''CREATE TRIGGER insert_evidence INSTEAD OF INSERT ON evidence BEGIN
          INSERT OR IGNORE INTO context_texts(sha256,text) VALUES(text_key(NEW.text),NEW.text);
          INSERT OR IGNORE INTO evidence_records SELECT NEW.evidence_id,NEW.kind,text_id,pack_text(NEW.provenance),NEW.visibility FROM context_texts WHERE sha256=text_key(NEW.text);
        END''')
        db.execute('''CREATE TRIGGER insert_reference INSTEAD OF INSERT ON context_references BEGIN
          INSERT OR IGNORE INTO context_texts(sha256,text) SELECT text_key(json_extract(NEW.record_json,'$.text')),json_extract(NEW.record_json,'$.text') WHERE json_type(NEW.record_json,'$.text')='text';
          INSERT OR IGNORE INTO reference_records VALUES(NEW.reference_id,NEW.context_id,
            CASE WHEN json_type(NEW.record_json,'$.text')='text' THEN (SELECT text_id FROM context_texts WHERE sha256=text_key(json_extract(NEW.record_json,'$.text'))) END,
            pack_text(CASE WHEN json_type(NEW.record_json,'$.text')='text' THEN json_remove(NEW.record_json,'$.text') ELSE NEW.record_json END));
        END''')
        after={t:fingerprint(db,t) for t in before}
        if before!=after: raise ValueError('Context content or relationships changed during normalization')
        if db.execute('PRAGMA foreign_key_check').fetchall(): raise ValueError('Context foreign keys failed')
        db.execute('PRAGMA user_version=2')
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.execute('PRAGMA foreign_keys=ON')
