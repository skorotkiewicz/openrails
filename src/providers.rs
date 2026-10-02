use crate::*;
use rusqlite::{OpenFlags, hooks::{AuthAction, AuthContext, Authorization}, limits::Limit, types::ValueRef};
use serde::Serialize;
use std::time::{Duration, Instant};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LlmConfig {
    pub base_url: String,
    pub api_key_env: Option<String>,
    pub model: String,
    #[serde(default = "default_provider")]
    pub provider: String,
}
fn default_provider() -> String { "openai".into() }

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmailConfig {
    pub api_key_env: String,
    pub from: String,
    #[serde(default = "email_url")]
    pub url: String,
}
fn email_url() -> String { "https://api.resend.com/emails".into() }

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Connector {
    pub base_url: String,
    pub description: Option<String>,
    #[serde(default = "get_method")]
    pub allowed_methods: Vec<String>,
    pub bearer_token_env: Option<String>,
    pub api_docs_link: Option<String>,
    pub usage_instructions: Option<String>,
    #[serde(default = "json_content_type")]
    pub content_type: String,
}
fn get_method() -> Vec<String> { vec!["GET".into()] }
fn json_content_type() -> String { "application/json".into() }

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavedQuery {
    pub sql: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub params: Vec<QueryParam>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct QueryParam {
    name: String,
    #[serde(rename = "type")]
    kind: String,
}

fn http_url(value: &str) -> Result<reqwest::Url, Box<dyn std::error::Error>> {
    let url = reqwest::Url::parse(value)?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none()
        || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err("Provider URLs must be HTTP(S), without credentials, query or fragment".into());
    }
    Ok(url)
}

fn credential(key: &str) -> ApiResult<String> {
    env::var(key).ok().filter(|v| !v.is_empty()).ok_or_else(|| unavailable("Provider credential"))
}

impl Config {
    pub fn validate(&self) -> Result<(), Box<dyn std::error::Error>> {
        for (name, connector) in &self.service_connectors {
            name_valid(name).map_err(|e| e.1)?;
            http_url(&connector.base_url)?;
            connector.content_type.parse::<axum::http::HeaderValue>()?;
            for method in &connector.allowed_methods {
                if !matches!(method.as_str(), "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS") {
                    return Err(format!("Invalid allowed method on connector {name}").into());
                }
            }
            if let Some(key) = &connector.bearer_token_env { credential(key).map_err(|e| e.1)?; }
        }
        if let Some(llm) = &self.llm {
            http_url(&llm.base_url)?;
            if llm.model.is_empty() || llm.provider.is_empty() { return Err("LLM model/provider cannot be empty".into()); }
            if let Some(key) = &llm.api_key_env { credential(key).map_err(|e| e.1)?; }
        }
        if let Some(email) = &self.email {
            http_url(&email.url)?;
            if email.from.is_empty() { return Err("Email from cannot be empty".into()); }
            credential(&email.api_key_env).map_err(|e| e.1)?;
        }
        for (name, query) in &self.queries {
            name_valid(name).map_err(|e| e.1)?;
            let mut names = std::collections::HashSet::new();
            for param in &query.params {
                if param.name.is_empty() || !names.insert(&param.name) || !matches!(param.kind.as_str(), "string" | "number" | "integer" | "boolean" | "object" | "array" | "null") {
                    return Err(format!("Invalid parameters in saved query {name}").into());
                }
            }
        }
        Ok(())
    }
}

