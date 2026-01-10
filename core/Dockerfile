FROM rust:1.92 AS builder
WORKDIR /app
COPY . .
# Create a dummy main.rs to cache dependencies if we were optimizing, 
# but for now just copy everything.
RUN cargo build --release

FROM debian:bookworm-slim
WORKDIR /app
# Install OpenSSL (required for Rust networking crates) and ffmpeg (for video processing)
RUN apt-get update && apt-get install -y libssl-dev ca-certificates ffmpeg && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/brainpile-core .
CMD ["./brainpile-core"]
