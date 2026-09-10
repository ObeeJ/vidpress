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

# Build whisper-cli native C++ binary (~15MB)
RUN git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git /tmp/whisper.cpp \
    && cd /tmp/whisper.cpp \
    && cmake -B build -DWHISPER_BUILD_EXAMPLES=ON \
    && cmake --build build --config Release --target whisper-cli \
    && cp build/bin/whisper-cli /tmp/whisper-cli

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

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
    python3-minimal \
    && rm -rf /var/lib/apt/lists/*

# Install standalone yt-dlp binary (~30MB)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Copy whisper-cli binary from builder stage (~15MB)
COPY --from=builder /tmp/whisper-cli /usr/local/bin/whisper-cli

# Bake GGML whisper base model (~140MB)
RUN mkdir -p /app/models \
    && curl -sSL --retry 5 --retry-delay 2 --retry-connrefused -C - https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin -o /app/models/ggml-base.bin

WORKDIR /app
COPY --from=builder /app/target/release/theflate /usr/local/bin/theflate

ENV THEFLATE_STORAGE="/tmp/theflate_output"
ENV THEFLATE_DB="/var/lib/theflate/theflate.db"
ENV WHISPER_MODEL_PATH="/app/models/ggml-base.bin"

RUN mkdir -p /var/lib/theflate /tmp/theflate_output

EXPOSE 8080

CMD ["theflate"]
