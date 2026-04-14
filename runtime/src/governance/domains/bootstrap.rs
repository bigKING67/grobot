pub fn bootstrap(config: &RuntimeConfig) {
    eprintln!(
        "runtime bootstrap: concurrency={}, active_turn_soft_limit={}, turn_timeout_secs={}",
        config.target_concurrency, config.active_turn_soft_limit, config.turn_timeout_secs
    );
}
