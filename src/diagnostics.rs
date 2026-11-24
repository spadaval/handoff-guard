use crate::{MAX_CHARACTERS, MAX_WORDS};
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub const POLICY_VERSION: &str = "conservative-v1";
const MAX_SPANS: usize = 128;

struct Word<'a> {
    text: &'a str,
    start: usize,
    end: usize,
}
fn words(text: &str) -> Vec<Word<'_>> {
    let mut result = Vec::new();
    let mut start = None;
    let mut count = 0;
    for (cp, (byte, ch)) in text.char_indices().enumerate() {
        count = cp + 1;
        if ch.is_whitespace() {
            if let Some((b, s)) = start.take() {
                result.push(Word {
                    text: &text[b..byte],
                    start: s,
                    end: cp,
                });
            }
        } else if start.is_none() {
            start = Some((byte, cp));
        }
    }
    if let Some((b, s)) = start {
        result.push(Word {
            text: &text[b..],
            start: s,
            end: count,
        });
    }
    result
}
fn span(start: usize, end: usize) -> Value {
    json!({"start":start,"end":end})
}
fn percentage(n: usize, d: usize) -> f64 {
    if d == 0 {
        0.0
    } else {
        n as f64 * 100.0 / d as f64
    }
}

pub struct Check {
    pub rule: &'static str,
    pub decision_rule: &'static str,
    pub category: &'static str,
    pub blocked: bool,
    pub reason: String,
    measurements: Value,
    thresholds: Value,
    spans: Vec<Value>,
}
impl Check {
    fn value(&self) -> Value {
        json!({"rule":self.rule,"category":self.category,"status":if self.blocked {"block"} else {"pass"},
            "reason":if self.blocked {Some(self.reason.as_str())} else {None},"measurements":self.measurements,"thresholds":self.thresholds,
            "spans":self.spans.iter().take(MAX_SPANS).collect::<Vec<_>>(),
            "omitted_spans":self.spans.len().saturating_sub(MAX_SPANS)})
    }
}

