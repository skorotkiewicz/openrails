use crate::*;
use axum::http::header;
use rusqlite::{OptionalExtension, params};
use std::cmp::Ordering;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

fn now() -> ApiResult<String> {
    OffsetDateTime::now_utc().format(&Rfc3339).map_err(internal)
}

fn timestamp(value: &str) -> ApiResult<i128> {
    OffsetDateTime::parse(value, &Rfc3339).map(|v| v.unix_timestamp_nanos())
        .map_err(|_| bad("Timestamps must be RFC3339"))
}

pub fn handle(app: &App, method: &Method, path: &str, query: &Params, headers: &HeaderMap, body: Bytes) -> ApiResult<Response> {
    let db = app.db.lock().map_err(internal)?;
    if path == "files" || path.starts_with("files/") {
        return files(app, &db, method, path, query, headers, &body);
    }
    let (scope, rest, frozen) = if let Some(rest) = path.strip_prefix("kv-scoped/") {
        let mut parts = rest.splitn(3, '/');
        let kind = parts.next().unwrap_or_default();
        let owner = parts.next().ok_or_else(missing)?;
        name_valid(owner)?;
        if !matches!(kind, "user" | "role") { return Err(missing()); }
        (format!("{kind}:{owner}"), parts.next().ok_or_else(missing)?, true)
    } else {
        (String::new(), path.strip_prefix("kv/").ok_or_else(missing)?, false)
    };
    if frozen && method != Method::GET {
        return Err(ApiError(StatusCode::METHOD_NOT_ALLOWED, "Migrated scopes are read-only".into()));
    }
    let (collection, key) = match rest.split_once('/') {
        Some((collection, key)) => (collection, Some(key)),
        None => (rest, None),
    };
    name_valid(collection)?;
    if let Some(key) = key {
        name_valid(key)?;
        match *method {
            Method::GET => {
                let record = db.query_row("SELECT value, updated_at FROM kv WHERE scope=?1 AND collection=?2 AND key=?3",
                    params![scope, collection, key], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
                    .optional().map_err(internal)?.ok_or_else(missing)?;
                Ok(response(json!({"key":key,"value":serde_json::from_str::<Value>(&record.0).map_err(internal)?,"updated_at":record.1})))
            }
            Method::PUT => {
                let body = parse_json(&body)?;
                let value = body.get("value").ok_or_else(|| bad("value is required"))?;
                let updated_at = now()?;
                db.execute("INSERT INTO kv(scope,collection,key,value,updated_at) VALUES(?1,?2,?3,?4,?5)
                    ON CONFLICT(scope,collection,key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                    params![scope, collection, key, value.to_string(), updated_at]).map_err(internal)?;
                Ok(response(json!({"key":key,"value":value,"updated_at":updated_at})))
            }
            Method::DELETE => {
                db.execute("DELETE FROM kv WHERE scope=?1 AND collection=?2 AND key=?3", params![scope, collection, key]).map_err(internal)?;
                Ok(StatusCode::NO_CONTENT.into_response())
            }
            _ => Err(ApiError(StatusCode::METHOD_NOT_ALLOWED, "Use GET, PUT or DELETE".into())),
        }
    } else if method == Method::GET {
        list(&db, &scope, collection, query)
    } else {
        Err(ApiError(StatusCode::METHOD_NOT_ALLOWED, "Collection listing requires GET".into()))
    }
}

#[derive(serde::Serialize)]
struct Record {
    key: String,
    value: Value,
    updated_at: String,
}

fn field<'a>(record: &'a Record, field: &str) -> &'a Value {
    let mut value = &record.value;
    for part in field.strip_prefix("value.").unwrap_or(field).split('.') {
        value = value.get(part).unwrap_or(&Value::Null);
    }
    value
}

fn compare(left: &Value, right: &Value) -> Option<Ordering> {
    match (left, right) {
        (Value::Number(a), Value::Number(b)) => {
            if let (Some(a), Some(b)) = (a.as_i64(), b.as_i64()) { return Some(a.cmp(&b)); }
            if let (Some(a), Some(b)) = (a.as_u64(), b.as_u64()) { return Some(a.cmp(&b)); }
            if a.as_i64().is_some_and(|n| n < 0) && b.as_u64().is_some() { return Some(Ordering::Less); }
            if b.as_i64().is_some_and(|n| n < 0) && a.as_u64().is_some() { return Some(Ordering::Greater); }
            a.as_f64()?.partial_cmp(&b.as_f64()?)
        }
        (Value::String(a), Value::String(b)) => Some(a.cmp(b)),
        (Value::Bool(a), Value::Bool(b)) => Some(a.cmp(b)),
        (Value::Null, Value::Null) => Some(Ordering::Equal),
        _ => None,
    }
}

