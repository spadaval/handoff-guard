//! Small advisory detectors. Their matches never participate in denial decisions.
use serde_json::{Value, json};

fn prose_chars(text: &str) -> Vec<char> {
    let mut chars: Vec<char> = text.chars().collect();
    let mut base = 0;
    let mut fence: Option<char> = None;
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim_start();
        let marker = if trimmed.starts_with("```") {
            Some('`')
        } else if trimmed.starts_with("~~~") {
            Some('~')
        } else {
            None
        };
        let count = line.chars().count();
        if let Some(marker) = marker {
            fence = if fence == Some(marker) {
                None
            } else {
                Some(marker)
            };
            chars[base..base + count].fill(' ');
        } else if fence.is_some()
            || line.starts_with("    ")
            || line.starts_with('\t')
            || trimmed.starts_with('>')
            || line.contains(['{', '}', '|'])
            || trimmed.starts_with("import ")
            || trimmed.starts_with("from ")
            || trimmed.starts_with("use ")
            || line.contains("=>")
            || line.contains("==")
        {
            chars[base..base + count].fill(' ');
        } else {
            let end = base + count;
            let mut pos = base;
            while pos < end {
                let ch = chars[pos];
                let quoted = ch == '`'
                    || ch == '"'
                    || (ch == '\'' && (pos == base || !chars[pos - 1].is_alphanumeric()));
                if quoted {
                    // Only mask a bounded quoted span; an unmatched quote is ordinary punctuation.
                    if let Some(close) = (pos + 1..end).find(|&i| chars[i] == ch) {
                        chars[pos..=close].fill(' ');
                        pos = close + 1;
                        continue;
                    }
                }
                pos += 1;
            }
        }
        base += count;
    }
    chars
}

pub fn inspect(text: &str) -> Vec<Value> {
    let chars = prose_chars(text);
    let mut punctuation = Vec::new();
    let mut shorthand = Vec::new();
    let mut prose_words = 0;
    let mut start = 0;
    while start < chars.len() {
        if chars[start].is_whitespace() {
            start += 1;
            continue;
        }
        let end = (start..chars.len())
            .find(|&i| chars[i].is_whitespace())
            .unwrap_or(chars.len());
        let token = &chars[start..end];
        // Exclude recognizable technical tokens, not arbitrary English words.
        let technical = token
            .iter()
            .any(|c| matches!(c, '/' | '\\' | '_' | '@' | '=' | '(' | ')' | '<' | '>'))
            || token.iter().any(|c| c.is_ascii_digit());
        if !technical {
            let mut was_letter = false;
            for ch in token {
                if ch.is_alphabetic() && !was_letter {
                    prose_words += 1;
                }
                was_letter = ch.is_alphabetic();
            }
            for i in 1..token.len().saturating_sub(1) {
                let ch = token[i];
                if !matches!(ch, ',' | ';' | '!' | '?') {
                    continue;
                }
                let left = token[..i]
                    .iter()
                    .rev()
                    .take_while(|c| c.is_ascii_alphabetic())
                    .count();
                let right = token[i + 1..]
                    .iter()
                    .take_while(|c| c.is_ascii_alphabetic())
                    .count();
                if left >= 3 && right >= 2 {
                    punctuation.push(json!({"start": start + i, "end": start + i + 1}));
                }
            }
            let stripped = token
                .strip_suffix(&['.'])
                .or_else(|| token.strip_suffix(&[',']))
                .unwrap_or(token);
            let name = if stripped.ends_with(&['[', ']']) {
                stripped[..stripped.len() - 2]
                    .iter()
                    .collect::<String>()
                    .to_ascii_lowercase()
            } else {
                String::new()
            };
            // Status prose, not arbitrary array-field names such as cases[] or requires[].
            let array_marker = matches!(name.as_str(), "blockers" | "risks");
            let parts: Vec<_> = stripped.split(|c| *c == '+').collect();
            let plus_chain = parts.len() >= 3
                && parts
                    .iter()
                    .all(|p| p.len() >= 3 && p.iter().all(|c| c.is_ascii_alphabetic()));
            if array_marker || plus_chain {
                shorthand.push(json!({"start": start, "end": start + stripped.len()}));
            }
        }
        start = end;
    }
    [("punctuation_spacing", "missing spaces after commas, semicolons, question marks or exclamation marks", punctuation),
     ("needless_shorthand", "empty status-array prose or an alphabetic plus-chain", shorthand)]
        .into_iter().map(|(rule, description, spans)| {
            let matches = spans.len();
            json!({"rule":rule,"category":"style","status":if matches > 0 {"warn"} else {"pass"},
                "enforcement":"advisory","reason":if matches > 0 {Some(description)} else {None},
                "measurements":{"matches":matches,"prose_words":prose_words,"matches_per_100_words":if prose_words==0 {0.0} else {matches as f64 * 100.0 / prose_words as f64}},
                "thresholds":{"notice_matches":1,"score_saturation_per_100_words":20,"blocking":false},
                "spans":spans.iter().take(128).collect::<Vec<_>>(),"omitted_spans":matches.saturating_sub(128)})
        }).collect()
}
