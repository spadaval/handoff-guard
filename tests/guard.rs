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
    assert_eq!(check(&"界".repeat(8000)), None);
    assert_eq!(check(&"界".repeat(8001)).unwrap().0, "characters");
    // Size is measured in characters only; many short words are fine.
    let words = (0..1900)
        .map(|n| format!("w{}", n % 10))
        .collect::<Vec<_>>()
        .join(" ");
    assert_eq!(check(&words), None);
    assert_eq!(check(&"check ".repeat(100)).unwrap().0, "repetition");
    assert_eq!(
        check(&"This line repeats verbatim.\n".repeat(10))
            .unwrap()
            .0,
        "repetition"
    );
    assert_eq!(
        check("Pleaseinspecttheimplementationandreporttheregression thenreportwhatyoufoundtothecoordinator")
            .unwrap()
            .0,
        "fused_words"
    );
    // A long real word or one identifier may repeat; it is still one stretch.
    assert_eq!(
        check("Please check internationalization before release. The internationalization tests must pass."),
        None
    );
    assert_eq!(
        check(&"Pleaseinspecttheimplementationandreporttheregression ".repeat(2)),
        None
    );
    // One long run can be an identifier; it takes two to block.
    assert_eq!(
        check("Call OneVeryLongIdentifierIsNotEnoughToJustifyBlockingOrdinaryWork next."),
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
        let event = json!({"hook_event_name":"PreToolUse", "tool_name":name,"tool_input":{"message":"A plain sentence of ordinary words. ".repeat(250)}});
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
            &json!({"hook_event_name":"Stop","tool_name":"spawn_agent","tool_input":{"message":"x".repeat(8001)}})
        ),
        json!({})
    );
    assert!(hook(&json!({"hook_event_name":"PreToolUse","tool_name":"spawn_agent","tool_input":{"items":[{"type":"text","text":"x".repeat(7000)},{"type":"text","text":"y".repeat(7000)}]}}))["hookSpecificOutput"].is_object());
}

