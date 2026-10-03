FROM rust:1-bookworm AS build
WORKDIR /app
COPY openrails-backend/Cargo.toml openrails-backend/Cargo.lock ./
COPY openrails-backend/src ./src
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && mkdir /data && chown 10001:10001 /data
COPY --from=build /app/target/release/openrails-backend /usr/local/bin/openrails-backend
USER 10001:10001
ENV OPENRAILS_BIND=0.0.0.0:8787 OPENRAILS_DB_PATH=/data/backend.sqlite3
EXPOSE 8787
VOLUME ["/data"]
ENTRYPOINT ["openrails-backend"]
