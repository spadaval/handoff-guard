use serde_json::json;
use std::io::{self, BufRead, Read};

fn main() {
    let mode = std::env::args().nth(1).unwrap_or_else(|| "hook".into());
    if mode == "evaluate" || mode == "inspect" {
        for line in io::stdin().lock().lines() {
            let result = line.map_err(|e| e.to_string()).and_then(|s| {
                serde_json::from_str::<serde_json::Value>(&s).map_err(|e| e.to_string())
            });
            match result {
                Ok(row) if row["text"].is_string() => {
                    let text = row["text"].as_str().unwrap();
                    if mode == "inspect" {
                        let mut report = handoff_guard::inspect(text);
                        report["message_id"] = row["message_id"].clone();
                        println!("{report}");
                        continue;
                    }
                    let result = handoff_guard::check(text);
                    println!(
                        "{}",
                        json!({"message_id": row["message_id"], "rule": result.as_ref().map(|x| x.0), "reason": result.map(|x|x.1)})
                    );
                }
                _ => {
                    eprintln!("Expected a JSONL record with a text string");
                    std::process::exit(1);
                }
            }
        }
        return;
    }
    if mode != "hook" {
        eprintln!("Usage: handoff-guard [hook|evaluate|inspect]");
        std::process::exit(1);
    }
    let mut input = String::new();
    // Bound memory, including JSON escaping overhead. Explicit deny rather than a crash.
    let result = io::stdin()
        .take(8 * 1024 * 1024 + 1)
        .read_to_string(&mut input);
    let output = if result.is_err() || input.len() > 8 * 1024 * 1024 {
        handoff_guard::deny("hook_input", "hook input is unreadable or exceeds 8 MiB")
    } else {
        match serde_json::from_str(&input) {
            Ok(event) => handoff_guard::hook(&event),
            Err(_) => handoff_guard::deny("hook_input", "hook input is not valid JSON"),
        }
    };
    println!("{output}");
}
