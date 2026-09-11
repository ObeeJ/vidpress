# ── Stage 1: Build Rust Backend & whisper.cpp ──────────────────────────────────
FROM debian:bookworm-slim AS builder

RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    build-essential \
    cmake \
    git \
    curl \
    && curl https://sh.rustup.rs -sSf | sh -s -- -y --default-toolchain stable \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.cargo/bin:$PATH"

WORKDIR /app

# Build whisper-cli native C++ binary (~15MB).
#
# Pinned to a tag: an unpinned --depth 1 clone tracks master, and whisper.cpp
# has renamed its CMake options more than once. That is how this stage silently
# began emitting a dynamically linked binary while the comment here still
# claimed it was static, leaving the runtime stage without libwhisper.so.1.
#
# GGML_NATIVE=OFF matters for a portable image: ggml defaults to -march=native,
# which bakes the *build* machine's CPU features into the binary and makes it
# die with SIGILL on any host with an older CPU.
#
# The static flag is no longer trusted blindly. After building we ask ldd what
# the binary actually needs and stage those libraries next to it, so a dynamic
# link can no longer produce a broken runtime image.
RUN git clone --depth 1 --branch v1.7.4 https://github.com/ggerganov/whisper.cpp.git /tmp/whisper.cpp \
    && cd /tmp/whisper.cpp \
    && cmake -B build \
        -DCMAKE_BUILD_TYPE=Release \
        -DWHISPER_BUILD_EXAMPLES=ON \
        -DWHISPER_BUILD_TESTS=OFF \
        -DBUILD_SHARED_LIBS=OFF \
        -DGGML_NATIVE=OFF \
    && cmake --build build --config Release --target whisper-cli -j"$(nproc)" \
    && mkdir -p /tmp/whisper-dist/lib \
    && cp build/bin/whisper-cli /tmp/whisper-dist/whisper-cli \
    && find build -name '*.so*' -exec cp -P {} /tmp/whisper-dist/lib/ \; \
    && echo "whisper-cli runtime linkage:" \
    && ldd /tmp/whisper-dist/whisper-cli

# Pre-compile Cargo dependencies for layer caching
COPY Cargo.toml Cargo.lock ./
RUN mkdir -p src \
    && echo "fn main() {}" > src/main.rs \
    && echo "pub fn dummy() {}" > src/lib.rs \
    && cargo build --release \
    && rm -rf src

# Copy source code and build Rust backend
COPY . .
# Touch src files so cargo knows real source supersedes the dummy build
RUN touch src/main.rs src/lib.rs && cargo build --release

# ── Stage 2: Ultra-lightweight Production Runner (~220MB) ─────────────────────
FROM debian:bookworm-slim

# No python3 here on purpose - see the yt-dlp note below.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy whisper-cli plus whatever shared objects the build actually produced.
# The lib directory is empty when the link came out static, which is harmless.
COPY --from=builder /tmp/whisper-dist/whisper-cli /usr/local/bin/whisper-cli
COPY --from=builder /tmp/whisper-dist/lib/ /usr/local/lib/whisper/
ENV LD_LIBRARY_PATH="/usr/local/lib/whisper:${LD_LIBRARY_PATH}"
RUN ldconfig /usr/local/lib/whisper 2>/dev/null || true

# Prove both subprocess dependencies actually load in THIS image. The previous
# breakage was exactly this: an image that built cleanly and only revealed a
# missing libwhisper.so.1 when a user submitted a transcription and got
# exit 127. A dependency the app shells out to is not verified by the build
# succeeding - only by running it here, where failure stops the release.
RUN set -eux; \
    whisper-cli --help >/dev/null 2>&1 || { \
        echo "FATAL: whisper-cli cannot execute in the runtime image"; \
        ldd /usr/local/bin/whisper-cli || true; exit 1; }; \
    ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libx265 || { \
        echo "FATAL: ffmpeg lacks libx265"; exit 1; }

# Bake GGML whisper base model (~140MB)
RUN mkdir -p /app/models \
    && curl -fSL --retry 10 --retry-delay 3 https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin -o /app/models/ggml-base.bin

WORKDIR /app
COPY --from=builder /app/target/release/theflate /usr/local/bin/theflate

ENV THEFLATE_STORAGE="/tmp/theflate_output"
ENV THEFLATE_DB="/var/lib/theflate/theflate.db"
ENV WHISPER_MODEL_PATH="/app/models/ggml-base.bin"

RUN mkdir -p /var/lib/theflate /tmp/theflate_output

EXPOSE 8080

CMD ["theflate"]
