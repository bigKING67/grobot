fn read_cache_store() -> &'static Mutex<ReadCacheStore> {
    static STORE: OnceLock<Mutex<ReadCacheStore>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(ReadCacheStore::default()))
}

fn build_read_cache_key(session_key: &str, target: &Path, request: &ReadRequest) -> String {
    let normalized_limit = request
        .line_limit
        .map(|value| value.to_string())
        .unwrap_or_else(|| "none".to_string());
    format!(
        "{}::{}::{}::{}::{}",
        session_key,
        target.to_string_lossy(),
        request.start_line,
        normalized_limit,
        request.range_mode
    )
}

fn lookup_read_cache(cache_key: &str, mtime_ms: u128) -> Option<ReadCacheEntry> {
    let Ok(store) = read_cache_store().lock() else {
        return None;
    };
    let cached = store.entries.get(cache_key)?;
    if cached.mtime_ms != mtime_ms {
        return None;
    }
    Some(cached.clone())
}

fn store_read_cache(cache_key: String, entry: ReadCacheEntry) {
    let Ok(mut store) = read_cache_store().lock() else {
        return;
    };
    if store.entries.contains_key(&cache_key) {
        store.order.retain(|item| item != &cache_key);
    }
    store.entries.insert(cache_key.clone(), entry);
    store.order.push_back(cache_key);
    while store.entries.len() > READ_CACHE_MAX_ENTRIES {
        let Some(stale_key) = store.order.pop_front() else {
            break;
        };
        store.entries.remove(&stale_key);
    }
}
