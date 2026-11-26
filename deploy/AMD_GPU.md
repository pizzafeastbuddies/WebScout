# WebScout on an AMD Developer Cloud GPU Droplet (ROCm)

## What needs the GPU

| Part | GPU? |
|---|---|
| UI, search, fetch, extract, verify, abstain (`src/`, `engine/`) | No. Runs in the browser. |
| `deploy/nginx*.conf` web server | No |
| Optional model server (vLLM, `docker-compose.gpu.yml`) | **Yes, AMD ROCm** |
| `engine/adapters/openaiCompatible.ts` (client for that server) | No, it only calls it |

The deterministic engine never needs the GPU. If vLLM is down, WebScout keeps working.

## Stack (pinned)

| Item | Value | Source |
|---|---|---|
| GPU | AMD Instinct MI300X, `gfx942` (CDNA3) | ROCm compatibility matrix |
| Host OS | Ubuntu 24.04 (Droplet "ROCm Software" Quick Start image) | AMD Developer Cloud |
| Host driver | `amdgpu`, preinstalled on that image | AMD Developer Cloud |
| Container | `rocm/vllm:rocm7.14.1_cdna_ubuntu24.04_py3.14_pytorch_2.11_vllm_0.23.0` | ROCm vLLM docs |
| Model | `Qwen/Qwen2.5-7B-Instruct` (no Hugging Face token needed) | override with `MODEL` |

Rule: the container's ROCm version must be supported by the host driver.
Check with `amd-smi version` on the Droplet. If the host image is newer (for example ROCm 10.x,
driver 31.70+), set `VLLM_IMAGE` to the matching tag from the
[ROCm vLLM docs](https://rocm.docs.amd.com/en/latest/how-to/rocm-for-ai/inference/benchmark-docker/vllm.html).

## Steps when GPU approval arrives

1. Create a **single MI300X** GPU Droplet. Choose the **ROCm Software** Quick Start image. Add your SSH key.
2. In the Droplet firewall, open inbound **22** and **80** only. Do not open 8000.
3. SSH in and check the GPU:
   ```bash
   ssh root@DROPLET_IP
   amd-smi version && amd-smi list
   ls -l /dev/kfd /dev/dri
   docker --version || (apt-get update && apt-get install -y docker.io docker-compose-v2)
   ```
4. Get WebScout:
   ```bash
   git clone https://github.com/pizzafeastbuddies/WebScout && cd WebScout
   git checkout feat/amd-rocm-gpu   # until merged to main
   ```
5. Optional settings, in a `.env` file next to the compose files (never commit it):
   ```bash
   MODEL=Qwen/Qwen2.5-7B-Instruct
   # VLLM_IMAGE=rocm/vllm:<tag matching amd-smi version>
   # HF_TOKEN=...          # only for gated models
   # VLLM_API_KEY=...      # require a key on the model server
   # MODELS_DIR=/mnt/models
   ```
6. Start:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
   ```
   The first start pulls a large image and downloads the model. Allow 10 to 20 minutes.
7. Verify:
   ```bash
   bash deploy/gpu-check.sh --container
   curl -i http://127.0.0.1/healthz      # 200 ok
   curl -i http://127.0.0.1/gpu-health   # 200 = GPU serving, 503 = not ready
   ```
   From your PC open `http://DROPLET_IP/`.

## Operate

| Task | Command |
|---|---|
| Logs | `docker compose -f docker-compose.yml -f docker-compose.gpu.yml logs -f` |
| Model logs only | `docker compose -f docker-compose.yml -f docker-compose.gpu.yml logs -f vllm` |
| Restart | `docker compose -f docker-compose.yml -f docker-compose.gpu.yml restart` |
| Update | `git pull && docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build` |
| Stop | `docker compose -f docker-compose.yml -f docker-compose.gpu.yml down` |
| GPU use | `amd-smi monitor` |
| CPU only (no GPU) | `docker compose up -d --build` |

## Debug the model

Port 8000 is never public. Test vLLM from inside the Droplet:
```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml exec vllm \
  python3 -c "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8000/v1/models').read().decode())"
```

## Cost

A GPU Droplet bills while it exists, even when idle. Destroy it when you are done.
