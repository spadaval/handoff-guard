CREATE TABLE analysis_records(run_id TEXT NOT NULL REFERENCES analysis_runs, kind TEXT NOT NULL, record_key TEXT NOT NULL, message_id TEXT REFERENCES messages, record_json TEXT NOT NULL, PRIMARY KEY(run_id,kind,record_key));
--> statement-breakpoint
CREATE TABLE analysis_runs(run_id TEXT PRIMARY KEY, kind TEXT NOT NULL, created_at TEXT NOT NULL, metadata_json TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE "context_evidence"(context_id TEXT NOT NULL REFERENCES contexts,evidence_id TEXT NOT NULL REFERENCES evidence_records,PRIMARY KEY(context_id,evidence_id)) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE context_texts(text_id INTEGER PRIMARY KEY,sha256 BLOB NOT NULL UNIQUE,text TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE contexts(context_id TEXT PRIMARY KEY, observation_id TEXT UNIQUE NOT NULL REFERENCES observations, message_id TEXT NOT NULL REFERENCES messages, status TEXT NOT NULL CHECK(status IN ('pending','partial','recovered','unavailable')), metadata_json TEXT NOT NULL, UNIQUE(context_id,message_id));
--> statement-breakpoint
CREATE TABLE corpus_gaps(line INTEGER PRIMARY KEY, record_json TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE evidence_records(evidence_id TEXT PRIMARY KEY,kind TEXT NOT NULL,text_id INTEGER NOT NULL REFERENCES context_texts,provenance BLOB NOT NULL,visibility TEXT NOT NULL) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE historical_reviews(id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages, source_path TEXT NOT NULL, record_json TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE mechanical_results(run_id TEXT NOT NULL REFERENCES mechanical_runs, message_id TEXT NOT NULL REFERENCES messages, result_json TEXT NOT NULL, PRIMARY KEY(run_id,message_id));
--> statement-breakpoint
CREATE TABLE mechanical_runs(run_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, metadata_json TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE messages(message_id TEXT PRIMARY KEY, text TEXT NOT NULL, characters INTEGER NOT NULL, words INTEGER NOT NULL, kinds TEXT NOT NULL, projects TEXT NOT NULL, is_input INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE observations(observation_id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages, export_line INTEGER UNIQUE NOT NULL, source TEXT NOT NULL, record_json TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE reference_records(reference_id TEXT PRIMARY KEY,context_id TEXT NOT NULL REFERENCES contexts,text_id INTEGER REFERENCES context_texts,metadata BLOB NOT NULL) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE review_runs(run_id TEXT PRIMARY KEY, rubric_version TEXT NOT NULL, reviewer TEXT NOT NULL, created_at TEXT NOT NULL, metadata_json TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE reviews(review_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES review_runs, context_id TEXT NOT NULL, message_id TEXT NOT NULL, record_json TEXT NOT NULL, FOREIGN KEY(context_id,message_id) REFERENCES contexts(context_id,message_id));
--> statement-breakpoint
CREATE TABLE source_files(path TEXT PRIMARY KEY, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, purpose TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE splits(message_id TEXT PRIMARY KEY REFERENCES messages, record_json TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX analysis_message ON analysis_records(message_id);
--> statement-breakpoint
CREATE INDEX ctx_message ON contexts(message_id);
--> statement-breakpoint
CREATE INDEX ctx_status ON contexts(status);
--> statement-breakpoint
CREATE INDEX history_message ON historical_reviews(message_id);
--> statement-breakpoint
CREATE INDEX mechanics_message ON mechanical_results(message_id);
--> statement-breakpoint
CREATE INDEX obs_message ON observations(message_id);
--> statement-breakpoint
CREATE INDEX reference_context ON reference_records(context_id);
--> statement-breakpoint
CREATE INDEX review_context ON reviews(context_id);
--> statement-breakpoint
CREATE VIEW context_references AS SELECT r.reference_id,r.context_id,CASE WHEN r.text_id IS NULL THEN unpack_text(r.metadata) ELSE json_set(unpack_text(r.metadata),'$.text',t.text) END AS record_json FROM reference_records r LEFT JOIN context_texts t USING(text_id);
--> statement-breakpoint
CREATE VIEW evidence AS SELECT e.evidence_id,e.kind,t.text,unpack_text(e.provenance) AS provenance,e.visibility FROM evidence_records e JOIN context_texts t USING(text_id);
--> statement-breakpoint
CREATE VIEW input_contexts AS SELECT c.*,o.source,o.record_json AS observation_json FROM contexts c JOIN messages m USING(message_id) JOIN observations o USING(observation_id) WHERE m.is_input=1;
--> statement-breakpoint
CREATE TRIGGER insert_evidence INSTEAD OF INSERT ON evidence BEGIN
          INSERT OR IGNORE INTO context_texts(sha256,text) VALUES(text_key(NEW.text),NEW.text);
          INSERT OR IGNORE INTO evidence_records SELECT NEW.evidence_id,NEW.kind,text_id,pack_text(NEW.provenance),NEW.visibility FROM context_texts WHERE sha256=text_key(NEW.text);
        END;
--> statement-breakpoint
CREATE TRIGGER insert_reference INSTEAD OF INSERT ON context_references BEGIN
          INSERT OR IGNORE INTO context_texts(sha256,text) SELECT text_key(json_extract(NEW.record_json,'$.text')),json_extract(NEW.record_json,'$.text') WHERE json_type(NEW.record_json,'$.text')='text';
          INSERT OR IGNORE INTO reference_records VALUES(NEW.reference_id,NEW.context_id,
            CASE WHEN json_type(NEW.record_json,'$.text')='text' THEN (SELECT text_id FROM context_texts WHERE sha256=text_key(json_extract(NEW.record_json,'$.text'))) END,
            pack_text(CASE WHEN json_type(NEW.record_json,'$.text')='text' THEN json_remove(NEW.record_json,'$.text') ELSE NEW.record_json END));
        END;
--> statement-breakpoint
PRAGMA user_version=2;