/// Measurements and hook decisions share this exact implementation.
/// Ranges are zero-based Unicode scalar indices, end exclusive.
pub fn checks(text: &str, full_report: bool) -> Vec<Check> {
    let characters = text.chars().count();
    let character_check = Check {
        rule: "characters",
        decision_rule: "characters",
        category: "size",
        blocked: characters > MAX_CHARACTERS,
        reason: format!("{characters} characters exceeds {MAX_CHARACTERS}"),
        measurements: json!({"characters":characters}),
        thresholds: json!({"maximum":MAX_CHARACTERS,"operator":">"}),
        spans: if characters > MAX_CHARACTERS {
            vec![span(MAX_CHARACTERS, characters)]
        } else {
            vec![]
        },
    };
    // The hook retains cheap size rejection; offline inspection measures every rule.
    if !full_report && character_check.blocked {
        return vec![character_check];
    }
    let all_words = words(text);
    let mut result = vec![
        character_check,
        Check {
            rule: "words",
            decision_rule: "words",
            category: "size",
            blocked: all_words.len() > MAX_WORDS,
            reason: format!(
                "{} whitespace-separated words exceeds {MAX_WORDS}",
                all_words.len()
            ),
            measurements: json!({"words":all_words.len()}),
            thresholds: json!({"maximum":MAX_WORDS,"operator":">"}),
            spans: if all_words.len() > MAX_WORDS {
                vec![span(all_words[MAX_WORDS].start, characters)]
            } else {
                vec![]
            },
        },
    ];
    if !full_report && result[1].blocked {
        return result;
    }
    let (mut fenced, mut glued, mut longest, mut base) = (false, 0, 0, 0);
    let mut glue_spans = Vec::new();
    for line in text.split_inclusive('\n') {
        if line.trim_start().starts_with("```") || line.trim_start().starts_with("~~~") {
            fenced = !fenced;
        } else if !fenced {
            for word in words(line) {
                let token = word.text;
                if token.starts_with(['/', '\\'])
                    || token.starts_with("http://")
                    || token.starts_with("https://")
                    || token.contains(['=', '@', '`'])
                    || (token.contains('_')
                        && token.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'))
                {
                    continue;
                }
                let mut run = 0;
                for (cp, ch) in token.chars().chain(std::iter::once(' ')).enumerate() {
                    if ch.is_ascii_alphabetic() {
                        run += 1;
                    } else {
                        longest = longest.max(run);
                        if run >= 40 {
                            glued += run;
                            glue_spans
                                .push(span(base + word.start + cp - run, base + word.start + cp));
                        }
                        run = 0;
                    }
                }
            }
        }
        base += line.chars().count();
    }
    let blocked = glued >= 240 && glued * 100 >= characters * 15;
    result.push(Check {rule:"glued_prose",decision_rule:"glued_prose",category:"style",blocked,
        reason:"at least 240 letters in long alphabetic tokens occupy 15% of the message; restore word spacing".into(),
        measurements:json!({"long_run_letters":glued,"long_run_percent":percentage(glued,characters),"longest_prose_run":longest}),
        thresholds:json!({"minimum_run_letters":40,"minimum_total_letters":240,"minimum_percent":15,"operator":">="}),
        spans:if blocked {glue_spans} else {vec![]}});

    let mut counts = BTreeMap::new();
    for word in &all_words {
        *counts.entry(word.text).or_insert(0usize) += 1;
    }
    let dominant = counts
        .iter()
        .max_by_key(|(word, n)| (**n, std::cmp::Reverse(**word)));
    let (token, n) = dominant.map(|(w, n)| (*w, *n)).unwrap_or(("", 0));
    let blocked = all_words.len() >= 100 && n >= 80 && n * 100 >= all_words.len() * 80;
    result.push(Check {rule:"repeated_token",decision_rule:"repetition",category:"style",blocked,
        reason:"one token occupies at least 80% of 100 or more words".into(),
        measurements:json!({"words":all_words.len(),"most_frequent_count":n,"most_frequent_percent":percentage(n,all_words.len())}),
        thresholds:json!({"minimum_words":100,"minimum_count":80,"minimum_percent":80,"operator":">="}),
        spans:if blocked {all_words.iter().filter(|w|w.text==token).map(|w|span(w.start,w.end)).collect()} else {vec![]}});

    let mut lines = BTreeMap::new();
    for line in text
        .lines()
        .map(str::trim)
        .filter(|s| s.chars().count() >= 20)
    {
        *lines.entry(line).or_insert(0usize) += 1;
    }
    let dominant = lines
        .iter()
        .max_by_key(|(line, n)| (**n * line.chars().count(), std::cmp::Reverse(**line)));
    let (line, n) = dominant.map(|(l, n)| (*l, *n)).unwrap_or(("", 0));
    let repeated_characters = n * line.chars().count();
    let blocked = n >= 10 && repeated_characters * 100 >= characters * 80;
    let mut line_spans = Vec::new();
    if blocked {
        let mut cp = 0;
        for raw in text.split_inclusive('\n') {
            if raw.trim() == line {
                let left = raw.chars().take_while(|c| c.is_whitespace()).count();
                line_spans.push(span(cp + left, cp + left + line.chars().count()));
            }
            cp += raw.chars().count();
        }
    }
    result.push(Check {rule:"repeated_line",decision_rule:"repetition",category:"style",blocked,
        reason:"a line of at least 20 characters repeats 10 or more times and occupies 80% of the message".into(),
        measurements:json!({"dominant_line_count":n,"line_characters":line.chars().count(),"repeated_characters":repeated_characters,"message_percent":percentage(repeated_characters,characters)}),
        thresholds:json!({"minimum_line_characters":20,"minimum_count":10,"minimum_percent":80,"operator":">="}),spans:line_spans});
    result
}

pub fn inspect(text: &str) -> Value {
    let checks = checks(text, true);
    let mut report_checks: Vec<Value> = checks.iter().map(Check::value).collect();
    report_checks.extend(crate::style_signals::inspect(text));
    let first = checks.iter().find(|c| c.blocked);
    json!({"policy_version":POLICY_VERSION,"offset_unit":"unicode_scalar","blocked":first.is_some(),
        "decision_rule":first.map(|c|c.decision_rule),"checks":report_checks,"diagnostics_version":"style-signals-v1",
        "limitation":"No trigger is not a readability pass; technical-token exemptions and conservative thresholds deliberately miss less extreme shorthand."})
}