pub async fn handle(app: Arc<App>, method: Method, path: &str, _query: &Params, body: Bytes) -> ApiResult<Response> {
    match (method.as_str(), path) {
        ("GET", "app-users") => Ok(response(serde_json::to_value(&app.config.users).map_err(internal)?)),
        ("GET", "connections") => Ok(response(if app.sql_path.is_some() { json!([{"engine":"sqlite","name":"default"}]) } else { json!([]) })),
        ("GET", "queries") => {
            let mut items: Vec<_> = app.config.queries.iter().map(|(name, query)| json!({"name":name,"description":query.description,"params":query.params,"version":1})).collect();
            items.sort_by(|a,b| a["name"].as_str().cmp(&b["name"].as_str()));
            Ok(response(json!(items)))
        }
        ("POST", "sql") => {
            let body = parse_json(&body)?;
            if body.get("engine").is_some_and(|v| v != "sqlite") { return Err(unavailable("Requested SQL engine; use data.runSQL for local SQLite")); }
            if body.get("connection").is_some_and(|v| v != "default") { return Err(missing()); }
            let sql = required(&body, "query")?.to_owned();
            let params: Vec<Value> = serde_json::from_value(body.get("params").cloned().unwrap_or(json!([]))).map_err(|_| bad("params must be an array"))?;
            run_sql(app, sql, params).await
        }
        ("POST", path) if path.starts_with("queries/") => {
            let name = &path[8..];
            let saved = app.config.queries.get(name).ok_or_else(missing)?;
            let body = parse_json(&body)?;
            let values = body.get("params").and_then(Value::as_object).ok_or_else(|| bad("params must be an object"))?;
            if values.len() != saved.params.len() { return Err(bad("Supply exactly the declared saved query parameters")); }
            let mut params = Vec::new();
            for param in &saved.params {
                let value = values.get(&param.name).ok_or_else(|| bad(format!("Missing parameter {}", param.name)))?;
                if !type_matches(&param.kind, value) { return Err(bad(format!("Wrong type for parameter {}", param.name))); }
                params.push(value.clone());
            }
            let sql = saved.sql.clone();
            run_sql(app, sql, params).await
        }
        ("GET", "llm/providers") => Ok(response(match &app.config.llm {
            Some(config) => json!([{"provider":config.provider,"managed":false,"default":true,"models":[{"model":config.model,"default":true}]}]),
            None => json!([]),
        })),
        ("POST", "llm/generate" | "llm/stream") => {
            let result = generate(&app, parse_json(&body)?).await?;
            if path == "llm/generate" { return Ok(response(result)); }
            // ponytail: buffer one upstream completion; add SSE translation when token latency matters.
            let text = json!({"type":"text","text":result["text"]});
            let mut done = result;
            done["type"] = json!("done");
            Ok(([("content-type", "application/x-ndjson; charset=utf-8"), ("cache-control", "no-cache"), ("x-accel-buffering", "no")], format!("{text}\n{done}\n")).into_response())
        }
        ("POST", "email/send") => send_email(&app, parse_json(&body)?).await,
        ("GET", "service-connectors") => {
            let mut items: Vec<_> = app.config.service_connectors.iter().map(|(name, config)| connector_info(name, config, false)).collect();
            items.sort_by(|a,b| a["name"].as_str().cmp(&b["name"].as_str()));
            Ok(response(json!(items)))
        }
        ("POST", "service-connectors/request") => connector_request(&app, parse_json(&body)?).await,
        ("POST", "service-connectors/call") => Err(unavailable("Connector tools/MCP")),
        ("GET", path) if path.starts_with("service-connectors/") => {
            let rest = &path[19..];
            if let Some(name) = rest.strip_suffix("/tools") {
                app.config.service_connectors.get(name).ok_or_else(missing)?;
                return Ok(response(json!([])));
            }
            let config = app.config.service_connectors.get(rest).ok_or_else(missing)?;
            Ok(response(connector_info(rest, config, true)))
        }
        (_, path) if path.starts_with("agents/") => Err(unavailable("Agent execution")),
        _ => Err(missing()),
    }
}

fn type_matches(kind: &str, value: &Value) -> bool {
    match kind {
        "string" => value.is_string(), "number" => value.is_number(),
        "integer" => value.as_i64().is_some() || value.as_u64().is_some(),
        "boolean" => value.is_boolean(), "object" => value.is_object(),
        "array" => value.is_array(), "null" => value.is_null(), _ => false,
    }
}

async fn run_sql(app: Arc<App>, sql: String, params: Vec<Value>) -> ApiResult<Response> {
    let path = app.sql_path.clone().ok_or_else(|| unavailable("SQLite data connection"))?;
    tokio::task::spawn_blocking(move || sql_query(&path, &sql, &params).map(response)).await.map_err(internal)?
}

