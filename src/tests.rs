use super::*;
use axum::{body::Body, http::Request};
use tower::ServiceExt;

const TOKEN: &str = "test-token-with-at-least-32-characters";

fn app(path: &str) -> Arc<App> {
    App::open(
        TOKEN.into(),
        "http://localhost:8787".parse().unwrap(),
        path,
        Config::default(),
    )
    .unwrap()
}

fn temp_path(label: &str) -> String {
    std::env::temp_dir()
        .join(format!(
            "openrails-{label}-{}-{}.sqlite3",
            std::process::id(),
            time::OffsetDateTime::now_utc().unix_timestamp_nanos()
        ))
        .to_string_lossy()
        .into_owned()
}

async fn request(
    router: &Router,
    method: &str,
    path: &str,
    body: &str,
    authenticated: bool,
) -> Response {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json");
    if authenticated {
        builder = builder.header("authorization", format!("Bearer {TOKEN}"));
    }
    router
        .clone()
        .oneshot(builder.body(Body::from(body.to_owned())).unwrap())
        .await
        .unwrap()
}

async fn json_body(response: Response) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), MAX_BODY).await.unwrap()).unwrap()
}

#[tokio::test]
async fn authentication_and_persistent_kv() {
    let path = temp_path("persistence");
    let routes = router(app(&path));
    assert_eq!(
        request(&routes, "GET", "/health", "", false).await.status(),
        StatusCode::OK
    );
    let denied = request(
        &routes,
        "PUT",
        "/fn/data/kv/tasks/key",
        r#"{"value":1}"#,
        false,
    )
    .await;
    assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(denied.headers()["www-authenticate"], "Bearer");
    assert!(json_body(denied).await["detail"].is_string());
    assert_eq!(
        request(
            &routes,
            "PUT",
            "/fn/data/files/blob?name=too-big",
            &"x".repeat(MAX_BODY + 1),
            true
        )
        .await
        .status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
    assert_eq!(
        request(
            &routes,
            "POST",
            "/fn/data/llm/generate",
            r#"{"input":"hello"}"#,
            true
        )
        .await
        .status(),
        StatusCode::NOT_IMPLEMENTED
    );
    assert_eq!(
        json_body(request(&routes, "GET", "/fn/data/llm/providers", "", true).await).await,
        json!([])
    );
    let saved = request(
        &routes,
        "PUT",
        "/fn/data/kv/tasks/nested/key%20%E2%9C%93",
        r#"{"value":{"done":true}}"#,
        true,
    )
    .await;
    assert_eq!(saved.status(), StatusCode::OK);
    assert_eq!(json_body(saved).await["value"]["done"], true);
    drop(routes);
    let routes = router(app(&path));
    let saved = json_body(
        request(
            &routes,
            "GET",
            "/fn/data/kv/tasks/nested/key%20%E2%9C%93",
            "",
            true,
        )
        .await,
    )
    .await;
    assert_eq!(saved["key"], "nested/key ✓");
    assert_eq!(saved["value"]["done"], true);
    assert_eq!(
        request(
            &routes,
            "DELETE",
            "/fn/data/kv/tasks/nested/key%20%E2%9C%93",
            "",
            true
        )
        .await
        .status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        request(
            &routes,
            "GET",
            "/fn/data/kv/tasks/nested/key%20%E2%9C%93",
            "",
            true
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(&routes, "PUT", "/fn/data/kv/tasks/key", "{}", true)
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(
            &routes,
            "PUT",
            "/fn/data/kv-scoped/user/member/tasks/key",
            r#"{"value":1}"#,
            true
        )
        .await
        .status(),
        StatusCode::METHOD_NOT_ALLOWED
    );
}

#[tokio::test]
async fn filters_pagination_and_validation() {
    let routes = router(app(":memory:"));
    for (key, value) in [
        ("a", json!({"score":1,"nested":{"active":true}})),
        ("b", json!({"score":3,"nested":{"active":true}})),
        ("c", json!({"score":2,"nested":{"active":false}})),
        ("d", json!({"score":"mixed"})),
    ] {
        assert_eq!(
            request(
                &routes,
                "PUT",
                &format!("/fn/data/kv/tasks/{key}"),
                &json!({"value":value}).to_string(),
                true
            )
            .await
            .status(),
            StatusCode::OK
        );
    }
    let mut url = reqwest::Url::parse("http://localhost/fn/data/kv/tasks").unwrap();
    url.query_pairs_mut()
        .append_pair(
            "where",
            &json!([["score", "gte", 2], ["nested.active", "eq", true]]).to_string(),
        )
        .append_pair("order", &json!(["score", "desc"]).to_string());
    let uri = format!("{}?{}", url.path(), url.query().unwrap());
    let result = json_body(request(&routes, "GET", &uri, "", true).await).await;
    assert_eq!(result["items"].as_array().unwrap().len(), 1);
    assert_eq!(result["items"][0]["key"], "b");
    let result =
        json_body(request(&routes, "GET", "/fn/data/kv/tasks?page=2&size=1", "", true).await).await;
    assert_eq!(result["items"][0]["key"], "b");
    let result = json_body(
        request(
            &routes,
            "GET",
            "/fn/data/kv/tasks?count=true&prefix=a",
            "",
            true,
        )
        .await,
    )
    .await;
    assert_eq!(result["count"], 1);
    for query in [
        "size=0",
        "page=0",
        "size=1001",
        "where=bad",
        "order=bad",
        "updated_since=bad",
        "count=bad",
    ] {
        assert_eq!(
            request(
                &routes,
                "GET",
                &format!("/fn/data/kv/tasks?{query}"),
                "",
                true
            )
            .await
            .status(),
            StatusCode::BAD_REQUEST,
            "{query}"
        );
    }
}

#[tokio::test]
async fn files_signed_urls_and_reserved_names() {
    let state = app(":memory:");
    let routes = router(state.clone());
    let result = request(
        &routes,
        "PUT",
        "/fn/data/files/blob?name=folder%2Fdownload",
        "hello",
        true,
    )
    .await;
    assert_eq!(result.status(), StatusCode::OK);
    assert_eq!(json_body(result).await["size"], 5);
    assert_eq!(
        request(&routes, "GET", "/fn/data/files/folder/download", "", false)
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let result = request(&routes, "GET", "/fn/data/files/folder/download", "", true).await;
    assert_eq!(
        to_bytes(result.into_body(), MAX_BODY).await.unwrap(),
        "hello"
    );
    let batch = json_body(
        request(
            &routes,
            "POST",
            "/fn/data/files/urls",
            r#"{"names":["folder/download","absent"]}"#,
            true,
        )
        .await,
    )
    .await;
    assert_eq!(batch["missing"], json!(["absent"]));
    let url: reqwest::Url = batch["items"][0]["url"].as_str().unwrap().parse().unwrap();
    let uri = format!("{}?{}", url.path(), url.query().unwrap());
    let result = request(&routes, "GET", &uri, "", false).await;
    assert_eq!(result.status(), StatusCode::OK);
    assert_eq!(result.headers()["content-disposition"], "attachment");
    assert_eq!(
        request(
            &routes,
            "GET",
            &uri.replace("name=folder%2Fdownload", "name=other"),
            "",
            false
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
    let expired = unix_now() - 1;
    let uri = format!(
        "/downloads/file?name=folder%2Fdownload&expires={expired}&signature={}",
        state.signature("folder/download", expired)
    );
    assert_eq!(
        request(&routes, "GET", &uri, "", false).await.status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(
            &routes,
            "GET",
            "/downloads/file?name=folder%2Fdownload",
            "",
            false
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(
            &routes,
            "PUT",
            "/fn/data/files/blob?name=download",
            "reserved",
            true
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        request(&routes, "GET", "/fn/data/files/download", "", true)
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        request(
            &routes,
            "DELETE",
            "/fn/data/files/folder/download",
            "",
            true
        )
        .await
        .status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        request(&routes, "GET", "/fn/data/files/folder/download", "", true)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
}

#[test]
fn sql_is_read_only_and_parameterized() {
    let path = temp_path("sql");
    let db = Connection::open(&path).unwrap();
    db.execute_batch("CREATE TABLE tasks(id INTEGER PRIMARY KEY, title TEXT); INSERT INTO tasks VALUES(1,'hello');").unwrap();
    let result =
        providers::sql_query(&db, "SELECT title FROM tasks WHERE id=$1", &[json!(1)]).unwrap();
    assert_eq!(result["columns"], json!(["title"]));
    assert_eq!(result["rows"], json!([["hello"]]));
    assert_eq!(result["truncated"], false);
    for query in [
        "DELETE FROM tasks",
        "PRAGMA query_only=OFF",
        "ATTACH DATABASE ':memory:' AS other",
        "SELECT 1; SELECT 2",
        "SELECT load_extension('x')",
    ] {
        assert_eq!(
            providers::sql_query(&db, query, &[]).unwrap_err().0,
            StatusCode::BAD_REQUEST,
            "{query}"
        );
    }
    // A failed read-only query must not leave hooks installed on the primary database.
    db.execute("INSERT INTO tasks VALUES(2,'still writable')", [])
        .unwrap();
    let result = providers::sql_query(&db, "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1002) SELECT x FROM n", &[]).unwrap();
    assert_eq!(result["rowcount"], 1000);
    assert_eq!(result["truncated"], true);
}
