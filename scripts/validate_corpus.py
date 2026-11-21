#!/usr/bin/env python3
"""Verify corpus integrity without printing historical message contents."""

import collections
import csv
import hashlib
import json
from pathlib import Path
import sys

from export_corpus import ciphertext


def validate(directory):
    directory = Path(directory)
    manifest = json.loads((directory / "manifest.json").read_text())
    messages = {}
    for line in (directory / "messages.jsonl").open():
        row = json.loads(line)
        digest = hashlib.sha256(row["text"].encode("utf-8")).hexdigest()
        assert row["message_id"] == digest, "Message hash mismatch"
        assert digest not in messages, "Duplicate plaintext body"
        assert row["characters"] == len(row["text"]), "Character count mismatch"
        assert row["words"] == len(row["text"].split()), "Word count mismatch"
        assert not ciphertext(row["text"]), "Ciphertext in plaintext set"
        messages[digest] = row
    observed = collections.Counter()
    kinds = collections.Counter()
    projects = set()
    timestamps = []
    for line in (directory / "observations.jsonl").open():
        row = json.loads(line)
        assert row["message_id"] in messages, "Unresolved observation"
        assert row.get("locator"), "Missing source locator"
        observed[row["message_id"]] += 1
        kinds[row["kind"]] += 1
        projects.add(row.get("project") or "unknown")
        stamp = row.get("timestamp")
        if isinstance(stamp, str):
            timestamps.append(stamp)
    for digest, row in messages.items():
        assert observed[digest] == row["observation_count"], "Observation count mismatch"
    csv.field_size_limit(sys.maxsize)
    csv_ids = set()
    with (directory / "messages.csv").open(newline="") as inp:
        for row in csv.DictReader(inp):
            digest = row["message_id"]
            assert digest not in csv_ids, "Duplicate CSV row"
            csv_ids.add(digest)
            assert messages[digest]["text"] == row["text"], "CSV changed message text"
    assert csv_ids == messages.keys(), "CSV and JSONL differ"
    assert len(messages) == manifest["counts"]["unique_plaintext_bodies"]
    assert sum(observed.values()) == manifest["counts"]["plaintext_observations"]
    for name, expected in manifest["files"].items():
        path = directory / name
        digest = hashlib.sha256()
        with path.open("rb") as inp:
            for chunk in iter(lambda: inp.read(1024 * 1024), b""):
                digest.update(chunk)
        assert path.stat().st_size == expected["bytes"], f"Size mismatch: {name}"
        assert digest.hexdigest() == expected["sha256"], f"Checksum mismatch: {name}"
    print(json.dumps({"verified_unique_plaintext_bodies": len(messages),
        "verified_observations": sum(observed.values()),
        "observation_kinds": dict(kinds), "projects": sorted(projects),
        "earliest_timestamp": min(timestamps) if timestamps else None,
        "latest_timestamp": max(timestamps) if timestamps else None}, indent=2))


if __name__ == "__main__":
    validate(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "data/private")