fn equal(left: &Value, right: &Value) -> bool {
    compare(left, right) == Some(Ordering::Equal) || left == right
}

fn matches(value: &Value, op: &str, expected: &Value) -> bool {
    match op {
        "eq" => equal(value, expected),
        "ne" => !equal(value, expected),
        "gt" => compare(value, expected) == Some(Ordering::Greater),
        "gte" => matches!(compare(value, expected), Some(Ordering::Greater | Ordering::Equal)),
        "lt" => compare(value, expected) == Some(Ordering::Less),
        "lte" => matches!(compare(value, expected), Some(Ordering::Less | Ordering::Equal)),
        "in" => expected.as_array().is_some_and(|values| values.iter().any(|expected| equal(value, expected))),
        _ => false,
    }
}

fn positive(query: &Params, field: &str, default: usize, maximum: usize) -> ApiResult<usize> {
    let value = match query.get(field) {
        Some(value) => value.parse::<usize>().map_err(|_| bad(format!("Invalid {field}")))?,
        None => default,
    };
    if !(1..=maximum).contains(&value) { return Err(bad(format!("{field} must be between 1 and {maximum}"))); }
    Ok(value)
}

fn list(db: &Connection, scope: &str, collection: &str, query: &Params) -> ApiResult<Response> {
    let filters: Vec<(String, String, Value)> = match query.get("where") {
        Some(value) => serde_json::from_str(value).map_err(|_| bad("where must be an array of [field, op, value]"))?,
        None => Vec::new(),
    };
    if filters.len() > 32 || filters.iter().any(|(field, op, value)| field.is_empty() || !matches!(op.as_str(), "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in") || (op == "in" && !value.is_array())) {
        return Err(bad("Invalid filter (maximum 32; in requires an array)"));
    }
    let order: Option<(String, String)> = query.get("order").map(|v| serde_json::from_str(v)
        .map_err(|_| bad("order must be [field, asc|desc]"))).transpose()?;
    if order.as_ref().is_some_and(|(field, dir)| field.is_empty() || !matches!(dir.as_str(), "asc" | "desc")) {
        return Err(bad("Invalid order"));
    }
    let since = query.get("updated_since").map(|v| timestamp(v)).transpose()?;
    let before = query.get("updated_before").map(|v| timestamp(v)).transpose()?;
    let page = positive(query, "page", 1, 1_000_000)?;
    let size = positive(query, "size", 100, 1000)?;
    let count = match query.get("count").map(String::as_str) {
        None | Some("false") => false,
        Some("true") => true,
        _ => return Err(bad("count must be true or false")),
    };
    let prefix = query.get("prefix").map(String::as_str).unwrap_or_default();
    let mut statement = db.prepare("SELECT key,value,updated_at FROM kv WHERE scope=?1 AND collection=?2 ORDER BY key").map_err(internal)?;
    let rows = statement.query_map(params![scope,collection], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))).map_err(internal)?;
    // ponytail: filters and sorting scan a collection in memory; move to indexed JSON SQL for large collections.
    let mut records = Vec::new();
    for row in rows {
        let (key, value, updated_at) = row.map_err(internal)?;
        if !key.starts_with(prefix) { continue; }
        let updated = timestamp(&updated_at)?;
        if since.is_some_and(|since| updated < since) || before.is_some_and(|before| updated >= before) { continue; }
        let record = Record { key, value: serde_json::from_str(&value).map_err(internal)?, updated_at };
        if filters.iter().all(|(name, op, expected)| matches(field(&record, name), op, expected)) { records.push(record); }
    }
    if count { return Ok(response(json!({"count":records.len()}))); }
    if let Some((name, direction)) = order {
        records.sort_by(|a, b| {
            let order = match name.as_str() {
                "key" => a.key.cmp(&b.key),
                "updated_at" => a.updated_at.cmp(&b.updated_at),
                _ => compare(field(a, &name), field(b, &name)).unwrap_or(Ordering::Equal),
            };
            let order = if direction == "desc" { order.reverse() } else { order };
            order.then_with(|| a.key.cmp(&b.key))
        });
    }
    let items: Vec<_> = records.into_iter().skip((page - 1) * size).take(size).collect();
    Ok(response(json!({"items":items})))
}

