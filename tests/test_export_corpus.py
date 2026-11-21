import base64
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("export_corpus", Path(__file__).resolve().parents[1] / "scripts/export_corpus.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CorpusExportTests(unittest.TestCase):
    def test_cached_history_records_keep_their_message_text(self):
        self.assertEqual(module.cached_text({"item": {"text": "Recorded final report"}}),
                         "Recorded final report")

    def test_exact_text_and_distinct_provenance_survive_deduplication(self):
        with tempfile.TemporaryDirectory() as tmp:
            corpus = module.Corpus(tmp)
            text = '  Review this, please.\n"Quoted text" and café.  '
            corpus.add(text, "assignment", {"source": "test", "locator": "one", "item_id": "1"})
            corpus.add(text, "assignment", {"source": "test", "locator": "one", "item_id": "1"})
            corpus.add(text, "agent_message", {"source": "test", "locator": "two", "item_id": "2"})
            manifest = corpus.finish({})
            rows = [json.loads(x) for x in (Path(tmp) / "messages.jsonl").read_text().splitlines()]
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["text"], text)
            self.assertEqual(rows[0]["observation_count"], 2)
            self.assertEqual(manifest["counts"]["plaintext_observations"], 2)

    def test_opaque_payloads_never_become_plaintext_examples(self):
        with tempfile.TemporaryDirectory() as tmp:
            corpus = module.Corpus(tmp)
            token = base64.urlsafe_b64encode(b"\x80" + b"\x00" * 72).decode()
            self.assertTrue(module.ciphertext(token))
            corpus.add(token, "assignment", {"source": "test", "locator": "one"})
            corpus.add("other encrypted transport", "assignment",
                       {"source": "test", "locator": "two"}, encrypted=True)
            manifest = corpus.finish({})
            self.assertEqual(manifest["counts"]["opaque_observations"], 2)
            self.assertEqual((Path(tmp) / "messages.jsonl").read_text(), "")

    def test_tool_aliases_and_batch_prompts_are_extracted(self):
        with tempfile.TemporaryDirectory() as tmp:
            corpus = module.Corpus(tmp)
            for index, name in enumerate(["agents.spawn_agent", "mcp__t3_code__delegate_task", "t3-code_t3_thread_send"]):
                corpus.tool(name, {"message": "Message " + str(index), "task": "Task " + str(index)},
                            {"source": "test", "locator": str(index)})
            corpus.tool("create_threads", {"threads": [{"prompt": "Peer task"}, {}]},
                        {"source": "test", "locator": "batch"})
            manifest = corpus.finish({})
            self.assertEqual(manifest["counts"]["unique_plaintext_bodies"], 4)

    def test_raw_calls_use_preceding_context_and_do_not_extract_js_literals(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            records = [
                {"type": "turn_context", "payload": {"model": "historical-model"}},
                {"type": "response_item", "payload": {"type": "function_call", "namespace": "agents",
                    "name": "spawn_agent", "call_id": "call-1", "arguments": json.dumps({"message": "Actual task"})}},
                {"type": "response_item", "payload": {"type": "custom_tool_call", "name": "exec",
                    "input": 'await tools.agents__spawn_agent({message:"Not a recorded call"});'}},
            ]
            path = tmp / "rollout.jsonl"
            path.write_text("".join(json.dumps(x) + "\n" for x in records))
            corpus = module.Corpus(tmp / "out")
            module.export_rollout(corpus, path, {})
            corpus.finish({})
            observations = [json.loads(x) for x in (tmp / "out/observations.jsonl").read_text().splitlines()]
            self.assertEqual(len(observations), 1)
            self.assertEqual(observations[0]["model"], "historical-model")


if __name__ == "__main__":
    unittest.main()
