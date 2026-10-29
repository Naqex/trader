use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn runtime() -> Arc<ProviderRuntime> {
    let root = std::env::temp_dir().join(format!("catalog-refresh-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    ProviderRuntime::load(
        root,
        DownloadEngine::Dukascopy {
            metadata: json!({"version":"1.50.0","items":[]}),
            adapter_present: true,
        },
    )
    .unwrap()
}

fn payload() -> Value {
    json!({"groups":[{"id":1,"code":"FX","parentId":null}],
        "instruments":[{"name":"EUR/USD","code":"eurusd","description":"Euro €",
            "pipValue":0.0001,"priceScale":5,"groupId":1}]})
}

async fn serve(response: Vec<u8>, delay: Duration) -> (String, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/instruments", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = [0; 4096];
        stream.read(&mut request).await.unwrap();
        tokio::time::sleep(delay).await;
        let _ = stream.write_all(&response).await;
    });
    (url, task)
}

fn response(body: &[u8]) -> Vec<u8> {
    let mut out = format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    out.extend_from_slice(body);
    out
}

#[tokio::test]
async fn refresh_is_bounded_atomic_cached_and_cooldown_serialized() {
    let runtime = runtime();
    let raw = serde_json::to_vec(&payload()).unwrap();
    let (url, task) = serve(response(&raw), Duration::from_millis(80)).await;
    let first = refresh_from(runtime.clone(), &url, Duration::from_secs(1));
    let second = async {
        tokio::time::sleep(Duration::from_millis(20)).await;
        let start = std::time::Instant::now();
        refresh_from(runtime.clone(), &url, Duration::from_secs(1))
            .await
            .unwrap();
        assert!(start.elapsed() < Duration::from_millis(50));
    };
    let (result, ()) = tokio::join!(first, second);
    result.unwrap();
    task.await.unwrap();
    assert_eq!(runtime.catalog_state()["error"], Value::Null);
    assert_eq!(runtime.catalog_state()["refresh_available"], false);
    assert_eq!(runtime.instruments()[0]["name"], "Euro €");
    let loaded = ProviderRuntime::load(runtime.root.clone(), runtime.engine.clone()).unwrap();
    assert_eq!(loaded.instruments(), runtime.instruments());
    // No second connection, even after the first refresh has completed.
    refresh_from(runtime.clone(), &url, Duration::from_secs(1))
        .await
        .unwrap();
    let old = std::fs::read(runtime.root.join("catalog/dukascopy-instruments.json")).unwrap();
    runtime.catalog.write().unwrap().next_refresh_for_test();
    let mut changed = payload();
    changed["instruments"][0]["description"] = json!("Updated");
    let (url, task) = serve(
        response(&serde_json::to_vec(&changed).unwrap()),
        Duration::ZERO,
    )
    .await;
    refresh_from(runtime.clone(), &url, Duration::from_secs(1))
        .await
        .unwrap();
    task.await.unwrap();
    assert_eq!(runtime.instruments()[0]["name"], "Updated");
    assert_ne!(
        old,
        std::fs::read(runtime.root.join("catalog/dukascopy-instruments.json")).unwrap()
    );
    assert_eq!(
        std::fs::read_dir(runtime.root.join("catalog"))
            .unwrap()
            .count(),
        1
    );
    std::fs::remove_dir_all(&runtime.root).unwrap();
}

#[tokio::test]
async fn failed_refresh_preserves_cache_for_rate_limit_redirect_invalid_oversize_and_timeout() {
    let runtime = runtime();
    let (value, items) = snapshot(payload()).unwrap();
    publish(&runtime, value, items).unwrap();
    let path = runtime.root.join("catalog/dukascopy-instruments.json");
    let old = std::fs::read(&path).unwrap();
    let cases = vec![
        (
            b"HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\n\r\n".to_vec(),
            Duration::ZERO,
            "rate_limited",
        ),
        (
            b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/\r\nContent-Length: 0\r\n\r\n"
                .to_vec(),
            Duration::ZERO,
            "source_unavailable",
        ),
        (response(b"not-json"), Duration::ZERO, "invalid_response"),
        (response(b"{}"), Duration::ZERO, "invalid_response"),
        (
            format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n",
                catalog::LIMIT + 1
            )
            .into_bytes(),
            Duration::ZERO,
            "invalid_response",
        ),
        (
            response(b"{}"),
            Duration::from_millis(150),
            "source_unavailable",
        ),
    ];
    for (raw, delay, error) in cases {
        runtime.catalog.write().unwrap().next_refresh_for_test();
        let (url, task) = serve(raw, delay).await;
        refresh_from(runtime.clone(), &url, Duration::from_millis(70))
            .await
            .unwrap();
        task.await.unwrap();
        let state = runtime.catalog_state();
        assert_eq!(state["error"], error);
        if error == "rate_limited" {
            assert!(state["retry_after_seconds"].as_u64().unwrap() >= 299);
        }
        assert_eq!(std::fs::read(&path).unwrap(), old);
        assert_eq!(runtime.instruments()[0]["name"], "Euro €");
    }
    let mut raw = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n".to_vec();
    for _ in 0..33 {
        raw.extend_from_slice(b"10000\r\n");
        raw.extend(vec![b' '; 65536]);
        raw.extend_from_slice(b"\r\n");
    }
    raw.extend_from_slice(b"0\r\n\r\n");
    let (url, task) = serve(raw, Duration::ZERO).await;
    assert_eq!(
        fetch(&client().unwrap(), &url).await.unwrap_err(),
        "invalid_response"
    );
    task.await.unwrap();
    assert_eq!(std::fs::read(path).unwrap(), old);
    std::fs::remove_dir_all(&runtime.root).unwrap();
}

#[tokio::test]
async fn request_cancellation_leaves_no_partial_cache_or_queued_refresh() {
    let runtime = runtime();
    let (url, task) = serve(response(b"{}"), Duration::from_millis(150)).await;
    let copy = runtime.clone();
    let refresh =
        tokio::spawn(async move { refresh_from(copy, &url, Duration::from_secs(1)).await });
    tokio::time::sleep(Duration::from_millis(30)).await;
    refresh.abort();
    let _ = refresh.await;
    task.await.unwrap();
    assert!(runtime.catalog_refresh.try_lock().is_ok());
    assert_eq!(runtime.catalog_state()["error"], "source_unavailable");
    assert!(!runtime.root.join("catalog").exists());
    std::fs::remove_dir_all(&runtime.root).unwrap();
}