#[test]
fn compiled_hook_contract() {
    for (input, denied) in [(json!({"hook_event_name":"PreToolUse","tool_name":"spawn_agent","tool_input":{"message":"Review this."}}).to_string(), false),
        (json!({"hook_event_name":"PreToolUse","tool_name":"followup_task","tool_input":json!({"message":"z".repeat(8001)}).to_string()}).to_string(), true),
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
    // A fence closes only on its own marker, and an underscore or a stray
    // typographic mark does not turn prose into an identifier.
    assert_eq!(check(&format!("```\n{text}\n~~~")).unwrap().0, "fused_words");
    assert_eq!(check(&format!("````\n```\n{text}\n```\n````")), None);
    assert_eq!(check(&format!("``{}``", text.trim())), None);
    assert_eq!(check(&text.replace(". ", ".,_ ")).unwrap().0, "fused_words");
    assert_eq!(check(&text).unwrap().0, "fused_words");
    assert_eq!(check(&format!("```text\n{text}\n```")), None);
    // An unclosed fence or backtick hides nothing.
    assert_eq!(check(&format!("```\n{text}")).unwrap().0, "fused_words");
    assert_eq!(check(&format!("`{text}")).unwrap().0, "fused_words");
    assert_eq!(check(&text.replace(' ', "= ")).unwrap().0, "fused_words");
}

#[test]
fn diagnostic_ranges_are_unicode_scalar_offsets_and_all_checks_are_reported() {
    let text = format!(
        "界😀\n{}thenreportwhatyoufoundtothecoordinator",
        "Pleaseinspecttheimplementationandreporttheregression ".repeat(5)
    );
    let report = handoff_guard::inspect(&text);
    assert_eq!(report["offset_unit"], "unicode_scalar");
    assert_eq!(report["checks"].as_array().unwrap().len(), 7);
    assert_eq!(report["decision_rule"], check(&text).unwrap().0);
    let glued = &report["checks"][1];
    assert_eq!(glued["status"], "block");
    let chars: Vec<_> = text.chars().collect();
    assert_eq!(glued["spans"].as_array().unwrap().len(), 6);
    for range in glued["spans"].as_array().unwrap() {
        let start = range["start"].as_u64().unwrap() as usize;
        let end = range["end"].as_u64().unwrap() as usize;
        let run = chars[start..end].iter().collect::<String>();
        assert!(
            run == "Pleaseinspecttheimplementationandreporttheregression"
                || run == "thenreportwhatyoufoundtothecoordinator",
            "{run}"
        );
    }
    assert_eq!(
        handoff_guard::inspect("Review done; CI pending.")["blocked"],
        false
    );
    assert_eq!(
        handoff_guard::inspect(&format!("```\n{text}\n```"))["checks"][1]["status"],
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
    let event = json!({"hook_event_name":"PreToolUse","tool_name":"spawn_agent","tool_input":{"message":text}});
    assert!(
        hook(&event)["hookSpecificOutput"]["permissionDecisionReason"]
            .as_str()
            .unwrap()
            .contains("[characters]")
    );
    let repeated = report["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["rule"] == "repeated_token")
        .unwrap();
    assert_eq!(repeated["status"], "block");
    assert_eq!(repeated["spans"].as_array().unwrap().len(), 128);
    assert!(repeated["omitted_spans"].as_u64().unwrap() > 0);
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

#[test]
fn missing_spaces_blocks_words_joined_by_punctuation() {
    // Every letter run is short, so only the average word length gives it away.
    let fused = "Checked/built/tested,allgreen;merge+deploy/after-review.Next:cleanup/release ".repeat(20);
    assert_eq!(check(&fused).unwrap().0, "missing_spaces");
    // Paths, links, identifiers and code are literal syntax and do not count.
    let literal = "Read `src/tooling/db/connection.ts` and ./docs/context-database.md then \
        [the guide](/root/project/docs/a-very-long-file-name-for-a-guide.md) and \
        crates/handoff-guard/src/diagnostics.rs plus some_long_snake_case_identifier_name. "
        .repeat(8);
    assert_eq!(check(&literal), None);
    // Typographic punctuation does not switch the check off.
    assert_eq!(check(&fused.replace(' ', "’ ")).unwrap().0, "missing_spaces");
    // Hashes and UUIDs are literal values.
    let hashes = (0..20)
        .map(|n| format!("{n:02}a1b2c3d4e5f60718293a4b5c6d7e8f90123456"))
        .collect::<Vec<_>>()
        .join(" ");
    assert_eq!(check(&format!("Please inspect these commits: {hashes}")), None);
    // Too few words to judge.
    assert_eq!(check("Checked/built/tested,allgreen;merge+deploy/after-review."), None);
    // Text without spaces between words in other scripts is left alone.
    assert_eq!(check(&"これは日本語の文章です。 ".repeat(40)), None);
}

#[test]
fn denial_shows_the_offending_text_and_the_rules() {
    let text = "Pleaseinspecttheimplementationandreporttheregression then stop. Afterwardsreportwhatyoufoundtothecoordinator. ".repeat(2);
    let event = json!({"hook_event_name":"PreToolUse","tool_name":"spawn_agent","tool_input":{"message":text}});
    let reason = hook(&event)["hookSpecificOutput"]["permissionDecisionReason"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(reason.contains("[fused_words]"), "{reason}");
    assert!(reason.contains("“Pleaseinspecttheimplementationandreporttheregression”"));
    assert!(reason.contains("Put a space between every word"));
    assert!(reason.contains("plain English"));
    assert!(reason.contains("nothing was sent"));
    // Offline evaluation never echoes message text.
    assert!(!check(&text).unwrap().1.contains("Pleaseinspect"));
    let long = "x".repeat(200) + " " + &"y".repeat(200);
    let event = json!({"hook_event_name":"PreToolUse","tool_name":"spawn_agent","tool_input":{"message":long}});
    let reason = hook(&event)["hookSpecificOutput"]["permissionDecisionReason"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(reason.contains(&("x".repeat(60) + "…")) && !reason.contains(&"x".repeat(61)));
}

#[test]
fn t3_delegation_tools_and_every_text_field_are_checked() {
    let long = "word ".repeat(2600);
    for (name, input) in [
        ("mcp__t3-code__delegate_task", json!({"task": long})),
        ("t3-code.t3_thread_send", json!({"threadId":"t","message": long})),
        ("mcp__t3_code_direct__t3_thread_launch", json!({"title":"t","message": long})),
        ("multi_agent_v1.send_input", json!({"message": long})),
        ("spawn_agent", json!({"message":"ok","items":[{"type":"text","text": long}]})),
        ("spawn_agent", json!({"message":"ok","prompt": long})),
    ] {
        let event = json!({"hook_event_name":"PreToolUse","tool_name":name,"tool_input":input});
        assert_eq!(
            hook(&event)["hookSpecificOutput"]["permissionDecision"],
            "deny",
            "{name}"
        );
    }
    // Launching an idle thread has no message and is allowed.
    assert_eq!(
        hook(&json!({"hook_event_name":"PreToolUse","tool_name":"t3_thread_launch","tool_input":{"title":"idle"}})),
        json!({})
    );
    assert_eq!(
        hook(&json!({"hook_event_name":"PreToolUse","tool_name":"delegate_task","tool_input":{"title":"no task"}}))
            ["hookSpecificOutput"]["permissionDecision"],
        "deny"
    );
    assert_eq!(
        hook(&json!({"hook_event_name":"PreToolUse","tool_name":"t3_thread_read","tool_input":{"message": long}})),
        json!({})
    );
}

/// The events Codex 0.171.0 sent for a `t3-code` stdio MCP server, in code mode
/// and as direct function calls alike: the server name is normalized to
/// `t3_code` and `tool_input` is the argument object, not a JSON string.
#[test]
fn codex_mcp_events_for_t3_code_tools() {
    let long = "Please read the fixture notes first. ".repeat(250);
    let event = |tool: &str, input: serde_json::Value| {
        json!({
            "session_id": "fixture-session",
            "turn_id": "fixture-turn",
            "transcript_path": "/tmp/fixture/rollout.jsonl",
            "cwd": "/tmp/fixture",
            "hook_event_name": "PreToolUse",
            "model": "gpt-6.1-sol",
            "permission_mode": "bypassPermissions",
            "tool_name": format!("mcp__t3_code__{tool}"),
            "tool_input": input,
            "tool_use_id": "exec-fixture",
        })
    };
    for (tool, allowed, denied) in [
        (
            "delegate_task",
            json!({"task": "Please check the fixture greeting and reply with OK."}),
            json!({"task": long}),
        ),
        (
            "t3_thread_send",
            json!({"threadId": "fixture-thread", "message": "Please confirm the thread is idle."}),
            json!({"threadId": "fixture-thread", "message": long}),
        ),
        (
            "t3_thread_launch",
            json!({"title": "Fixture launch", "message": "Please list the fixture files."}),
            json!({"title": "Fixture launch", "message": long}),
        ),
        (
            "t3_thread_launch",
            json!({"title": "Fixture launch without a message"}),
            json!({"title": "Fixture launch", "message": long}),
        ),
    ] {
        assert_eq!(hook(&event(tool, allowed)), json!({}), "{tool} allowed");
        assert_eq!(
            hook(&event(tool, denied))["hookSpecificOutput"]["permissionDecision"],
            "deny",
            "{tool} denied"
        );
    }
}
