#!/usr/bin/env python3
"""Export local recorded handoffs. Offline preparation, not the runtime hook."""

import argparse
import base64
import collections
import csv
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys


ROOT = Path(__file__).resolve().parents[1]
TOOLS = {
    "spawn_agent": ("message", "assignment"),
    "delegate_task": ("task", "assignment"),
    "send_message": ("message", "agent_message"),
    "followup_task": ("message", "followup_assignment"),
    "assign_task": ("message", "followup_assignment"),
    "send_input": ("message", "agent_message"),
    "t3_thread_send": ("message", "agent_message"),
    "t3_thread_launch": ("message", "peer_thread_request"),
}


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def read_json(value):
    return json.loads(value) if isinstance(value, str) else value


def tool_tail(name):
    return re.split(r"__|[./:]|(?<=code)_", name or "")[-1]


def text_parts(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(x.get("text", "") for x in value
                         if isinstance(x, dict) and isinstance(x.get("text"), str))
    return None


def ciphertext(text):
    if not isinstance(text, str) or not re.fullmatch(r"gAAAA[A-Za-z0-9_=-]+", text):
        return False
    try:
        raw = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
        return len(raw) >= 73 and raw[0] == 0x80
    except (ValueError, TypeError):
        return False


class Corpus:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.messages = {}
        self.seen = set()
        self.counts = collections.Counter()
        self.source_counts = collections.Counter()
        self.opaque_ids = set()
        self.handles = {name: (self.directory / (name + ".jsonl")).open("w")
                        for name in ["observations", "opaque", "gaps"]}
        self.started_at = now()

    def gap(self, reason, **where):
        self.counts["gap:" + reason] += 1
        self.handles["gaps"].write(json.dumps({"reason": reason, **where}, ensure_ascii=False) + "\n")

    def add(self, text, kind, where, encrypted=False):
        if not isinstance(text, str) or not text.strip():
            return
        key = (where.get("source"), where.get("locator"), where.get("item_id"),
               where.get("line"), where.get("field"), kind)
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        if (*key, digest) in self.seen:
            return
        self.seen.add((*key, digest))
        obs = {"message_id": digest, "kind": kind, **where}
        if encrypted or ciphertext(text):
            self.handles["opaque"].write(json.dumps({**obs, "payload": text}, ensure_ascii=False) + "\n")
            self.counts["opaque_observations"] += 1
            self.opaque_ids.add(digest)
            return
        self.handles["observations"].write(json.dumps(obs, ensure_ascii=False) + "\n")
        self.source_counts[where.get("source", "unknown")] += 1
        self.counts["plaintext_observations"] += 1
        if digest not in self.messages:
            self.messages[digest] = {"message_id": digest, "text": text,
                "characters": len(text), "words": len(text.split()),
                "observation_count": 0, "kinds": set(), "projects": set()}
        record = self.messages[digest]
        record["observation_count"] += 1
        record["kinds"].add(kind)
        record["projects"].add(where.get("project") or "unknown")

    def tool(self, name, arguments, where, encrypted_fields=None):
        tail = tool_tail(name)
        if tail not in TOOLS and tail != "create_threads":
            return
        try:
            args = read_json(arguments)
        except (ValueError, TypeError):
            self.gap("invalid_tool_arguments", tool=name, **where)
            return
        if not isinstance(args, dict):
            self.gap("unstructured_tool_arguments", tool=name, **where)
            return
        if tail == "create_threads":
            for i, child in enumerate(args.get("threads", [])):
                if isinstance(child, dict):
                    self.add(child.get("prompt"), "peer_thread_request",
                             {**where, "tool": name, "field": f"threads[{i}].prompt"})
            return
        field, kind = TOOLS[tail]
        value = args.get(field)
        if value is None and tail == "send_input":
            value = text_parts(args.get("items"))
            field = "items"
        self.add(value, kind, {**where, "tool": name, "field": field,
            "target": args.get("target") or args.get("id") or args.get("threadId")},
            encrypted=field in (encrypted_fields or []))

    def finish(self, coverage):
        for h in self.handles.values():
            h.close()
        with (self.directory / "messages.jsonl").open("w") as out, \
             (self.directory / "messages.csv").open("w", newline="") as csv_out:
            columns = ["message_id", "text", "characters", "words", "observation_count",
                       "kinds", "projects", "style_label", "notes"]
            writer = csv.DictWriter(csv_out, fieldnames=columns)
            writer.writeheader()
            for digest in sorted(self.messages):
                row = self.messages[digest]
                row["kinds"] = sorted(row["kinds"])
                row["projects"] = sorted(row["projects"])
                out.write(json.dumps(row, ensure_ascii=False) + "\n")
                writer.writerow({**row, "kinds": ";".join(row["kinds"]),
                                  "projects": ";".join(row["projects"])})
        self.counts["unique_plaintext_bodies"] = len(self.messages)
        self.counts["unique_opaque_payloads"] = len(self.opaque_ids)
        files = {}
        for path in sorted(self.directory.iterdir()):
            if path.suffix in [".csv", ".jsonl"]:
                digest = hashlib.sha256()
                with path.open("rb") as inp:
                    for chunk in iter(lambda: inp.read(1024 * 1024), b""):
                        digest.update(chunk)
                files[path.name] = {"bytes": path.stat().st_size, "sha256": digest.hexdigest()}
        manifest = {"schema_version": 1, "started_at": self.started_at,
            "completed_at": now(), "counts": dict(self.counts),
            "plaintext_observations_by_source": dict(self.source_counts),
            "coverage": coverage, "files": files,
            "labels": "Unlabeled. Historical keyword matches are not ground truth.",
            "limitations": ["Opaque payloads are not plaintext test cases.",
                "Observations include mirrors and inherited records, not just distinct deliveries.",
                "Live databases and rollouts are not an atomic cross-source snapshot.",
                "Attachments and referenced documents are not expanded.",
                "Worker commentary and peer requests are separate from delegation inputs."]}
        (self.directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        return manifest


def database(path):
    return sqlite3.connect("file:" + str(path) + "?mode=ro", uri=True)


def export_t3(corpus, path):
    db = database(path)
    projects = {r[0]: r[1] for r in db.execute("select project_id,title from projection_projects")}
    threads = {}
    for tid, pid, title, payload in db.execute(
            "select thread_id,project_id,title,payload_json from orchestration_v2_projection_threads"):
        item = json.loads(payload)
        threads[tid] = {"project": projects.get(pid, pid), "project_id": pid,
            "thread_id": tid, "thread_title": title,
            "is_child": (item.get("lineage") or {}).get("relationshipToParent") == "subagent",
            "saved_model_selection": (item.get("modelSelection") or {}).get("model")}
    native = {}
    for tid, payload in db.execute("select thread_id,payload_json from orchestration_v2_projection_provider_threads"):
        item = json.loads(payload)
        nid = (item.get("nativeThreadRef") or {}).get("nativeId")
        if nid and tid in threads:
            native[nid] = dict(threads[tid])
    for mid, tid, role, stamp, payload in db.execute(
            "select message_id,thread_id,role,created_at,payload_json from orchestration_v2_projection_messages"):
        item = json.loads(payload)
        thread = threads.get(tid, {"thread_id": tid})
        kind = None
        if role == "user" and item.get("createdBy") == "agent":
            kind = "completion_notification" if item.get("delegatedCompletion") else "agent_delivery"
        elif role == "assistant" and thread.get("is_child"):
            kind = "worker_assistant_output"
        if kind:
            corpus.add(item.get("text"), kind, {"source": "t3_messages", **thread,
                "locator": str(path), "item_id": mid, "timestamp": stamp,
                "sender_thread_id": item.get("senderThreadId"), "role": role})
    for iid, tid, typ, payload in db.execute(
            "select turn_item_id,thread_id,type,payload_json from orchestration_v2_projection_turn_items "
            "where type in ('dynamic_tool','subagent')"):
        item = json.loads(payload)
        where = {"source": "t3_turn_items", "locator": str(path), "item_id": iid,
                 **threads.get(tid, {"thread_id": tid}), "timestamp": item.get("startedAt")}
        if typ == "dynamic_tool":
            corpus.tool(item.get("toolName"), item.get("input"), where)
        else:
            for field, kind in [("prompt", "assignment"), ("result", "worker_report")]:
                corpus.add(text_parts(item.get(field)), kind, {**where, "field": field,
                    "target_thread_id": item.get("childThreadId")})
    for iid, tid, payload in db.execute(
            "select subagent_id,thread_id,payload_json from orchestration_v2_projection_subagents"):
        item = json.loads(payload)
        where = {"source": "t3_subagents", "locator": str(path), "item_id": iid,
                 **threads.get(tid, {"thread_id": tid}), "timestamp": item.get("startedAt")}
        for field, kind in [("prompt", "assignment"), ("result", "worker_report")]:
            corpus.add(text_parts(item.get(field)), kind, {**where, "field": field})
        if not item.get("prompt"):
            corpus.gap("subagent_prompt_not_recorded", **where)
    db.close()
    print("T3 exported", len(corpus.messages), "unique plaintext bodies", flush=True)
    return native, list(threads.values())


def export_history(corpus, path, native):
    db = database(path)
    for sid, iid, stamp, typ, payload in db.execute(
            "select thread_id,item_id,created_at_ms,item_type,item_json from thread_items "
            "where item_type in ('collabAgentToolCall','mcpToolCall','agentMessage')"):
        item = json.loads(payload)
        meta = native.get(sid, {})
        where = {"source": "codex_history", "locator": str(path), "item_id": iid,
            **meta, "native_thread_id": sid, "timestamp_ms": stamp}
        if typ == "collabAgentToolCall":
            if item.get("prompt"):
                corpus.add(item["prompt"], "native_agent_prompt", {**where, "tool": item.get("tool")})
            elif item.get("tool") in ["spawnAgent", "spawn_agent", "sendMessage", "send_message", "followupTask"]:
                corpus.gap("projected_native_prompt_unavailable", **where)
            for target, state in (item.get("agentsStates") or {}).items():
                if isinstance(state, dict):
                    corpus.add(state.get("message"), "worker_report", {**where, "field": target})
        elif typ == "mcpToolCall":
            corpus.tool(item.get("tool"), item.get("arguments"), where)
        elif meta.get("is_child"):
            corpus.add(item.get("text"), "worker_" + (item.get("phase") or "assistant_output"), where)
    db.close()
    print("Codex history exported", len(corpus.messages), "unique plaintext bodies", flush=True)


def export_rollout(corpus, path, meta):
    model = None
    sid = meta.get("native_thread_id")
    child = meta.get("is_child", False)
    try:
        with path.open("rb") as inp:
            initial_size = os.fstat(inp.fileno()).st_size
            for number, raw in enumerate(inp, 1):
                if not any(x in raw for x in [b'"session_meta"', b'"turn_context"',
                    b'"function_call"', b'collab_agent_', b'"agent_message"', b'"role": "assistant"', b'"role":"assistant"']):
                    continue
                try:
                    record = json.loads(raw)
                except (ValueError, UnicodeDecodeError):
                    corpus.gap("invalid_rollout_json", locator=str(path), line=number)
                    continue
                payload = record.get("payload") or {}
                if not isinstance(payload, dict):
                    continue
                typ = record.get("type")
                if typ == "session_meta":
                    sid = payload.get("id", sid)
                    source = payload.get("source")
                    child = child or (isinstance(source, dict) and "thread_spawn" in str(source))
                if typ == "turn_context":
                    model = payload.get("model", model)
                where = {"source": "codex_rollout", "locator": str(path), "line": number,
                    **meta, "native_thread_id": sid, "timestamp": record.get("timestamp"),
                    "model": model, "model_attribution": "preceding_turn_context" if model else "unknown"}
                ptype = payload.get("type", "")
                if typ == "response_item" and ptype == "function_call":
                    name = payload.get("name", "")
                    namespace = payload.get("namespace")
                    corpus.tool((namespace + "." if namespace else "") + name,
                        payload.get("arguments"), {**where, "item_id": payload.get("call_id")},
                        payload.get("encrypted_function_args"))
                elif typ == "event_msg" and ptype.startswith("collab_agent_"):
                    corpus.add(payload.get("prompt"), "native_agent_prompt", {**where,
                        "item_id": payload.get("call_id"), "field": "prompt", "event": ptype})
                    corpus.add(payload.get("message"), "native_agent_message", {**where,
                        "item_id": payload.get("call_id"), "field": "message", "event": ptype})
                elif child and typ == "response_item" and payload.get("role") == "assistant":
                    corpus.add(text_parts(payload.get("content")),
                        "worker_" + (payload.get("phase") or "assistant_output"),
                        {**where, "item_id": payload.get("id")})
                elif child and typ == "event_msg" and ptype == "agent_message":
                    corpus.add(payload.get("message"), "worker_report", where)
                if inp.tell() >= initial_size:
                    break
    except OSError as exc:
        corpus.gap("unreadable_rollout", locator=str(path), error=str(exc))


def cached_text(record):
    item = record.get("item") or {}
    return record.get("text") or record.get("body") or (item.get("text") if isinstance(item, dict) else None)


def export_caches(corpus, directories, native, t3_threads):
    names = ["other-raw-handoffs.json", "other-inspectable-handoffs.json",
             "model-control-calls.json", "model-control-finals.json", "other-control-returns.json",
             "positive-model-attribution.json"]
    used = []
    t3_by_id = {item["thread_id"]: item for item in t3_threads}
    for directory in directories:
        for name in names:
            path = directory / name
            if not path.is_file():
                continue
            records = json.loads(path.read_text())
            if not isinstance(records, list):
                continue
            used.append(str(path))
            for index, record in enumerate(records):
                if not isinstance(record, dict):
                    continue
                value = cached_text(record)
                sid = record.get("session") or record.get("sid")
                tid = record.get("thread") or record.get("sender")
                context = record.get("context") or {}
                corpus.add(value, "cached_worker_report" if ("final" in name or "return" in name)
                    else "cached_agent_message", {"source": "audit_cache", "locator": str(path),
                    **native.get(sid, t3_by_id.get(tid, {})),
                    "item_id": str(index), "native_thread_id": sid,
                    "cache_thread_id": tid, "cwd": record.get("cwd"),
                    "timestamp": record.get("date"), "tool": record.get("tool"),
                    "original_rollout": record.get("path"),
                    "model": context.get("model") if isinstance(context, dict) else None,
                    "model_attribution": "evidence_cache; inspect original context for attribution"})
    return used


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "data/private")
    parser.add_argument("--codex-home", type=Path, default=Path.home() / ".codex")
    parser.add_argument("--t3-db", type=Path, default=Path.home() / ".t3/userdata/statev2.sqlite")
    parser.add_argument("--evidence-cache", type=Path, action="append", default=[])
    args = parser.parse_args()
    os.umask(0o077)
    corpus = Corpus(args.output)
    native, t3_threads = export_t3(corpus, args.t3_db)
    state = database(args.codex_home / "state_5.sqlite")
    paths = {}
    for sid, path, source, cwd, title in state.execute("select id,rollout_path,source,cwd,title from threads"):
        item = native.setdefault(sid, {})
        item.update({"native_thread_id": sid, "cwd": cwd, "native_thread_title": title})
        item["is_child"] = item.get("is_child", False) or "thread_spawn" in source
        paths[Path(path)] = item
    state.close()
    for item in native.values():
        if item.get("project"):
            continue
        cwd = item.get("cwd") or ""
        for title in ["ai-assistant", "atelier", "team-standup", ".agents", "webexctl", "jiracli", "dc34"]:
            if any(part == title or part.startswith(title + "-") for part in Path(cwd).parts):
                item["project"] = title
                item["project_attribution"] = "inferred_from_cwd"
                break
    export_history(corpus, args.codex_home / "thread_history_1.sqlite", native)
    for folder in ["sessions", "archived_sessions"]:
        for path in (args.codex_home / folder).rglob("*.jsonl"):
            paths.setdefault(path, {})
    for index, (path, meta) in enumerate(sorted(paths.items()), 1):
        export_rollout(corpus, path, meta)
        if index % 200 == 0:
            print(f"Rollouts {index}/{len(paths)}; {len(corpus.messages)} unique plaintext bodies", flush=True)
    caches = export_caches(corpus, args.evidence_cache, native, t3_threads)
    manifest = corpus.finish({"t3_database": str(args.t3_db), "t3_threads": len(t3_threads),
        "codex_state_database": str(args.codex_home / "state_5.sqlite"),
        "codex_history_database": str(args.codex_home / "thread_history_1.sqlite"),
        "rollout_files_attempted": len(paths), "evidence_caches": caches,
        "filters": {"projects": "all", "dates": "all", "models": "all"}})
    print(json.dumps(manifest["counts"], sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
