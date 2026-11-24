"""Synthetic regressions for review-to-message mapping and immutable records."""
import contextlib
import importlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/legacy'))
triage = importlib.import_module('triage_handoffs')
review = importlib.import_module('review_handoffs')


class ReviewCoverageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        stack=contextlib.ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.object(triage, 'RUN', self.root))
        stack.enter_context(patch.object(review, 'RUN', self.root))
        self.rows = [{'index': 0, 'message_id': 'a'*64, 'characters': 18, 'text': 'Review the parser.', 'primary_batch': 0},
                     {'index': 1, 'message_id': 'b'*64, 'characters': 15, 'text': 'Check the diff.', 'primary_batch': 0}]
        triage.private_json(self.root/'batches/00.json', {'pages': [self.rows]})
        triage.private_json(self.root/'repair-inputs/00.json', {'pages': [self.rows]})
        triage.private_json(self.root/'views/00-00.json', {'message_ids': [r['message_id'] for r in self.rows]})
        triage.private_json(self.root/'repair-views/00-00.json', {'message_ids': [r['message_id'] for r in self.rows]})

    def decision(self, row):
        return {'index': row['index'], 'message_id': row['message_id'], 'style_label': 'normal',
                'confidence': 'high', 'issues': [], 'rationale': 'A readable ordinary instruction.',
                'full_message_reviewed': True}

    def test_primary_rejects_page_index_drift(self):
        path=self.root/'decisions-00-0.json'
        path.write_text(json.dumps([self.decision(self.rows[0])]))
        with self.assertRaisesRegex(AssertionError, 'actual page indices'):
            triage.record(0,path)
        self.assertFalse((self.root/'labels/00.jsonl').exists())

    def test_repair_requires_exact_message_ids(self):
        rows=[self.decision(r) for r in self.rows]
        rows[1]['message_id']='c'*64
        path=self.root/'decision.json';path.write_text(json.dumps(rows))
        with self.assertRaisesRegex(AssertionError, 'exact message_id'):
            review.record(0,0,path)

    def test_record_is_complete_private_and_cannot_be_overwritten(self):
        path=self.root/'decision.json'
        path.write_text(json.dumps([self.decision(r) for r in self.rows]))
        with contextlib.redirect_stdout(io.StringIO()):
            review.record(0,0,path)
        target=self.root/'repairs/00-00.jsonl'
        before=target.read_bytes()
        self.assertEqual(len(review.read_jsonl(target)),2)
        self.assertEqual(target.stat().st_mode & 0o777,0o600)
        with self.assertRaisesRegex(AssertionError, 'already recorded'):
            review.record(0,0,path)
        self.assertEqual(target.read_bytes(),before)

    def test_unread_page_cannot_be_recorded(self):
        (self.root/'repair-views/00-00.json').unlink()
        path=self.root/'decision.json'
        path.write_text(json.dumps([self.decision(r) for r in self.rows]))
        with self.assertRaisesRegex(AssertionError, 'full page first'):
            review.record(0,0,path)
