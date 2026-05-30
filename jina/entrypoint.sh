#!/usr/bin/env bash
set -euo pipefail

# 模型目录（compose 中挂载为 named volume，持久化下载结果）
MODEL_DIR="${MODEL_DIR:-/models}"
HF_REPO="Yirasumi/jina-embeddings-v5-omni-nano-retrieval-GGUF"
HF_BASE="https://huggingface.co/${HF_REPO}/resolve/main"

MODEL_FILE="jina-embeddings-v5-omni-nano-retrieval-Q4_K_M.gguf"
MMPROJ_FILE="mmproj-jina-embeddings-v5-omni-nano-retrieval-F16.gguf"

mkdir -p "${MODEL_DIR}"

# 缺失则下载，已存在则跳过（volume 持久化，仅首次启动需要下载）
download_if_missing() {
    local file="$1"
    local dest="${MODEL_DIR}/${file}"
    if [[ -f "${dest}" ]]; then
        echo "[entrypoint] ${file} already present, skip download."
        return
    fi
    echo "[entrypoint] downloading ${file} from HuggingFace..."
    # 先下到临时文件，成功后再重命名，避免中断留下半截文件
    curl -fL --retry 3 --retry-delay 5 \
        -o "${dest}.tmp" \
        "${HF_BASE}/${file}?download=true"
    mv "${dest}.tmp" "${dest}"
    echo "[entrypoint] ${file} downloaded."
}

download_if_missing "${MODEL_FILE}"
download_if_missing "${MMPROJ_FILE}"

echo "[entrypoint] starting llama-server..."
exec llama-server \
    -m "${MODEL_DIR}/${MODEL_FILE}" \
    --mmproj "${MODEL_DIR}/${MMPROJ_FILE}" \
    --embedding --pooling last \
    -c 8192 -b 8192 -ub 8192 \
    --host 0.0.0.0 --port 8000
