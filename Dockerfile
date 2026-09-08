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

WORKDIR /app

COPY --from=builder /app/target/release/theflate /usr/local/bin/theflate

ENV VIDPRESS_STORAGE="/tmp/theflate_output"
ENV VIDPRESS_DB="/var/lib/theflate/theflate.db"

RUN mkdir -p /var/lib/theflate /tmp/theflate_output

EXPOSE 8080

CMD ["theflate"]
