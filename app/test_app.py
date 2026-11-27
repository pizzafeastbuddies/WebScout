"""Offline contract tests for app.py. Run: python -m unittest discover -s app -p "test_*.py" """

import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

import app


class FakeEngine(BaseHTTPRequestHandler):
    reply = {"answer": "Santiago", "confidence": 0.9, "sources": ["https://example.org/chile"]}

    def log_message(self, *args):
        pass

    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"{}")

    def do_POST(self):
        length = int(self.headers.get("content-length", 0))
        self.rfile.read(length)
        body = json.dumps(self.reply).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(body)


class AppContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), FakeEngine)
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        self.out = tempfile.mkdtemp()
        os.environ["WEBSCOUT_ENGINE_URL"] = self.url

    def run_app(self, *argv):
        code = app.main(list(argv))
        self.assertEqual(code, 0)

    def read(self, name):
        with open(os.path.join(self.out, name), encoding="utf-8") as handle:
            return json.load(handle)

    def test_writes_answer_citations_sources_confidence(self):
        self.run_app("--query-id", "q01", "--query", "Capital of Chile?", "--output-dir", self.out)
        data = self.read("q01_output.json")
        self.assertEqual(data["answer"], "Santiago")
        self.assertEqual(data["citations"], ["https://example.org/chile"])
        self.assertEqual(data["sources"], data["citations"])
        self.assertIsInstance(data["confidence"], float)

    def test_unknown_arguments_are_ignored(self):
        self.run_app("--query-id", "q02", "--query", "x", "--whatever", "1", "--output-dir", self.out)
        self.assertTrue(os.path.exists(os.path.join(self.out, "q02_output.json")))

    def test_empty_answer_has_no_sources(self):
        FakeEngine.reply = {"answer": "", "confidence": 0.7, "sources": ["https://example.org/x"]}
        try:
            self.run_app("--query-id", "q03", "--query", "Unknown?", "--output-dir", self.out)
        finally:
            FakeEngine.reply = {"answer": "Santiago", "confidence": 0.9, "sources": ["https://example.org/chile"]}
        data = self.read("q03_output.json")
        self.assertEqual(data["answer"], "")
        self.assertEqual(data["citations"], [])
        self.assertEqual(data["confidence"], 0.0)

    def test_engine_down_still_writes_an_empty_answer(self):
        os.environ["WEBSCOUT_ENGINE_URL"] = "http://127.0.0.1:1"
        app.BUNDLE_PATH = os.path.join(self.out, "missing.mjs")
        self.run_app("--query-id", "q04", "--query", "Anything?", "--output-dir", self.out)
        data = self.read("q04_output.json")
        self.assertEqual(data["answer"], "")
        self.assertEqual(data["citations"], [])

    def test_missing_query_still_writes_a_file(self):
        self.run_app("--query-id", "q05", "--output-dir", self.out)
        self.assertEqual(self.read("q05_output.json")["answer"], "")

    def test_garbage_arguments_do_not_crash(self):
        self.run_app("--%%%", "\x00", "--output-dir", self.out)

    def test_index_is_a_no_op(self):
        self.run_app("--index", "/app/corpus")
        self.assertEqual(os.listdir(self.out), [])

    def test_batch_input_writes_one_file_per_task(self):
        tasks = os.path.join(self.out, "tasks.json")
        with open(tasks, "w", encoding="utf-8") as handle:
            json.dump([{"id": "a1", "query": "one"}, {"id": "a2", "query": "two"}], handle)
        self.run_app("--input", tasks, "--output-dir", self.out)
        self.assertEqual(self.read("a1_output.json")["answer"], "Santiago")
        self.assertTrue(os.path.exists(os.path.join(self.out, "a2_output.json")))

    def test_contract_file_controls_field_names(self):
        contract = app.load_contract()
        contract["fields"] = {"answer": "text", "citations": "files", "sources": "urls", "confidence": "score"}
        result = app.build_result(contract, {"answer": "x", "sources": ["u"], "confidence": 2})
        self.assertEqual(result, {"text": "x", "files": ["u"], "urls": ["u"], "score": 1.0})

    def test_broken_contract_file_falls_back_to_defaults(self):
        path = os.path.join(self.out, "bad.json")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("{not json")
        self.assertEqual(app.load_contract(path)["fields"]["answer"], "answer")


if __name__ == "__main__":
    unittest.main()
