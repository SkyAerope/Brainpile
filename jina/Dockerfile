# 编译 jina fork 的 llama.cpp（feat-v5-omni 分支），上游尚不支持该架构。
FROM ubuntu:24.04 AS builder

RUN apt-get update && apt-get install -y \
    git build-essential cmake libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
RUN git clone --depth 1 --branch feat-v5-omni https://github.com/jina-ai/llama.cpp .
# 仅 CPU 构建；如需 GPU 改为 -DGGML_CUDA=ON 并使用 CUDA 基础镜像
RUN cmake -B build -DGGML_NATIVE=OFF -DLLAMA_CURL=ON && \
    cmake --build build --target llama-server -j"$(nproc)"

FROM ubuntu:24.04

RUN apt-get update && apt-get install -y \
    libcurl4 libgomp1 ca-certificates curl bash \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /build/build/bin/llama-server /usr/local/bin/llama-server
# llama.cpp 的运行期共享库
COPY --from=builder /build/build/bin/*.so /usr/local/lib/
RUN ldconfig

# 模型不打包进镜像：首次启动时由 entrypoint 下载到挂载的 /models volume，
# 之后命中缓存直接复用（详见 README 的部署说明）。
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
