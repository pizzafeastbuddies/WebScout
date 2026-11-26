#!/usr/bin/env bash
# Reports whether AMD GPU (ROCm) acceleration is available for WebScout.
# Usage: bash deploy/gpu-check.sh [--container]
#   --container  also start the vLLM image and list GPUs from inside it (large pull).
# Exit code: 0 = GPU acceleration available, 1 = not available.

set -u
IMAGE="${VLLM_IMAGE:-rocm/vllm:rocm7.14.1_cdna_ubuntu24.04_py3.14_pytorch_2.11_vllm_0.23.0}"
URL="${WEBSCOUT_URL:-http://127.0.0.1}"
fail=0

pass() { echo "PASS  $1"; }
miss() { echo "FAIL  $1"; fail=1; }
info() { echo "INFO  $1"; }

[ -e /dev/kfd ] && pass "/dev/kfd present (ROCm compute device)" || miss "/dev/kfd missing: amdgpu driver not loaded or no AMD GPU"
ls /dev/dri/renderD* >/dev/null 2>&1 && pass "/dev/dri render nodes present" || miss "/dev/dri/renderD* missing"

if command -v amd-smi >/dev/null 2>&1; then
  pass "amd-smi found"
  amd-smi version 2>/dev/null | sed 's/^/      /'
  amd-smi static --asic 2>/dev/null | grep -iE 'MARKET_NAME|TARGET_GRAPHICS_VERSION' | sed 's/^/      /'
elif command -v rocm-smi >/dev/null 2>&1; then
  pass "rocm-smi found"
  rocm-smi --showproductname 2>/dev/null | sed 's/^/      /'
else
  miss "neither amd-smi nor rocm-smi found on host"
fi

if command -v docker >/dev/null 2>&1; then
  pass "docker found ($(docker --version 2>/dev/null))"
else
  miss "docker not installed"
fi

if [ "${1:-}" = "--container" ] && [ "$fail" -eq 0 ]; then
  info "checking GPU visibility inside $IMAGE"
  if docker run --rm --device /dev/kfd --device /dev/dri --group-add video "$IMAGE" \
      python3 -c "import torch; n=torch.cuda.device_count(); print('gpus', n, torch.cuda.get_device_name(0) if n else ''); assert n>0" 2>&1 | tail -n 3; then
    pass "PyTorch (ROCm) sees the GPU inside the container"
  else
    miss "container cannot see the GPU"
  fi
fi

code=$(curl -s -o /dev/null -w '%{http_code}' "$URL/gpu-health" 2>/dev/null || echo 000)
case "$code" in
  200) pass "vLLM is serving ($URL/gpu-health = 200)" ;;
  503) info "vLLM not ready yet ($URL/gpu-health = 503; model may still be loading)" ;;
  *)   info "WebScout GPU stack not running ($URL/gpu-health = $code)" ;;
esac

echo
if [ "$fail" -eq 0 ]; then
  echo "AMD GPU acceleration: AVAILABLE"
  exit 0
fi
echo "AMD GPU acceleration: NOT AVAILABLE (WebScout still works on CPU)"
exit 1