pub(crate) fn sql_query(path: &str, sql: &str, params: &[Value]) -> ApiResult<Value> {
    if sql.len() > 65536 || params.len() > 1000 { return Err(bad("SQL or parameter limit exceeded")); }
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(internal)?;
    db.busy_timeout(Duration::from_secs(5)).map_err(internal)?;
    db.execute_batch("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;").map_err(internal)?;
    db.set_limit(Limit::SQLITE_LIMIT_LENGTH, MAX_UPSTREAM as i32);
    let deadline = Instant::now() + Duration::from_secs(5);
    db.progress_handler(1000, Some(move || Instant::now() > deadline));
    db.authorizer(Some(|context: AuthContext<'_>| match context.action {
        AuthAction::Select | AuthAction::Read { .. } | AuthAction::Recursive => Authorization::Allow,
        AuthAction::Function { function_name } if !function_name.eq_ignore_ascii_case("load_extension") => Authorization::Allow,
        _ => Authorization::Deny,
    }));
    let sql_error = |_| bad("SQL must be a valid, single read-only query with matching parameters (5s, 4 MiB limit)");
    let mut statement = db.prepare(sql).map_err(sql_error)?;
    if !statement.readonly() || statement.column_count() == 0 { return Err(bad("Only read-only row queries are allowed")); }
    let columns: Vec<_> = statement.column_names().into_iter().map(str::to_owned).collect();
    let bindings: Vec<rusqlite::types::Value> = params.iter().map(|value| match value {
        Value::Null => rusqlite::types::Value::Null,
        Value::Bool(v) => rusqlite::types::Value::Integer(i64::from(*v)),
        Value::Number(v) if v.as_i64().is_some() => rusqlite::types::Value::Integer(v.as_i64().unwrap()),
        Value::Number(v) => rusqlite::types::Value::Real(v.as_f64().unwrap()),
        Value::String(v) => rusqlite::types::Value::Text(v.clone()),
        value => rusqlite::types::Value::Text(value.to_string()),
    }).collect();
    let mut cursor = statement.query(rusqlite::params_from_iter(bindings)).map_err(sql_error)?;
    let mut rows = Vec::new();
    let mut bytes = 0;
    let mut truncated = false;
    while let Some(row) = cursor.next().map_err(sql_error)? {
        if rows.len() == 1000 { truncated = true; break; }
        let mut values = Vec::new();
        for i in 0..columns.len() {
            values.push(match row.get_ref(i).map_err(sql_error)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(v) => json!(v),
                ValueRef::Real(v) => json!(v),
                ValueRef::Text(v) => json!(String::from_utf8_lossy(v)),
                ValueRef::Blob(v) => json!(v.iter().map(|b| format!("{b:02x}")).collect::<String>()),
            });
        }
        bytes += serde_json::to_vec(&values).map_err(internal)?.len();
        if bytes > MAX_UPSTREAM { truncated = true; break; }
        rows.push(values);
    }
    Ok(json!({"columns":columns,"rowcount":rows.len(),"rows":rows,"truncated":truncated}))
}

