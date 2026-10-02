mod providers;
mod storage;

use axum::{
    Router,
    body::{Bytes, to_bytes},
    extract::{Path, Query, State, rejection::QueryRejection},
    http::{HeaderMap, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{any, get},
};
use hmac::{Hmac, Mac};
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::Sha256;
use std::{
    collections::HashMap,
    env,
    sync::{Arc, Mutex},
};
use subtle::ConstantTimeEq;

const MAX_BODY: usize = 16 * 1024 * 1024;
const MAX_UPSTREAM: usize = 4 * 1024 * 1024;
const FILE_URL_TTL: u64 = 900;
type Params = HashMap<String, String>;
type ApiResult<T> = Result<T, ApiError>;

#[derive(Debug)]
struct ApiError(StatusCode, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, axum::Json(json!({"detail": self.1}))).into_response()
    }
}

fn bad(message: impl Into<String>) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, message.into())
}
fn missing() -> ApiError {
    ApiError(StatusCode::NOT_FOUND, "Not found".into())
}
fn unavailable(feature: &str) -> ApiError {
    ApiError(
        StatusCode::NOT_IMPLEMENTED,
        format!("{feature} is not configured on this server"),
    )
}
fn internal(error: impl std::fmt::Display) -> ApiError {
    eprintln!("backend error: {error}");
    ApiError(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Internal server error".into(),
    )
}
fn response(value: Value) -> Response {
    axum::Json(value).into_response()
}
fn parse_json(body: &[u8]) -> ApiResult<Value> {
    serde_json::from_slice(body).map_err(|_| bad("Invalid JSON body"))
}
fn required<'a>(value: &'a Value, field: &str) -> ApiResult<&'a str> {
    value
        .get(field)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| bad(format!("{field} must be a non-empty string")))
}
fn name_valid(name: &str) -> ApiResult<()> {
    if name.is_empty() || name.len() > 1024 || name.chars().any(char::is_control) {
        return Err(bad(
            "Names must be 1..1024 bytes without control characters",
        ));
    }
    Ok(())
}

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct Config {
    #[serde(default)]
    users: Vec<User>,
    #[serde(default)]
    queries: HashMap<String, providers::SavedQuery>,
    #[serde(default)]
    service_connectors: HashMap<String, providers::Connector>,
    llm: Option<providers::LlmConfig>,
    email: Option<providers::EmailConfig>,
}

#[derive(Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
struct User {
    uuid: String,
    name: String,
    email: String,
    is_admin: bool,
}

struct App {
    token: String,
    public_url: reqwest::Url,
    // ponytail: one SQLite lock per app; use a pool if concurrent writes become a bottleneck.
    db: Mutex<Connection>,
    sql_path: Option<String>,
    config: Config,
    client: reqwest::Client,
}

impl App {
    fn open(
        token: String,
        public_url: reqwest::Url,
        db_path: &str,
        sql_path: Option<String>,
        config: Config,
    ) -> Result<Arc<Self>, Box<dyn std::error::Error>> {
        if token.len() < 32 || !token.is_ascii() || token.chars().any(char::is_whitespace) {
            return Err(
                "RC_TOKEN must contain at least 32 ASCII characters without whitespace".into(),
            );
        }
        if !matches!(public_url.scheme(), "http" | "https")
            || public_url.host_str().is_none()
            || !public_url.username().is_empty()
            || public_url.password().is_some()
            || public_url.query().is_some()
            || public_url.fragment().is_some()
        {
            return Err(
                "RC_PUBLIC_URL must be an HTTP(S) URL without credentials, query or fragment"
                    .into(),
            );
        }
        if db_path != ":memory:" {
            if let Some(parent) = std::path::Path::new(db_path)
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
            {
                std::fs::create_dir_all(parent)?;
            }
        }
        let db = Connection::open(db_path)?;
        db.busy_timeout(std::time::Duration::from_secs(5))?;
        db.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS kv (
                scope TEXT NOT NULL, collection TEXT NOT NULL, key TEXT NOT NULL,
                value TEXT NOT NULL, updated_at TEXT NOT NULL,
                PRIMARY KEY(scope, collection, key));
            CREATE TABLE IF NOT EXISTS files (
                name TEXT PRIMARY KEY, content_type TEXT NOT NULL, data BLOB NOT NULL,
                updated_at TEXT NOT NULL);",
        )?;
        config.validate()?;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(120))
            .build()?;
        Ok(Arc::new(Self {
            token,
            public_url,
            db: Mutex::new(db),
            sql_path,
            config,
            client,
        }))
    }

    fn signature(&self, name: &str, expires: u64) -> String {
        let mut mac = Hmac::<Sha256>::new_from_slice(self.token.as_bytes())
            .expect("HMAC accepts any key length");
        mac.update(format!("file\n{expires}\n{name}").as_bytes());
        mac.finalize()
            .into_bytes()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    fn file_url(&self, name: &str) -> ApiResult<Value> {
        let expires = unix_now() + FILE_URL_TTL;
        let mut url = reqwest::Url::parse(&format!(
            "{}/downloads/file",
            self.public_url.as_str().trim_end_matches('/')
        ))
        .map_err(internal)?;
        url.query_pairs_mut()
            .append_pair("name", name)
            .append_pair("expires", &expires.to_string())
            .append_pair("signature", &self.signature(name, expires));
        Ok(json!({"name": name, "url": url.as_str(), "expires_in": FILE_URL_TTL}))
    }
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock before epoch")
        .as_secs()
}

