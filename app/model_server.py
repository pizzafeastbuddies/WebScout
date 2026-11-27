#!/usr/bin/env python3
"""Minimal OpenAI-compatible model server for WebScout (resident, loads the model once).

Endpoints (what engine/adapters/openaiCompatible.ts calls):
  GET  /health            -> 200 when the model is loaded
  GET  /v1/models         -> {"data":[{"id": <model>}]}
  POST /v1/chat/completions {"messages":[...], "temperature":0, "max_tokens":N}

No vLLM, no framework: transformers + the ROCm torch that ships in the base image.
Install transformers with `pip install --no-deps` so pip never swaps in a CUDA torch.

UNTESTED ON A GPU. First real run is in the AMD notebook. Environment:
  WEBSCOUT_MODEL       Hugging Face id (default Qwen/Qwen2.5-1.5B-Instruct)
  WEBSCOUT_MODEL_DIR   weights cache (default /models)
  WEBSCOUT_MODEL_PORT  default 8000 (127.0.0.1 only)
  WEBSCOUT_MAX_NEW     max new tokens (default 64)
"""

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL_ID = os.environ.get("WEBSCOUT_MODEL", "Qwen/Qwen2.5-1.5B-Instruct")
MODEL_DIR = os.environ.get("WEBSCOUT_MODEL_DIR", "/models")
PORT = int(os.environ.get("WEBSCOUT_MODEL_PORT", "8000"))
MAX_NEW = int(os.environ.get("WEBSCOUT_MAX_NEW", "64"))
MAX_BODY = 256 * 1024

state = {"ready": False, "model": None, "tokenizer": None, "device": "cpu", "lock": threading.Lock()}


def log(**fields):
    print(json.dumps({"at": time.strftime("%Y-%m-%dT%H:%M:%S"), **fields}), flush=True)


def load():
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    version = torch.__version__
    if "rocm" not in version and "hip" not in version.lower() and not getattr(torch.version, "hip", None):
        # Not fatal for a dry run, but in the container this means pip replaced ROCm torch.
        log(event="warning", message="torch does not look like a ROCm build", torch=version)
    device = "cuda" if torch.cuda.is_available() else "cpu"  # ROCm GPUs appear as "cuda" in torch
    started = time.time()
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, cache_dir=MODEL_DIR)
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID, cache_dir=MODEL_DIR, torch_dtype=torch.bfloat16 if device == "cuda" else torch.float32
    ).to(device)
    model.eval()
    state.update(model=model, tokenizer=tokenizer, device=device, ready=True)
    vram = round(torch.cuda.memory_allocated() / 2**30, 2) if device == "cuda" else 0
    log(event="loaded", model=MODEL_ID, device=device, torch=version, seconds=round(time.time() - started, 1), vram_gib=vram)


def generate(messages, max_new):
    import torch

    tokenizer, model = state["tokenizer"], state["model"]
    prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(prompt, return_tensors="pt").to(state["device"])
    with state["lock"], torch.no_grad():  # one generation at a time keeps VRAM predictable
        output = model.generate(**inputs, max_new_tokens=max_new, do_sample=False, pad_token_id=tokenizer.eos_token_id)
    return tokenizer.decode(output[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, status, body):
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            return self.reply(200 if state["ready"] else 503, {"ready": state["ready"], "device": state["device"]})
        if self.path == "/v1/models":
            return self.reply(200, {"data": [{"id": MODEL_ID}]})
        return self.reply(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            return self.reply(404, {"error": "not_found"})
        if not state["ready"]:
            return self.reply(503, {"error": "loading"})
        try:
            length = int(self.headers.get("content-length", 0))
            if length > MAX_BODY:
                return self.reply(413, {"error": "too_large"})
            request = json.loads(self.rfile.read(length))
            messages = [m for m in request.get("messages", []) if isinstance(m, dict)]
            max_new = min(int(request.get("max_tokens") or MAX_NEW), 256)
            started = time.time()
            text = generate(messages, max_new)
            log(event="completion", ms=int((time.time() - started) * 1000), chars=len(text))
            return self.reply(200, {"model": MODEL_ID, "choices": [{"index": 0, "message": {"role": "assistant", "content": text}}]})
        except Exception as error:  # never crash the server on one bad request
            log(event="error", message=str(error)[:200])
            return self.reply(500, {"error": "generation_failed"})


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    log(event="listening", port=PORT, model=MODEL_ID)
    try:
        load()
    except Exception as error:
        log(event="load_failed", message=str(error)[:300])
        return 1
    threading.Event().wait()  # keep serving
    return 0


if __name__ == "__main__":
    sys.exit(main())
