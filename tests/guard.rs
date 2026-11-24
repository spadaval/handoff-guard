use handoff_guard::{check, hook};
use serde_json::json;
use std::{
    io::Write,
    process::{Command, Stdio},
};

#[test]
fn ordinary_free_form_and_technical_content() {
    for text in [
        "ok",
        "Please check the diff.",
        "x",
        "# Review\n- A short fragment… yes!\n\n```rust\nlet x = 1;\n```",
        "https://example.org/a/b?q=1 /root/project/src/foo.rs abcdef0123456789",
    ] {
        assert_eq!(check(text), None, "{text}");
    }
    for token in [
        format!("/root/{}", "directory/".repeat(100)),
        format!("https://example.org/{}", "a".repeat(1000)),
        "a0123456789".repeat(100),
        format!("some_identifier_{}", "a".repeat(1000)),
    ] {
        assert_eq!(check(&token), None);
    }
}

#[test]
fn boundaries_unicode_and_pathology() {
    assert_eq!(check(&"界".repeat(12000)), None);
    assert_eq!(check(&"界".repeat(12001)).unwrap().0, "characters");
    let words = (0..1500)
        .map(|n| format!("w{n}"))
        .collect::<Vec<_>>()
        .join(" ");
    assert_eq!(check(&words), None);
    assert_eq!(check(&(words + " extra")).unwrap().0, "words");
    assert_eq!(check(&"check ".repeat(100)).unwrap().0, "repetition");
    assert_eq!(
        check(&"This line repeats verbatim.\n".repeat(10))
            .unwrap()
            .0,
        "repetition"
    );
    assert_eq!(
        check(&"Pleaseinspecttheimplementationandreporttheregression ".repeat(6))
            .unwrap()
            .0,
        "glued_prose"
    );
    assert_eq!(
        check("OneVeryLongIdentifierIsNotEnoughToJustifyBlockingOrdinaryWork"),
        None
    );
}

#[test]
fn resolved_tools_only_and_no_mutation() {
    for name in [
        "spawn_agent",
        "collaborationspawn_agent",
        "collaborationsend_message",
        "collaborationfollowup_task",
        "customnamespacefollowup_task",
        "functions.send_message",
        "mcp__service__followup_task",
    ] {
        let event = json!({"hook_event_name":"PreToolUse", "tool_name":name,"tool_input":{"message":"word ".repeat(1600)}});
        let before = event.clone();
        assert_eq!(
            hook(&event)["hookSpecificOutput"]["permissionDecision"],
            "deny"
        );
        assert_eq!(event, before);
    }
    assert_eq!(
        hook(
            &json!({"hook_event_name":"PreToolUse","tool_name":"functions.exec","tool_input":{"code":"await tools.spawn_agent({message: 'x'.repeat(99999)})"}})
        ),
        json!({})
    );
    assert_eq!(
        hook(
            &json!({"hook_event_name":"Stop","tool_name":"spawn_agent","tool_input":{"message":"x".repeat(12001)}})
        ),
        json!({})
    );
    assert!(hook(&json!({"hook_event_name":"PreToolUse","tool_name":"spawn_agent","tool_input":{"items":[{"type":"text","text":"x".repeat(7000)},{"type":"text","text":"y".repeat(7000)}]}}))["hookSpecificOutput"].is_object());
}

#[test]
fn compiled_hook_contract() {
    for (input, denied) in [(json!({"hook_event_name":"PreToolUse","tool_name":"spawn_agent","tool_input":{"message":"Review this."}}).to_string(), false),
        (json!({"hook_event_name":"PreToolUse","tool_name":"followup_task","tool_input":json!({"message":"z".repeat(12001)}).to_string()}).to_string(), true),
        ("broken json".into(), true)] {
        let mut child = Command::new(env!("CARGO_BIN_EXE_handoff-guard")).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
        child.stdin.take().unwrap().write_all(input.as_bytes()).unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success());
        let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(value["hookSpecificOutput"]["permissionDecision"] == "deny", denied);
        if denied { assert!(value.to_string().contains("Rewrite")); assert!(value.get("updatedInput").is_none()); }
    }
}

#[test]
fn punctuation_in_glued_sentences_does_not_exempt_the_paragraph() {
    let text = "Inspecttheimplementationandverifyallrequiredpublicbehaviors;restoreordinarywordspacingbeforetryingagain. ".repeat(5);
    assert_eq!(check(&text).unwrap().0, "glued_prose");
    assert_eq!(check(&format!("```text\n{text}\n```")), None);
}

