#!/usr/bin/env python3
"""WebScout competition entry point: a thin client for the resident engine server.

The grader starts a new process for every question, so this script holds no model
and no index. It sends the question to the engine server (app/engine-server.ts,
started by the container CMD) and writes one JSON file.

Match 4's exact arguments and output fields are NOT public. So:
  * unknown arguments are ignored, never an error;
  * field names and the output path come from contract.json;
  * a result file is always written, even when everything fails.

Standard library only: nothing here can replace the ROCm torch in the base image.
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CONTRACT_PATH = os.environ.get("WEBSCOUT_CONTRACT", os.path.join(HERE, "contract.json"))
BUNDLE_PATH = os.environ.get("WEBSCOUT_BUNDLE", os.path.join(HERE, "..", "dist-server", "engine-server.mjs"))

DEFAULT_CONTRACT = {
    "outputDir": "/app/output",
    "outputFile": "{queryId}_output.json",
    "defaultQueryId": "query",
    "fields": {"answer": "answer", "citations": "citations", "sources": "sources", "confidence": "confidence"},
    "engineUrl": "http://127.0.0.1:8765",
    "requestTimeoutSeconds": 27,
}


def load_contract(path=CONTRACT_PATH):
    contract = json.loads(json.dumps(DEFAULT_CONTRACT))
    try:
        with open(path, encoding="utf-8") as handle:
            loaded = json.load(handle)
        fields = {**contract["fields"], **loaded.get("fields", {})}
        contract.update({k: v for k, v in loaded.items() if not k.startswith("_")})
        contract["fields"] = fields
    except (OSError, ValueError):
        pass  # fall back to defaults; a broken contract file must not stop an answer
    return contract


def parse_args(argv):
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--query", "--question", dest="query", default="")
    parser.add_argument("--query-id", "--id", dest="query_id", default="")
    parser.add_argument("--url", "--start-url", dest="url", default="")
    parser.add_argument("--output-dir", dest="output_dir", default="")
    parser.add_argument("--index", dest="index", nargs="?", const="", default=None)
    parser.add_argument("--corpus", dest="corpus", default="")
    parser.add_argument("--input", dest="input", default="")  # batch file of questions
    args, _unknown = parser.parse_known_args(argv)  # tolerate arguments we do not know
    return args


def healthy(base_url, timeout=1.5):
    try:
        with urllib.request.urlopen(base_url + "/healthz", timeout=timeout) as response:
            return response.status == 200
    except (OSError, ValueError):
        return False


def ensure_engine(base_url, wait_seconds=10.0):
    """The container CMD normally starts the engine. If it is not up, start it once."""
    if healthy(base_url):
        return True
    if os.path.exists(BUNDLE_PATH):
        try:
            subprocess.Popen(
                ["node", BUNDLE_PATH],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        except OSError:
            return False
    deadline = time.time() + wait_seconds
    while time.time() < deadline:
        if healthy(base_url):
            return True
        time.sleep(0.25)
    return False


def ask_engine(base_url, question, url, timeout):
    body = json.dumps({"question": question, "url": url or None}).encode("utf-8")
    request = urllib.request.Request(
        base_url + "/answer", data=body, headers={"content-type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def build_result(contract, payload):
    """Always returns a complete, well-typed record. Missing data becomes empty, never absent."""
    fields = contract["fields"]
    answer = payload.get("answer") if isinstance(payload, dict) else ""
    answer = answer.strip() if isinstance(answer, str) else ""
    sources = payload.get("sources") if isinstance(payload, dict) else []
    sources = [s for s in sources if isinstance(s, str)] if isinstance(sources, list) else []
    confidence = payload.get("confidence") if isinstance(payload, dict) else 0.0
    confidence = float(confidence) if isinstance(confidence, (int, float)) else 0.0
    if not answer:
        sources, confidence = [], 0.0  # an empty answer never carries sources
    return {
        fields["answer"]: answer,
        fields["citations"]: sources,
        fields["sources"]: sources,
        fields["confidence"]: max(0.0, min(1.0, confidence)),
    }


def output_path(contract, query_id, output_dir):
    directory = output_dir or os.environ.get("WEBSCOUT_OUTPUT") or contract["outputDir"]
    name = contract["outputFile"].replace("{queryId}", query_id)
    return os.path.join(directory, os.path.basename(name))


def write_result(path, result):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False)
    os.replace(temporary, path)  # the grader never sees a half-written file


def answer_one(contract, question, url):
    base_url = os.environ.get("WEBSCOUT_ENGINE_URL", contract["engineUrl"]).rstrip("/")
    try:
        if not question.strip() or not ensure_engine(base_url):
            return build_result(contract, {})
        return build_result(contract, ask_engine(base_url, question, url, contract["requestTimeoutSeconds"]))
    except (OSError, ValueError, urllib.error.URLError):
        return build_result(contract, {})


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    contract = load_contract()

    if args.index is not None and not args.query:
        return 0  # nothing to index: WebScout reads the live web

    if args.input:
        try:
            with open(args.input, encoding="utf-8") as handle:
                tasks = json.load(handle)
        except (OSError, ValueError):
            tasks = []
        for number, task in enumerate(tasks if isinstance(tasks, list) else [], start=1):
            task = task if isinstance(task, dict) else {}
            query_id = str(task.get("id") or task.get("query_id") or f"query_{number:02d}")
            result = answer_one(contract, str(task.get("query") or task.get("question") or ""), str(task.get("url") or ""))
            write_result(output_path(contract, query_id, args.output_dir), result)
        return 0

    query_id = args.query_id or contract["defaultQueryId"]
    result = answer_one(contract, args.query, args.url)
    write_result(output_path(contract, query_id, args.output_dir), result)
    print(json.dumps({"id": query_id, **result}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # last resort: never crash the grader
        sys.exit(0)
