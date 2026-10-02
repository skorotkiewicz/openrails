FROM rust:1-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && mkdir /data && chown 10001:10001 /data
COPY --from=build /app/target/release/railcode-backend /usr/local/bin/railcode-backend
USER 10001:10001
ENV RC_BIND=0.0.0.0:8787 RC_DB_PATH=/data/backend.sqlite3
EXPOSE 8787
VOLUME ["/data"]
ENTRYPOINT ["railcode-backend"]
