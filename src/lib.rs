use serde_json::{Value, json};
mod diagnostics;
mod style_signals;
pub use diagnostics::inspect;

/// A backstop for runaway size. Reviewed handoffs judged fine run to about
/// 7,800 characters, and none longer has been reviewed as clean prose, so there
/// is no evidence yet for a tighter limit.
pub const MAX_CHARACTERS: usize = 12_000;

pub struct Denial {
    pub rule: &'static str,
    pub reason: String,
    pub fix: &'static str,
    pub examples: Vec<String>,
}

/// The first blocking check, with what the sender needs to fix it.
pub fn denial(text: &str) -> Option<Denial> {
    diagnostics::checks(text, false)
        .into_iter()
        .find(|c| c.blocked)
        .map(|c| Denial {
            rule: c.decision_rule,
            reason: c.reason,
            fix: c.fix,
            examples: c.examples,
        })
}

/// The blocking rule and its reason, without any message text.
pub fn check(text: &str) -> Option<(&'static str, String)> {
    denial(text).map(|d| (d.rule, d.reason))
}

/// Tool-name suffixes that carry a handoff, and whether the tool always has text.
/// Codex concatenates namespaces (`collaborationspawn_agent`), and MCP tools
/// arrive with a server prefix, so only the suffix is fixed.
const TOOLS: [(&str, bool); 7] = [
    ("spawn_agent", true),
    ("send_message", true),
    ("followup_task", true),
    ("send_input", true),
    ("delegate_task", true),
    ("t3_thread_send", true),
    ("t3_thread_launch", false),
];
const TEXT_FIELDS: [&str; 3] = ["message", "task", "prompt"];

/// Inspect only resolved delivery arguments. Never scan or execute JavaScript source.
pub fn hook(event: &Value) -> Value {
    if event.get("hook_event_name").and_then(Value::as_str) != Some("PreToolUse") {
        return json!({});
    }
    let name = event.get("tool_name").and_then(Value::as_str).unwrap_or("");
    let Some(&(_, text_required)) = TOOLS.iter().find(|(tool, _)| name.ends_with(tool)) else {
        return json!({});
    };
    let parsed;
    let input = match event.get("tool_input") {
        Some(Value::String(s)) => {
            parsed = serde_json::from_str::<Value>(s).unwrap_or(Value::Null);
            &parsed
        }
        Some(v) => v,
        None => &Value::Null,
    };
    // Every text field counts, so a short `message` cannot hide a long `items`
    // list and splitting a handoff into blocks does not get past the size limit.
    let mut parts: Vec<&str> = TEXT_FIELDS
        .iter()
        .filter_map(|key| input.get(key).and_then(Value::as_str))
        .collect();
    if let Some(items) = input.get("items").and_then(Value::as_array) {
        parts.extend(
            items
                .iter()
                .filter(|v| v.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|v| v.get("text").and_then(Value::as_str)),
        );
    }
    if parts.is_empty() {
        return if text_required {
            deny(
                "invalid_arguments",
                "the handoff has no message, task or prompt text",
            )
        } else {
            json!({})
        };
    }
    match denial(&parts.join("\n")) {
        Some(d) => decision(format!(
            "Handoff Guard blocked this message, so nothing was sent. [{}] {}.{} {} {GUIDANCE}",
            d.rule,
            d.reason,
            if d.examples.is_empty() {
                String::new()
            } else {
                format!(
                    " From your message: {}.",
                    d.examples
                        .iter()
                        .map(|e| format!("“{e}”"))
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            },
            d.fix,
        )),
        None => json!({}),
    }
}

const GUIDANCE: &str = "A handoff should say what you want from the recipient first, give it what it needs and cannot look up, and read as plain English: whole words with spaces between them, whole sentences, and paths, commands and identifiers in backticks. Rewrite the message that way and send it again.";

fn decision(reason: String) -> Value {
    // Codex appends ". Tool: NAME" to the reason, so it must not end in a full stop.
    json!({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
        "permissionDecisionReason": reason.trim_end_matches('.')}})
}

pub fn deny(rule: &str, reason: &str) -> Value {
    decision(format!(
        "Handoff Guard blocked this message, so nothing was sent. [{rule}] {reason}. {GUIDANCE}"
    ))
}
