use crate::MAX_CHARACTERS;
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub const POLICY_VERSION: &str = "plain-english-v2";
const MAX_SPANS: usize = 128;
/// No ordinary English word is this long, so a longer letter run is several words fused.
const FUSED_RUN_LETTERS: usize = 20;
/// One long run can be an identifier. Two or more is a habit.
const FUSED_RUNS: usize = 2;
const SPACING_MIN_WORDS: usize = 20;
const SPACING_MEAN_CHARACTERS: f64 = 9.0;
const EXAMPLES: usize = 3;
const EXAMPLE_CHARACTERS: usize = 60;

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

const SIZE_FIX: &str = "Do not paste what the recipient can open. Point to the file, command or record, and leave out history the recipient does not need.";
const REPETITION_FIX: &str = "Say it once.";

fn excerpts(chars: &[char], ranges: &[(usize, usize)]) -> Vec<String> {
    ranges
        .iter()
        .take(EXAMPLES)
        .map(|&(s, e)| {
            let mut text: String = chars[s..e.min(s + EXAMPLE_CHARACTERS)].iter().collect();
            if e - s > EXAMPLE_CHARACTERS {
                text.push('…');
            }
            text
        })
        .collect()
}

fn starts_with(token: &[char], prefix: &str) -> bool {
    let mut it = token.iter();
    prefix.chars().all(|p| it.next() == Some(&p))
}

/// A path, URL, Markdown link or snake_case identifier is literal syntax, not prose.
fn literal(token: &[char]) -> bool {
    let lead = token
        .iter()
        .take_while(|c| matches!(c, '(' | '[' | '{' | '<' | '"' | '\'' | '*'))
        .count();
    let body = &token[lead..];
    if ["/", "./", "../", "~/", "http://", "https://"]
        .iter()
        .any(|p| starts_with(body, p))
    {
        return true;
    }
    if token.windows(2).any(|w| w == [']', '(']) {
        return true;
    }
    if token.contains(&'_') && token.iter().all(char::is_ascii) {
        return true;
    }
    // A relative path: has a slash and ends in a file extension.
    let trimmed = {
        let cut = token
            .iter()
            .rev()
            .take_while(|c| !c.is_ascii_alphanumeric())
            .count();
        &token[..token.len() - cut]
    };
    let extension = trimmed
        .iter()
        .rev()
        .take_while(|c| c.is_ascii_alphanumeric())
        .count();
    token.contains(&'/')
        && (1..=5).contains(&extension)
        && trimmed.len() > extension
        && trimmed[trimmed.len() - extension - 1] == '.'
}

/// Whitespace-separated words of prose, as scalar ranges. Closed fenced blocks,
/// closed inline code spans and literal tokens are left out. An unclosed fence
/// or backtick hides nothing, so it cannot be used to skip the checks.
fn prose_tokens(chars: &[char]) -> Vec<(usize, usize)> {
    let mut lines: Vec<(usize, usize)> = Vec::new();
    let mut start = 0;
    for (i, c) in chars.iter().enumerate() {
        if *c == '\n' {
            lines.push((start, i));
            start = i + 1;
        }
    }
    lines.push((start, chars.len()));
    let fences: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter(|&(_, &(s, e))| {
            let line = &chars[s..e];
            let indent = line.iter().take_while(|c| c.is_whitespace()).count();
            starts_with(&line[indent..], "```") || starts_with(&line[indent..], "~~~")
        })
        .map(|(n, _)| n)
        .collect();
    let mut code = vec![false; lines.len()];
    for pair in fences.chunks_exact(2) {
        for flag in &mut code[pair[0]..=pair[1]] {
            *flag = true;
        }
    }
    let mut tokens = Vec::new();
    for (n, &(s, e)) in lines.iter().enumerate() {
        if code[n] {
            continue;
        }
        let mut masked = vec![false; e - s];
        let mut i = s;
        while i < e {
            if chars[i] == '`' {
                if let Some(close) = (i + 1..e).find(|&j| chars[j] == '`') {
                    for flag in &mut masked[i - s..=close - s] {
                        *flag = true;
                    }
                    i = close + 1;
                    continue;
                }
            }
            i += 1;
        }
        let mut token_start = None;
        for i in s..=e {
            let inside = i < e && !masked[i - s] && !chars[i].is_whitespace();
            match (inside, token_start) {
                (true, None) => token_start = Some(i),
                (false, Some(t)) => {
                    if !literal(&chars[t..i]) {
                        tokens.push((t, i));
                    }
                    token_start = None;
                }
                _ => {}
            }
        }
    }
    tokens
}