async fn read_upstream(mut resp: reqwest::Response, truncate: bool) -> ApiResult<(Vec<u8>, bool)> {
    let mut bytes = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|_| ApiError(StatusCode::BAD_GATEWAY, "Could not read provider response".into()))? {
        let remaining = MAX_UPSTREAM - bytes.len();
        if chunk.len() > remaining {
            if !truncate { return Err(ApiError(StatusCode::BAD_GATEWAY, "Provider response exceeds 4 MiB".into())); }
            bytes.extend_from_slice(&chunk[..remaining]);
            return Ok((bytes, true));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok((bytes, false))
}

async fn upstream_json(request: reqwest::RequestBuilder) -> ApiResult<Value> {
    let resp = request.send().await.map_err(|_| ApiError(StatusCode::BAD_GATEWAY, "Provider request failed".into()))?;
    if !resp.status().is_success() {
        // Do not expose provider responses: they may contain credentials or private URLs.
        return Err(ApiError(StatusCode::BAD_GATEWAY, format!("Provider returned HTTP {}", resp.status().as_u16())));
    }
    let (body, _) = read_upstream(resp, false).await?;
    serde_json::from_slice(&body).map_err(|_| ApiError(StatusCode::BAD_GATEWAY, "Provider returned invalid JSON".into()))
}

async fn generate(app: &App, body: Value) -> ApiResult<Value> {
    let config = app.config.llm.as_ref().ok_or_else(|| unavailable("LLM provider"))?;
    if body.get("provider").is_some_and(|p| p != &config.provider) { return Err(bad("Unknown LLM provider")); }
    let model = match body.get("model") {
        Some(value) => value.as_str().filter(|s| !s.is_empty() && s.len() <= 200).ok_or_else(|| bad("Invalid model"))?,
        None => &config.model,
    };
    let mut messages = Vec::new();
    if let Some(system) = body.get("system") {
        let system = system.as_str().ok_or_else(|| bad("system must be a string"))?;
        messages.push(json!({"role":"system","content":system}));
    }
    if let Some(input) = body.get("input") {
        let input = input.as_str().ok_or_else(|| bad("input must be a string"))?;
        messages.push(json!({"role":"user","content":input}));
    } else {
        let input = body.get("messages").and_then(Value::as_array).filter(|v| !v.is_empty() && v.len() <= 256).ok_or_else(|| bad("Supply input or 1..256 messages"))?;
        for message in input {
            let role = required(message, "role")?;
            if !matches!(role, "system" | "user" | "assistant") { return Err(bad("Invalid message role")); }
            let content = message.get("content").and_then(Value::as_str).ok_or_else(|| bad("Message content must be a string"))?;
            messages.push(json!({"role":role,"content":content}));
        }
    }
    let mut request = json!({"model":model,"messages":messages});
    if let Some(limit) = body.get("maxOutputTokens") {
        if !limit.as_u64().is_some_and(|n| (1..=131072).contains(&n)) { return Err(bad("maxOutputTokens must be 1..131072")); }
        request["max_tokens"] = limit.clone();
    }
    if let Some(tools) = body.get("tools") {
        let tools = tools.as_array().filter(|v| v.len() <= 128).ok_or_else(|| bad("tools must be an array of at most 128 definitions"))?;
        let mut definitions = Vec::new();
        for tool in tools {
            let name = required(tool, "name")?;
            let description = required(tool, "description")?;
            let schema = tool.get("schema").cloned().unwrap_or(json!({"type":"object","properties":{}}));
            if !schema.is_object() { return Err(bad("Tool schema must be an object")); }
            definitions.push(json!({"type":"function","function":{"name":name,"description":description,"parameters":schema}}));
        }
        if !definitions.is_empty() { request["tools"] = json!(definitions); }
    }
    let json_output = match body.get("output") {
        None => false,
        Some(output) => match output.get("type").and_then(Value::as_str) {
            None | Some("text") if output.is_object() => false,
            Some("json") => {
                let schema = output.get("schema").filter(|v| v.is_object()).ok_or_else(|| bad("JSON output requires an object schema"))?;
                request["response_format"] = json!({"type":"json_schema","json_schema":{"name":"response","strict":true,"schema":schema}});
                true
            }
            _ => return Err(bad("Invalid output specification")),
        },
    };
    let url = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));
    let mut upstream = app.client.post(url).json(&request);
    if let Some(key) = &config.api_key_env { upstream = upstream.bearer_auth(credential(key)?); }
    let result = upstream_json(upstream).await?;
    let choice = result.get("choices").and_then(Value::as_array).and_then(|v| v.first()).ok_or_else(|| ApiError(StatusCode::BAD_GATEWAY, "Provider returned no choices".into()))?;
    let message = &choice["message"];
    let text = message["content"].as_str().unwrap_or_default();
    let output = if json_output { serde_json::from_str(text).map_err(|_| ApiError(StatusCode::BAD_GATEWAY, "Provider returned invalid structured output".into()))? } else { Value::Null };
    let mut tool_calls = Vec::new();
    if let Some(calls) = message["tool_calls"].as_array() {
        for call in calls {
            let args: Value = serde_json::from_str(call["function"]["arguments"].as_str().unwrap_or_default()).map_err(|_| ApiError(StatusCode::BAD_GATEWAY, "Provider returned invalid tool arguments".into()))?;
            if !args.is_object() { return Err(ApiError(StatusCode::BAD_GATEWAY, "Tool arguments must be an object".into())); }
            tool_calls.push(json!({"id":call["id"],"name":call["function"]["name"],"arguments":args}));
        }
    }
    Ok(json!({"text":text,"output":output,"toolCalls":tool_calls,
        "usage":{"inputTokens":result["usage"]["prompt_tokens"].as_u64().unwrap_or(0),"outputTokens":result["usage"]["completion_tokens"].as_u64().unwrap_or(0),"totalTokens":result["usage"]["total_tokens"].as_u64().unwrap_or(0)},
        "cost":null,"provider":config.provider,"model":result["model"].as_str().unwrap_or(model),
        "finishReason":choice["finish_reason"],"requestId":result["id"].as_str().unwrap_or("self-hosted")}))
}

