const FILE_MUTATION_LOCK_MAX_TRACKED: usize = 2048;

#[derive(Debug, Default)]
struct FileMutationQueueStore {
    locks: HashMap<String, Arc<Mutex<()>>>,
}

fn file_mutation_queue_store() -> &'static Mutex<FileMutationQueueStore> {
    static STORE: OnceLock<Mutex<FileMutationQueueStore>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(FileMutationQueueStore::default()))
}

fn acquire_file_mutation_lock(target: &Path) -> Result<Arc<Mutex<()>>, ToolExecutionError> {
    let key = target.to_string_lossy().to_string();
    let mut store = file_mutation_queue_store()
        .lock()
        .map_err(|_| ToolExecutionError::new("runtime_state_unavailable", "failed to lock file mutation queue store"))?;
    if store.locks.len() > FILE_MUTATION_LOCK_MAX_TRACKED {
        store.locks.retain(|_, lock| Arc::strong_count(lock) > 1);
    }
    Ok(store
        .locks
        .entry(key)
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone())
}
