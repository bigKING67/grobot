#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    pub target_concurrency: usize,
    pub active_turn_soft_limit: usize,
    pub turn_timeout_secs: u64,
}

pub fn default_runtime_config() -> RuntimeConfig {
    RuntimeConfig {
        target_concurrency: 100,
        active_turn_soft_limit: 60,
        turn_timeout_secs: 180,
    }
}

pub fn bootstrap(config: &RuntimeConfig) {
    eprintln!(
        "runtime bootstrap: concurrency={}, active_turn_soft_limit={}, turn_timeout_secs={}",
        config.target_concurrency, config.active_turn_soft_limit, config.turn_timeout_secs
    );
}
