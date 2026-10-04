use super::*;
use axum::{body::Body, http::Request};
use tower::ServiceExt;

const TOKEN: &str = "test-token-with-at-least-32-characters";

fn app(path: &str) -> Arc<App> {
    let files_dir = PathBuf::from(if path == ":memory:" {
        temp_path("files")
    } else {
        path.to_owned()
    })
    .with_extension("files");
    App::open(
        TOKEN.into(),
        "http://localhost:8787".parse().unwrap(),
        path,
        &files_dir,
        Config::default(),
        None,
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

#[tokio::test]
async fn filesystem_files_are_immutable_and_keep_sqlite_small() {
    let state = app(":memory:");
    let routes = router(state.clone());
    let original = "a".repeat(20_000);
    assert_eq!(
        request(
            &routes,
            "PUT",
            "/fn/data/files/blob?name=nested%2Ffile",
            &original,
            true
        )
        .await
        .status(),
        StatusCode::OK
    );
    let first_key: String = state
        .db
        .lock()
        .unwrap()
        .query_row(
            "SELECT storage_key FROM files WHERE name='nested/file'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let first_path = state.files_dir.join(format!("{first_key}.blob"));
    assert_eq!(std::fs::read(&first_path).unwrap(), original.as_bytes());
    let columns = {
        let db = state.db.lock().unwrap();
        let mut statement = db.prepare("PRAGMA table_info(files)").unwrap();
        statement
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };
    assert!(!columns.iter().any(|column| column == "data"));
    let snapshot = request(&routes, "GET", "/fn/data/files/nested/file", "", true).await;
    assert_eq!(snapshot.headers()["content-length"], "20000");
    assert_eq!(
        request(
            &routes,
            "PUT",
            "/fn/data/files/blob?name=nested%2Ffile",
            "updated",
            true
        )
        .await
        .status(),
        StatusCode::OK
    );
    // An already-open download must finish with its original bytes, not the replacement.
    assert_eq!(
        to_bytes(snapshot.into_body(), MAX_BODY).await.unwrap(),
        original
    );
    let current_key: String = state
        .db
        .lock()
        .unwrap()
        .query_row(
            "SELECT storage_key FROM files WHERE name='nested/file'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_ne!(current_key, first_key);
    let updated = request(&routes, "GET", "/fn/data/files/nested/file", "", true).await;
    assert_eq!(
        to_bytes(updated.into_body(), MAX_BODY).await.unwrap(),
        "updated"
    );
    // Failure after the disk write must preserve the currently committed file.
    state.db.lock().unwrap().execute_batch("CREATE TRIGGER reject_file_update BEFORE UPDATE ON files BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
    assert_eq!(
        request(
            &routes,
            "PUT",
            "/fn/data/files/blob?name=nested%2Ffile",
            "rejected",
            true
        )
        .await
        .status(),
        StatusCode::INTERNAL_SERVER_ERROR
    );
    let unchanged = request(&routes, "GET", "/fn/data/files/nested/file", "", true).await;
    assert_eq!(
        to_bytes(unchanged.into_body(), MAX_BODY).await.unwrap(),
        "updated"
    );
    assert_eq!(
        request(&routes, "DELETE", "/fn/data/files/nested/file", "", true)
            .await
            .status(),
        StatusCode::NO_CONTENT
    );
    assert!(!state.files_dir.join(format!("{current_key}.blob")).exists());
    assert_eq!(
        request(&routes, "DELETE", "/fn/data/files/nested/file", "", true)
            .await
            .status(),
        StatusCode::NO_CONTENT
    );
    // Logical names cannot select filesystem paths, even when a direct API caller supplies ../.
    assert_eq!(
        request(
            &routes,
            "PUT",
            "/fn/data/files/blob?name=..%2Foutside",
            "safe",
            true
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert!(!state.files_dir.join("outside").exists());
    for entry in std::fs::read_dir(&state.files_dir).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name().into_string().unwrap();
        assert!(name.ends_with(".blob"));
        assert_eq!(name.len(), 69);
        assert!(name[..64].bytes().all(|b| b.is_ascii_hexdigit()));
    }
}

#[tokio::test]
async fn sqlite_blobs_migrate_once_and_preserve_originals() {
    let path = temp_path("blob-migration");
    let db = Connection::open(&path).unwrap();
    db.execute_batch("CREATE TABLE files(name TEXT PRIMARY KEY,content_type TEXT NOT NULL,data BLOB NOT NULL,updated_at TEXT NOT NULL);").unwrap();
    let binary = [0_u8, 1, 255, 128];
    let updated = "2026-01-01T00:00:00Z";
    db.execute(
        "INSERT INTO files VALUES(?1,?2,?3,?4)",
        rusqlite::params![
            "folder/binary",
            "application/octet-stream",
            binary.as_slice(),
            updated
        ],
    )
    .unwrap();
    db.execute(
        "INSERT INTO files VALUES(?1,?2,?3,?4)",
        rusqlite::params!["empty", "text/plain", &[] as &[u8], updated],
    )
    .unwrap();
    drop(db);
    let state = app(&path);
    let routes = router(state.clone());
    let result = request(&routes, "GET", "/fn/data/files/folder/binary", "", true).await;
    assert_eq!(result.status(), StatusCode::OK);
    assert_eq!(result.headers()["content-type"], "application/octet-stream");
    assert_eq!(
        to_bytes(result.into_body(), MAX_BODY)
            .await
            .unwrap()
            .as_ref(),
        binary
    );
    let meta = json_body(request(&routes, "GET", "/fn/data/files", "", true).await).await;
    assert_eq!(meta["items"][1]["size"], 4);
    assert_eq!(meta["items"][1]["updated_at"], updated);
    let result = request(&routes, "GET", "/fn/data/files/empty", "", true).await;
    assert_eq!(result.headers()["content-length"], "0");
    assert!(
        to_bytes(result.into_body(), MAX_BODY)
            .await
            .unwrap()
            .is_empty()
    );
    let db = state.db.lock().unwrap();
    let original: Vec<u8> = db
        .query_row(
            "SELECT data FROM files_blob_backup WHERE name='folder/binary'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(original, binary);
    let key: String = db
        .query_row(
            "SELECT storage_key FROM files WHERE name='folder/binary'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    drop(db);
    let directory = state.files_dir.clone();
    drop(routes);
    drop(state);
    let reopened = app(&path);
    let next_key: String = reopened
        .db
        .lock()
        .unwrap()
        .query_row(
            "SELECT storage_key FROM files WHERE name='folder/binary'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(next_key, key);
    assert_eq!(std::fs::read_dir(directory).unwrap().count(), 2);
}

#[test]
fn failed_blob_migration_rolls_back_and_can_be_retried() {
    let path = temp_path("migration-failure");
    let directory = PathBuf::from(&path).with_extension("files");
    let mut db = Connection::open(&path).unwrap();
    db.execute_batch("CREATE TABLE files(name TEXT PRIMARY KEY,content_type TEXT NOT NULL,data BLOB NOT NULL,updated_at TEXT NOT NULL);
        INSERT INTO files VALUES('good','text/plain',x'68656c6c6f','2026-01-01T00:00:00Z');
        INSERT INTO files VALUES('bad','text/plain','invalid blob type','2026-01-01T00:00:00Z');").unwrap();
    assert!(storage::initialize_files(&mut db, &directory).is_err());
    let original: Vec<u8> = db
        .query_row("SELECT data FROM files WHERE name='good'", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(original, b"hello");
    assert_eq!(
        db.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name='files_blob_backup'",
            [],
            |row| row.get::<_, u64>(0)
        )
        .unwrap(),
        0
    );
    db.execute("UPDATE files SET data=x'6669786564' WHERE name='bad'", [])
        .unwrap();
    storage::initialize_files(&mut db, &directory).unwrap();
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM files", [], |row| row.get::<_, u64>(0))
            .unwrap(),
        2
    );
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM files_blob_backup", [], |row| row
            .get::<_, u64>(0))
            .unwrap(),
        2
    );
}

#[cfg(unix)]
#[tokio::test]
async fn downloads_reject_unsafe_storage_keys_and_symlinks() {
    let state = app(":memory:");
    let routes = router(state.clone());
    request(
        &routes,
        "PUT",
        "/fn/data/files/blob?name=test",
        "safe",
        true,
    )
    .await;
    state
        .db
        .lock()
        .unwrap()
        .execute(
            "UPDATE files SET storage_key='../outside' WHERE name='test'",
            [],
        )
        .unwrap();
    assert_eq!(
        request(&routes, "GET", "/fn/data/files/test", "", true)
            .await
            .status(),
        StatusCode::INTERNAL_SERVER_ERROR
    );
    let target = state.files_dir.join("sentinel");
    std::fs::write(&target, "outside content").unwrap();
    let key = "a".repeat(64);
    std::os::unix::fs::symlink(&target, state.files_dir.join(format!("{key}.blob"))).unwrap();
    state
        .db
        .lock()
        .unwrap()
        .execute("UPDATE files SET storage_key=?1 WHERE name='test'", [&key])
        .unwrap();
    assert_eq!(
        request(&routes, "GET", "/fn/data/files/test", "", true)
            .await
            .status(),
        StatusCode::INTERNAL_SERVER_ERROR
    );
}

#[test]
fn project_identifiers_keys_and_signatures_are_safe() {
    for id in ["shop", "crm", "test_1", "project-2"] {
        validate_project_id(id).unwrap();
    }
    for id in [
        "",
        "..",
        "../shop",
        "shop/crm",
        "SHOP",
        "shop\\crm",
        "é",
        "shop ",
        &"a".repeat(65),
    ] {
        assert!(validate_project_id(id).is_err(), "{id:?}");
    }
    for key in [
        "short".to_owned(),
        "a".repeat(31),
        format!("{} ", "a".repeat(32)),
        format!("{}\x7f", "a".repeat(32)),
        "é".repeat(32),
    ] {
        assert!(validate_token(&key).is_err());
    }
    validate_token(TOKEN).unwrap();
    let mut shop = app(":memory:");
    let mut crm = app(":memory:");
    Arc::get_mut(&mut shop).unwrap().project_id = Some("shop".into());
    Arc::get_mut(&mut crm).unwrap().project_id = Some("crm".into());
    // IDs are bound into signatures even if a key is later reused for a different project.
    assert_ne!(
        shop.signature("same.txt", 123),
        crm.signature("same.txt", 123)
    );
}

#[tokio::test]
async fn atomic_conditions_file_coupling_and_independent_connections() {
    let path = temp_path("atomic");
    let first = router(app(&path));
    let second = router(app(&path));
    let body = json!({"checks":[{"collection":"names","key":"alice","exists":false}],
        "puts":[{"collection":"names","key":"alice","value":{"owner":"one"}},
                {"collection":"posts","key":"one","value":{"image":"one.txt"}}],
        "attachment":{"name":"one.txt","content_type":"text/plain","data":"aGVsbG8="}})
    .to_string();
    let (left, right) = tokio::join!(
        request(&first, "POST", "/fn/data/kv/transaction", &body, true),
        request(&second, "POST", "/fn/data/kv/transaction", &body, true)
    );
    let statuses = [left.status(), right.status()];
    assert!(statuses.contains(&StatusCode::OK));
    assert!(statuses.contains(&StatusCode::CONFLICT));
    assert_eq!(
        request(&first, "GET", "/fn/data/files/one.txt", "", true)
            .await
            .status(),
        StatusCode::OK
    );
    let stale = json!({"checks":[{"collection":"names","key":"alice","exists":true,"value":{"owner":"wrong"}}],
        "puts":[{"collection":"posts","key":"bad","value":1}],
        "attachment":{"name":"bad.txt","content_type":"text/plain","data":"aGVsbG8="}}).to_string();
    assert_eq!(
        request(&first, "POST", "/fn/data/kv/transaction", &stale, true)
            .await
            .status(),
        StatusCode::CONFLICT
    );
    assert_eq!(
        request(&first, "GET", "/fn/data/kv/posts/bad", "", true)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(&first, "GET", "/fn/data/files/bad.txt", "", true)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(&first, "POST", "/fn/data/kv/transaction", &body, false)
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(
            &first,
            "POST",
            "/fn/data/kv-scoped/user/member/transaction",
            &body,
            true
        )
        .await
        .status(),
        StatusCode::METHOD_NOT_ALLOWED
    );
    // Existing JSON null is different from an absent record.
    request(
        &first,
        "PUT",
        "/fn/data/kv/nulls/key",
        r#"{"value":null}"#,
        true,
    )
    .await;
    assert_eq!(
        request(
            &first,
            "POST",
            "/fn/data/kv/transaction",
            r#"{"checks":[{"collection":"nulls","key":"key","exists":false}]}"#,
            true
        )
        .await
        .status(),
        StatusCode::CONFLICT
    );
    assert_eq!(
        request(
            &first,
            "POST",
            "/fn/data/kv/transaction",
            r#"{"checks":[{"collection":"nulls","key":"key","exists":true,"value":null}]}"#,
            true
        )
        .await
        .status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn explicit_gc_preserves_referenced_files_and_rejects_revoked_guards() {
    let state = app(":memory:");
    let directory = state.files_dir.clone();
    let routes = router(state);
    assert_eq!(
        request(
            &routes,
            "PUT",
            "/fn/data/files/blob?name=retained",
            "hello",
            true
        )
        .await
        .status(),
        StatusCode::OK
    );
    let orphan = directory.join(format!("{}.blob", "a".repeat(64)));
    std::fs::write(&orphan, b"unused").unwrap();
    std::fs::write(directory.join("notes.txt"), b"not a server blob").unwrap();
    let dry = r#"{"confirm":true,"dry_run":true}"#;
    assert_eq!(
        request(&routes, "POST", "/fn/data/files/gc", dry, false)
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(
            &routes,
            "POST",
            "/fn/data/files/gc",
            r#"{"confirm":false,"dry_run":false}"#,
            true
        )
        .await
        .status(),
        StatusCode::BAD_REQUEST
    );
    let result = json_body(request(&routes, "POST", "/fn/data/files/gc", dry, true).await).await;
    assert_eq!(result["files"], 1);
    assert!(orphan.exists());
    request(
        &routes,
        "PUT",
        "/fn/data/kv/admin/session",
        r#"{"value":{"revoked":true}}"#,
        true,
    )
    .await;
    let guard = r#"{"confirm":true,"dry_run":false,"checks":[{"collection":"admin","key":"session","exists":true,"value":{"revoked":false}}]}"#;
    assert_eq!(
        request(&routes, "POST", "/fn/data/files/gc", guard, true)
            .await
            .status(),
        StatusCode::CONFLICT
    );
    assert!(orphan.exists());
    let result = json_body(
        request(
            &routes,
            "POST",
            "/fn/data/files/gc",
            r#"{"confirm":true,"dry_run":false}"#,
            true,
        )
        .await,
    )
    .await;
    assert_eq!(result["files"], 1);
    assert!(!orphan.exists());
    assert!(directory.join("notes.txt").exists());
    assert_eq!(
        request(&routes, "GET", "/fn/data/files/retained", "", true)
            .await
            .status(),
        StatusCode::OK
    );
}
