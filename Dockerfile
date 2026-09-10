# ── Stage 1: Build Rust Backend ────────────────────────────────────────────────
FROM rust:1.80-slim AS builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev build-essential && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy framework dependencies if path exists
COPY . .

RUN cargo build --release

# ── Stage 2: Production Runner ─────────────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# whisper-ctranslate2 (CTranslate2/faster-whisper backend) instead of the
# reference openai-whisper CLI: int8 quantization gets large-v3's full
# transcription quality at a fraction of the disk footprint and with
# meaningfully faster inference, verified as a real CLI/JSON-output drop-in
# for this app's transcribe handler (src/handlers/transcribe.rs).
RUN pip3 install whisper-ctranslate2 --break-system-packages

# Bake the model weights into the image at build time rather than
# downloading on the first production transcription request. A runtime
# download needs egress to Hugging Face, which may be restricted or just
# slow in production, and turns "first transcription after deploy" into an
# unpredictable multi-GB download blocking a live request. Building it in
# means the image is bigger, but every deploy is self-contained from the
# first request.
RUN python3 -c "from faster_whisper import WhisperModel; WhisperModel('large-v3', compute_type='int8')"

WORKDIR /app
COPY --from=builder /app/target/release/theflate /usr/local/bin/theflate

ENV THEFLATE_STORAGE="/tmp/theflate_output"
ENV THEFLATE_DB="/var/lib/theflate/theflate.db"

RUN mkdir -p /var/lib/theflate /tmp/theflate_output

EXPOSE 8080

CMD ["theflate"]
