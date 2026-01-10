FROM rust:1.92 AS builder
WORKDIR /app
COPY . .
# Create a dummy main.rs to cache dependencies if we were optimizing, 
# but for now just copy everything.
RUN cargo build --release

FROM debian:bookworm-slim
WORKDIR /app
# Install OpenSSL which is required for many Rust networking crates
RUN apt-get update && apt-get install -y libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/brainpile-core .
CMD ["./brainpile-core"]
