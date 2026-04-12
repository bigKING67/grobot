mod protocol;

use std::io::{self, BufRead, Write};

#[derive(Debug, Clone)]
struct RuntimeConfig {
    target_concurrency: usize,
    active_turn_soft_limit: usize,
    turn_timeout_secs: u64,
}

fn bootstrap(config: &RuntimeConfig) {
    eprintln!(
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
    bootstrap(&config);

    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let input = match line {
            Ok(value) => value,
            Err(err) => {
                eprintln!("stdin read error: {err}");
                continue;
            }
        };

        if input.trim().is_empty() {
            continue;
        }

        let response = protocol::handle_json_line(&input);
        if writeln!(stdout, "{response}").is_err() {
            eprintln!("stdout write error");
            break;
        }
        if stdout.flush().is_err() {
            eprintln!("stdout flush error");
            break;
        }
    }
}