#[test]
fn diagnostic_ranges_are_unicode_scalar_offsets_and_all_checks_are_reported() {
    let text = format!(
        "界😀\n{}",
        "Pleaseinspecttheimplementationandreporttheregression ".repeat(6)
    );
    let report = handoff_guard::inspect(&text);
    assert_eq!(report["offset_unit"], "unicode_scalar");
    assert_eq!(report["checks"].as_array().unwrap().len(), 7);
    assert_eq!(report["decision_rule"], check(&text).unwrap().0);
    let glued = &report["checks"][2];
    assert_eq!(glued["status"], "block");
    let chars: Vec<_> = text.chars().collect();
    for range in glued["spans"].as_array().unwrap() {
        let start = range["start"].as_u64().unwrap() as usize;
        let end = range["end"].as_u64().unwrap() as usize;
        assert_eq!(
            chars[start..end].iter().collect::<String>(),
            "Pleaseinspecttheimplementationandreporttheregression"
        );
    }
    assert_eq!(
        handoff_guard::inspect("Review done; CI pending.")["blocked"],
        false
    );
    assert_eq!(
        handoff_guard::inspect(&format!("```\n{text}\n```"))["checks"][2]["status"],
        "pass"
    );
}

#[test]
fn compiled_inspection_and_rule_precedence_match_the_hook() {
    let text = "repeat ".repeat(2000);
    let mut child = Command::new(env!("CARGO_BIN_EXE_handoff-guard"))
        .arg("inspect")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(format!("{}\n", json!({"message_id":"synthetic","text":text})).as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    let report: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["decision_rule"], "characters");
    assert_eq!(report["checks"][3]["status"], "block");
    assert_eq!(report["checks"][3]["spans"].as_array().unwrap().len(), 128);
    assert!(report["checks"][3]["omitted_spans"].as_u64().unwrap() > 0);
}

#[test]
fn advisory_style_checks_find_prose_without_blocking_delivery() {
    let text = "Please review,this change;then report blockers[] and scope+proof+status.";
    let report = handoff_guard::inspect(text);
    assert_eq!(check(text), None);
    assert_eq!(report["blocked"], false);
    for (rule, count) in [("punctuation_spacing", 2), ("needless_shorthand", 2)] {
        let check = report["checks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["rule"] == rule)
            .unwrap();
        assert_eq!(check["status"], "warn");
        assert_eq!(check["enforcement"], "advisory");
        assert_eq!(check["measurements"]["matches"], count);
        assert_eq!(check["thresholds"]["blocking"], false);
    }
    assert_eq!(
        hook(
            &json!({"hook_event_name":"PreToolUse","tool_name":"send_message","tool_input":{"message":text}})
        ),
        json!({})
    );
}

#[test]
fn advisory_checks_preserve_technical_syntax_and_quoted_examples() {
    for text in [
        "Review src/one,two.rs and https://example.org/a,b. Then run test:browser. Cite file:line.",
        "Use Config.User and status:error. The cases[] field is required.",
        "```python\nimport json,sys\nblockers[]\n```\nPlease review this.",
        "import json,sys,subprocess\nfrom pathlib import Path\nNo blockers.",
        "Use `blockers[]` in the example and quote \"scope+proof+status\" literally.",
        "Yes!!! Fine... Review done; CI pending. /root/example/file.rs a0123456789",
    ] {
        let report = handoff_guard::inspect(text);
        for check in report["checks"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| c["enforcement"] == "advisory")
        {
            assert_eq!(check["status"], "pass", "{text}: {check}");
        }
    }
}

#[test]
fn advisory_spans_remain_exact_after_unicode_and_masked_code() {
    let text = "界😀 `ignored,code` Please check,this and blockers[].";
    let report = handoff_guard::inspect(text);
    let chars: Vec<_> = text.chars().collect();
    let mut matches = vec![];
    for check in report["checks"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["enforcement"] == "advisory")
    {
        for span in check["spans"].as_array().unwrap() {
            matches.push(
                chars[span["start"].as_u64().unwrap() as usize
                    ..span["end"].as_u64().unwrap() as usize]
                    .iter()
                    .collect::<String>(),
            );
        }
    }
    assert_eq!(matches, vec![",".to_string(), "blockers[]".to_string()]);
}
