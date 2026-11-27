# AMD notebook session runbook (3 hours of GPU quota per day)

Goal of one session: prove the GPU is used, and find the smallest model that raises the benchmark score.
Do everything that does not need the GPU before you press "Launch Notebook". The quota counts from launch.

Notebook limits (from the official "All About the Challenges" PDF): 1 GPU (CDNA or RDNA), 48 GiB, about 25 GB of persistent storage, outbound network is allowed in the pod. Save files under `/persistent` if your URL contains `jupyter-hack-`, or `/workspace` if it contains `rgapi-hackathon-`. A pod may only reach an allowlist of sites, so questions that need other sites may fail there. That is a pod limit, not a code bug.

## Before launching (on your PC, no quota used)

1. `git pull` the branch, `npm ci`, `npm run build:server`.
2. Have a Hugging Face token ready only if you choose a gated model. The Qwen2.5 models used below are not gated.
3. Open https://notebooks.amd.com/hackathon in a fresh tab only when you are ready.

## Session plan

| Min | Step | Command | Pass if |
|---|---|---|---|
| 0-5 | Check the GPU and torch | `rocm-smi --showproductname; python3 -c "import torch;print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"` | Version ends in `+rocm...`, `True` |
| 5-15 | Get the code and Node | clone repo; `node -v` (if missing, copy a Node 22 binary or `conda install nodejs`) | `node -v` works |
| 15-30 | Install transformers WITHOUT touching torch | `pip install --no-deps transformers tokenizers safetensors huggingface_hub`, then `python3 -c "import torch;print(torch.__version__)"` | torch version unchanged, still `+rocm` |
| 30-45 | Start the 1.5B model server | `WEBSCOUT_MODEL=Qwen/Qwen2.5-1.5B-Instruct python3 app/model_server.py` | log line `loaded` with `device: cuda` |
| 45-50 | Watch VRAM | `watch -n1 'amd-smi metric --mem'` in a second terminal | Used VRAM above 1 GiB while it runs |
| 50-80 | Run the benchmark with the model | `WEBSCOUT_LLM_URL=http://127.0.0.1:8000/v1 npm run eval` (see below) | A score and median time per question |
| 80-110 | Repeat with 7B only if 1.5B is weak | `WEBSCOUT_MODEL=Qwen/Qwen2.5-7B-Instruct` (15 GB download) | Better score, still under 30 s per question |
| 110-150 | Run the real container path | `bash app/start.sh`, then `python3 app/app.py --query-id q1 --query "..."` | JSON file written, under 30 s |
| 150-170 | Save evidence | copy reports from `eval/results/` to persistent storage | Files saved |
| 170 | **Press "Turn-off Session"** | open the hackathon page in a new tab | Session ended |

Set `WEBSCOUT_LLM_URL` (and optionally `WEBSCOUT_MODEL`) before `npm run eval` to run the benchmark through the model.

## Decision rule for the model

Pick the smallest model that:
1. raises the answerable score clearly above the CPU result (6 of 33 on 2026-11-27),
2. keeps the median time per question under 10 s (grader limit is assumed 30 s),
3. keeps the confident-wrong count at or below the CPU result.

If 1.5B meets all three, stop. Do not download 7B.

## Risks to watch

- pip replaces torch: check the version after every install.
- Python 3.14 wheels: some packages may not have 3.14 builds yet. Note which and tell me.
- A gated or very large download wastes quota. Check size first.
- The notebook is short-lived: copy anything you want to keep before turning it off.
