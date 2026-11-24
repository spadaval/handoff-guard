use serde_json::{Value, json};
mod diagnostics;
mod style_signals;
pub use diagnostics::inspect;

pub const MAX_CHARACTERS: usize = 12_000;
pub const MAX_WORDS: usize = 1_500;

/// Style checks deliberately avoid interpreting markup, code, or natural language.
/// Long ASCII alphabetic runs contribute to glued prose; technical tokens are exempt.
pub fn check(text: &str) -> Option<(&'static str, String)> {
    diagnostics::checks(text, false)
        .into_iter()
        .find(|c| c.blocked)
        .map(|c| (c.decision_rule, c.reason))
}

/// Inspect only resolved delivery arguments. Never scan or execute JavaScript source.
pub fn hook(event: &Value) -> Value {
    if event.get("hook_event_name").and_then(Value::as_str) != Some("PreToolUse") {
        return json!({});
    }
    let name = event.get("tool_name").and_then(Value::as_str).unwrap_or("");
    // Codex 0.169.0 concatenates namespaces (e.g. collaborationspawn_agent).
    // Match the fixed tool suffix across plain, MCP, and configured namespaces.
    if !["spawn_agent", "send_message", "followup_task"]
        .iter()
        .any(|tool| name.ends_with(tool))
    {
        return json!({});
    }
    let parsed;
    let input = match event.get("tool_input") {
        Some(Value::String(s)) => {
            parsed = serde_json::from_str::<Value>(s).unwrap_or(Value::Null);
            &parsed
        }
        Some(v) => v,
        None => &Value::Null,
    };
    // Legacy native spawn accepts text items instead of message. Join all text
    // items so splitting an oversized handoff into blocks doesn't bypass size policy.
    let message = if let Some(s) = input.get("message").and_then(Value::as_str) {
        Some(s.to_owned())
    } else {
        input.get("items").and_then(Value::as_array).map(|items| {
            items
                .iter()
                .filter(|v| v.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|v| v.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n")
        })
    };
    let Some(message) = message else {
        return deny(
            "invalid_arguments",
            "resolved handoff has no message string or text items",
        );
    };
    match check(&message) {
        Some((rule, reason)) => deny(rule, &reason),
        None => json!({}),
    }
}

pub fn deny(rule: &str, reason: &str) -> Value {
    json!({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
        "permissionDecisionReason": format!("Handoff Guard [{rule}]: {reason}. Rewrite the handoff as a shorter, readable message and retry. Nothing was truncated.")}})
}