fn metadata(db: &Connection, name: &str) -> ApiResult<Option<Value>> {
    db.query_row("SELECT content_type,length(data),updated_at FROM files WHERE name=?1", [name], |row| {
        Ok(json!({"name":name,"content_type":row.get::<_,String>(0)?,"size":row.get::<_,u64>(1)?,"updated_at":row.get::<_,String>(2)?}))
    }).optional().map_err(internal)
}

fn files(app: &App, db: &Connection, method: &Method, path: &str, query: &Params, headers: &HeaderMap, body: &[u8]) -> ApiResult<Response> {
    match (method.as_str(), path) {
        ("GET", "files") => {
            let mut statement = db.prepare("SELECT name,content_type,length(data),updated_at FROM files ORDER BY name").map_err(internal)?;
            let rows = statement.query_map([], |row| Ok(json!({"name":row.get::<_,String>(0)?,"content_type":row.get::<_,String>(1)?,"size":row.get::<_,u64>(2)?,"updated_at":row.get::<_,String>(3)?}))).map_err(internal)?;
            let items = rows.collect::<Result<Vec<_>, _>>().map_err(internal)?;
            Ok(response(json!({"items":items})))
        }
        ("PUT", "files/blob") => {
            let name = query.get("name").ok_or_else(|| bad("name is required"))?;
            name_valid(name)?;
            let content_type = headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("application/octet-stream");
            if content_type.len() > 255 { return Err(bad("Content-Type is too long")); }
            db.execute("INSERT INTO files(name,content_type,data,updated_at) VALUES(?1,?2,?3,?4)
                ON CONFLICT(name) DO UPDATE SET content_type=excluded.content_type,data=excluded.data,updated_at=excluded.updated_at",
                params![name,content_type,body,now()?]).map_err(internal)?;
            Ok(response(metadata(db, name)?.ok_or_else(missing)?))
        }
        ("POST", "files/url" | "files/urls") => {
            let body = parse_json(body)?;
            if path == "files/url" {
                let name = required(&body, "name")?;
                name_valid(name)?;
                metadata(db, name)?.ok_or_else(missing)?;
                return Ok(response(app.file_url(name)?));
            }
            let names = body.get("names").and_then(Value::as_array).ok_or_else(|| bad("names must be an array"))?;
            if names.len() > 1000 { return Err(bad("At most 1000 names per URL batch")); }
            let mut items = Vec::new();
            let mut missing = Vec::new();
            for name in names {
                let name = name.as_str().ok_or_else(|| bad("Every name must be a string"))?;
                name_valid(name)?;
                if metadata(db, name)?.is_some() { items.push(app.file_url(name)?); } else { missing.push(name); }
            }
            Ok(response(json!({"items":items,"missing":missing})))
        }
        ("GET", _) => download_locked(db, path.strip_prefix("files/").ok_or_else(missing)?),
        ("DELETE", _) => {
            let name = path.strip_prefix("files/").ok_or_else(missing)?;
            name_valid(name)?;
            db.execute("DELETE FROM files WHERE name=?1", [name]).map_err(internal)?;
            Ok(StatusCode::NO_CONTENT.into_response())
        }
        _ => Err(ApiError(StatusCode::METHOD_NOT_ALLOWED, "Unsupported file operation".into())),
    }
}

pub fn download(app: &App, name: &str) -> ApiResult<Response> {
    let db = app.db.lock().map_err(internal)?;
    download_locked(&db, name)
}

fn download_locked(db: &Connection, name: &str) -> ApiResult<Response> {
    name_valid(name)?;
    let (content_type, data) = db.query_row("SELECT content_type,data FROM files WHERE name=?1", [name], |row| {
        Ok((row.get::<_,String>(0)?, row.get::<_,Vec<u8>>(1)?))
    }).optional().map_err(internal)?.ok_or_else(missing)?;
    let mut result = data.into_response();
    result.headers_mut().insert(header::CONTENT_TYPE, content_type.parse().map_err(internal)?);
    result.headers_mut().insert(header::CONTENT_DISPOSITION, "attachment".parse().unwrap());
    result.headers_mut().insert(header::CACHE_CONTROL, "private, no-store".parse().unwrap());
    result.headers_mut().insert("x-content-type-options", "nosniff".parse().unwrap());
    Ok(result)
}
