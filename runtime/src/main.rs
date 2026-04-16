mod extensions;
mod governance;
mod models;
mod orchestration;
mod tools;

use governance::session::{bootstrap, default_runtime_config};
use std::io::{self, BufRead, Write};

fn main() {
    let config = default_runtime_config();
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

        let response = extensions::protocol::handle_json_line(&input);
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