async fn send_email(app: &App, body: Value) -> ApiResult<Response> {
    let config = app.config.email.as_ref().ok_or_else(|| unavailable("Email provider"))?;
    required(&body, "subject")?;
    for key in ["to", "cc", "bcc"] {
        let value = body.get(key);
        if key == "to" && value.is_none() { return Err(bad("to is required")); }
        if let Some(value) = value {
            let valid = value.as_str().is_some_and(|v| !v.is_empty() && !v.contains(['\r','\n']))
                || value.as_array().is_some_and(|v| !v.is_empty() && v.len() <= 100 && v.iter().all(|v| v.as_str().is_some_and(|v| !v.is_empty() && !v.contains(['\r','\n']))));
            if !valid { return Err(bad(format!("Invalid {key} recipients"))); }
        }
    }
    let mut request = json!({"from":config.from,"to":body["to"],"subject":body["subject"]});
    if body.get("text").is_none() && body.get("html").is_none() { return Err(bad("Supply text or html")); }
    for key in ["html", "text", "cc", "bcc", "replyTo"] {
        if let Some(value) = body.get(key) {
            if matches!(key, "html" | "text" | "replyTo") && !value.is_string() { return Err(bad(format!("{key} must be a string"))); }
            request[if key == "replyTo" { "reply_to" } else { key }] = value.clone();
        }
    }
    let result = upstream_json(app.client.post(&config.url).bearer_auth(credential(&config.api_key_env)?).json(&request)).await?;
    let id = result.get("id").and_then(Value::as_str).ok_or_else(|| ApiError(StatusCode::BAD_GATEWAY, "Email provider returned no id".into()))?;
    Ok(response(json!({"id":id,"status":"sent","requestId":id})))
}

fn connector_info(name: &str, config: &Connector, docs: bool) -> Value {
    let common = json!({"name":name,"description":config.description,"auth_type":if config.bearer_token_env.is_some(){"bearer"}else{"none"},"allowed_methods":config.allowed_methods,"kind":"http","has_tools":false});
    let mut result = common;
    if docs {
        result["content_type"] = json!(config.content_type);
        result["api_docs_link"] = json!(config.api_docs_link);
        result["api_docs_inline"] = Value::Null;
        result["openapi_spec_link"] = Value::Null;
        result["openapi_spec_inline"] = Value::Null;
        result["usage_instructions"] = json!(config.usage_instructions);
    } else {
        result["has_docs"] = json!(config.api_docs_link.is_some() || config.usage_instructions.is_some());
        result["has_openapi"] = json!(false);
        result["provider"] = Value::Null;
        result["account_label"] = Value::Null;
    }
    result
}

async fn connector_request(app: &App, body: Value) -> ApiResult<Response> {
    let name = required(&body, "connector")?;
    let config = app.config.service_connectors.get(name).ok_or_else(missing)?;
    let method = required(&body, "method")?;
    if !config.allowed_methods.iter().any(|allowed| allowed == method) { return Err(ApiError(StatusCode::METHOD_NOT_ALLOWED, "Connector method is not allowed".into())); }
    let path = body.get("path").and_then(Value::as_str).ok_or_else(|| bad("path must be a string"))?;
    let base = reqwest::Url::parse(&config.base_url).map_err(internal)?;
    if !path.starts_with('/') || path.starts_with("//") || path.contains('\\') || path.chars().any(char::is_control) { return Err(bad("Connector path must start with / and cannot specify a host")); }
    let url = base.join(path).map_err(|_| bad("Invalid connector path"))?;
    if url.origin() != base.origin() || !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() { return Err(bad("Connector origin is pinned")); }
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| bad("Invalid method"))?;
    let mut request = app.client.request(method, url);
    if let Some(key) = &config.bearer_token_env { request = request.bearer_auth(credential(key)?); }
    if let Some(body) = body.get("body") {
        let body = body.as_str().ok_or_else(|| bad("body must be a string"))?;
        request = request.header("content-type", &config.content_type).body(body.to_owned());
    }
    let upstream = request.send().await.map_err(|_| ApiError(StatusCode::BAD_GATEWAY, "Connector request failed".into()))?;
    let status = upstream.status();
    let mut headers = serde_json::Map::new();
    for name in ["content-type", "cache-control", "expires", "last-modified"] {
        if let Some(value) = upstream.headers().get(name).and_then(|v| v.to_str().ok()) { headers.insert(name.into(), json!(value)); }
    }
    let (bytes, truncated) = read_upstream(upstream, true).await?;
    Ok(response(json!({"status":status.as_u16(),"ok":status.is_success(),"headers":headers,"truncated":truncated,"body":String::from_utf8_lossy(&bytes)})))
}