pub struct Check {
    pub rule: &'static str,
    pub decision_rule: &'static str,
    pub category: &'static str,
    pub blocked: bool,
    pub reason: String,
    /// What the sender should do about it.
    pub fix: &'static str,
    /// Short excerpts of the offending text. Shown to the sender only, never stored.
    pub examples: Vec<String>,
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
        reason: format!("{characters} characters is over the limit of {MAX_CHARACTERS}"),
        fix: SIZE_FIX,
        examples: vec![],
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
    let mut result = vec![character_check];
    let chars: Vec<char> = text.chars().collect();
    let tokens = prose_tokens(&chars);

    // Fused words: letter runs longer than any ordinary English word.
    let mut runs: Vec<(usize, usize)> = Vec::new();
    let mut longest = 0;
    for &(start, end) in &tokens {
        let mut run_start = None;
        for i in start..=end {
            let letter = i < end && chars[i].is_ascii_alphabetic();
            match (letter, run_start) {
                (true, None) => run_start = Some(i),
                (false, Some(s)) => {
                    longest = longest.max(i - s);
                    if i - s >= FUSED_RUN_LETTERS {
                        runs.push((s, i));
                    }
                    run_start = None;
                }
                _ => {}
            }
        }
    }
    let blocked = runs.len() >= FUSED_RUNS;
    result.push(Check {
        rule: "fused_words",
        decision_rule: "fused_words",
        category: "style",
        blocked,
        reason: format!(
            "{} stretches of {FUSED_RUN_LETTERS} or more letters have no spaces in them (the longest is {longest} letters), so words are run together",
            runs.len()
        ),
        fix: "Put a space between every word and say the same thing in full sentences. Do not make it terser.",
        examples: excerpts(&chars, &runs),
        measurements: json!({"long_runs":runs.len(),"longest_run":longest}),
        thresholds: json!({"run_letters":FUSED_RUN_LETTERS,"minimum_runs":FUSED_RUNS,"operator":">="}),
        spans: runs.iter().map(|&(s, e)| span(s, e)).collect(),
    });

    // Missing spaces: ordinary prose averages five to seven characters per word.
    let ascii: Vec<(usize, usize)> = tokens
        .iter()
        .copied()
        .filter(|&(s, e)| chars[s..e].iter().all(char::is_ascii))
        .collect();
    let total: usize = ascii.iter().map(|&(s, e)| e - s).sum();
    let mean = if ascii.is_empty() {
        0.0
    } else {
        total as f64 / ascii.len() as f64
    };
    let blocked = ascii.len() >= SPACING_MIN_WORDS && mean >= SPACING_MEAN_CHARACTERS;
    let mut long_tokens: Vec<(usize, usize)> = ascii
        .iter()
        .copied()
        .filter(|&(s, e)| e - s >= FUSED_RUN_LETTERS)
        .collect();
    let spans = long_tokens.iter().map(|&(s, e)| span(s, e)).collect();
    long_tokens.sort_by_key(|&(s, e)| (std::cmp::Reverse(e - s), s));
    result.push(Check {
        rule: "missing_spaces",
        decision_rule: "missing_spaces",
        category: "style",
        blocked,
        reason: format!(
            "words average {mean:.1} characters where ordinary prose averages 5 to 7, so spaces are missing or punctuation is standing in for them"
        ),
        fix: "Write each clause as a sentence with spaces between the words. Do not join words with slashes, commas or plus signs, and do not make it terser.",
        examples: excerpts(&chars, &long_tokens),
        measurements: json!({"prose_words":ascii.len(),"mean_word_characters":(mean * 10.0).round() / 10.0}),
        thresholds: json!({"minimum_words":SPACING_MIN_WORDS,"mean_word_characters":SPACING_MEAN_CHARACTERS,"operator":">="}),
        spans: if blocked { spans } else { vec![] },
    });

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
        reason:"one word makes up at least 80% of the message".into(),
        fix: REPETITION_FIX,
        examples: vec![],
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
        reason:"one line repeats 10 or more times and makes up at least 80% of the message".into(),
        fix: REPETITION_FIX,
        examples: vec![],
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
        "limitation":"A message the checks allow is not thereby readable. They measure spacing, size and repetition, and miss shorthand that keeps its spaces."})
}