async fn authenticate(
    State(app): State<Arc<App>>,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let token = request
        .headers()
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "));
    if token.is_none_or(|token| !bool::from(token.as_bytes().ct_eq(app.token.as_bytes()))) {
        let mut result = ApiError(
            StatusCode::UNAUTHORIZED,
            "Valid bearer token required".into(),
        )
        .into_response();
        result
            .headers_mut()
            .insert("www-authenticate", "Bearer".parse().unwrap());
        return result;
    }
    next.run(request).await
}

async fn handle(
    State(app): State<Arc<App>>,
    Path(path): Path<String>,
    params: Result<Query<Params>, QueryRejection>,
    method: Method,
    headers: HeaderMap,
    request: axum::extract::Request,
) -> ApiResult<Response> {
    let Query(params) = params.map_err(|_| bad("Invalid query parameters"))?;
    let body = to_bytes(request.into_body(), MAX_BODY)
        .await
        .map_err(|_| ApiError(StatusCode::PAYLOAD_TOO_LARGE, "Body exceeds 16 MiB".into()))?;
    if path == "kv"
        || path.starts_with("kv/")
        || path.starts_with("kv-scoped/")
        || path == "files"
        || path.starts_with("files/")
    {
        return tokio::task::spawn_blocking(move || {
            storage::handle(&app, &method, &path, &params, &headers, body)
        })
        .await
        .map_err(internal)?;
    }
    providers::handle(app, method, &path, &params, body).await
}

async fn download(
    State(app): State<Arc<App>>,
    params: Result<Query<Params>, QueryRejection>,
) -> ApiResult<Response> {
    let Query(params) = params.map_err(|_| bad("Invalid query parameters"))?;
    let name = params.get("name").ok_or_else(|| bad("name is required"))?;
    let expires = params.get("expires").and_then(|v| v.parse::<u64>().ok());
    let valid = expires.is_some_and(|expires| {
        expires > unix_now()
            && expires <= unix_now() + FILE_URL_TTL
            && params.get("signature").is_some_and(|sig| {
                bool::from(
                    sig.as_bytes()
                        .ct_eq(app.signature(name, expires).as_bytes()),
                )
            })
    });
    if !valid {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Invalid or expired download URL".into(),
        ));
    }
    let name = name.clone();
    tokio::task::spawn_blocking(move || storage::download(&app, &name))
        .await
        .map_err(internal)?
}

fn router(app: Arc<App>) -> Router {
    let protected = Router::new()
        .route("/fn/data/{*path}", any(handle))
        .route_layer(middleware::from_fn_with_state(app.clone(), authenticate));
    Router::new()
        .route(
            "/health",
            get(|| async { axum::Json(json!({"status":"ok"})) }),
        )
        .route("/downloads/file", get(download))
        .merge(protected)
        .fallback(|| async { missing().into_response() })
        .with_state(app)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let token = env::var("RC_TOKEN")
        .map_err(|_| "Set RC_TOKEN to a strong random token (at least 32 characters)")?;
    let bind = env::var("RC_BIND").unwrap_or_else(|_| "127.0.0.1:8787".into());
    let public_url = env::var("RC_PUBLIC_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:8787".into())
        .parse()?;
    let config = match env::var("RC_CONFIG") {
        Ok(path) => serde_json::from_slice(&std::fs::read(path)?)?,
        Err(env::VarError::NotPresent) => Config::default(),
        Err(error) => return Err(error.into()),
    };
    let db_path = env::var("RC_DB_PATH").unwrap_or_else(|_| ".railcode/backend.sqlite3".into());
    let app = App::open(
        token,
        public_url,
        &db_path,
        env::var("RC_SQLITE_PATH").ok(),
        config,
    )?;
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    eprintln!("Railcode backend listening on {}", listener.local_addr()?);
    axum::serve(listener, router(app))
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
}

async fn shutdown() {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("install SIGTERM handler");
        tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

#[cfg(test)]
mod tests;
