#[derive(Debug, Clone)]
struct RuntimeConfig {
    target_concurrency: usize,
    active_turn_soft_limit: usize,
    turn_timeout_secs: u64,
}

fn bootstrap(config: RuntimeConfig) {
    println!(
        "runtime bootstrap: concurrency={}, active_turn_soft_limit={}, turn_timeout_secs={}",
        config.target_concurrency, config.active_turn_soft_limit, config.turn_timeout_secs
    );
}

fn main() {
    let config = RuntimeConfig {
        target_concurrency: 100,
        active_turn_soft_limit: 60,
        turn_timeout_secs: 180,
    };
    bootstrap(config);
}
