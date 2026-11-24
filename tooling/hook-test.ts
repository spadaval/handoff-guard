/** Actual Codex interception against a loopback scripted provider, without remote calls. */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { once } from "node:events";
import { ROOT, checksum, invariant, parse } from "./shared.ts";
import type { SourceRecord } from "./capture.ts";
export async function hookTest(binary: string, scenario = "denied") {
  invariant(
    ["normal", "denied", "startup-error", "timeout", "exit-one"].includes(
      scenario,
    ),
    "Invalid scenario",
  );
  binary = resolve(binary);
  const home = mkdtempSync(join(tmpdir(), "handoff-hook-")),
    audit = join(home, "hook-events.jsonl"),
    wrapper = join(home, "audit-hook.mjs");
  const requests: SourceRecord[] = [];
  const commands = ["spawn_agent", "send_message", "followup_task"].map(
    (tool) => {
      const message =
        scenario === "denied"
          ? "['word'].join(' ').repeat(13001)"
          : "'Please return OK.'";
      let arg =
        tool === "spawn_agent"
          ? `{task_name:'fixture',message:${message}}`
          : `{target:'fixture',message:${message}}`;
      return `try { text(await tools.collaboration__${tool}(${arg})); } catch(e) { text(String(e)); }`;
    },
  );
  if (scenario === "denied")
    commands.splice(
      1,
      0,
      "text(await tools.collaboration__spawn_agent({task_name:'fixture',message:'Please return OK.'}));",
    );
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks),
        data = JSON.parse(
          (req.headers["content-encoding"] === "gzip"
            ? gunzipSync(raw)
            : raw
          ).toString(),
        );
      requests.push(data);
      const item =
        requests.length === 1
          ? {
              type: "custom_tool_call",
              id: "call_item",
              call_id: "call_guard",
              name: "exec",
              namespace: "functions",
              input: commands.join("\n"),
              status: "completed",
            }
          : {
              type: "message",
              id: "msg_ok",
              role: "assistant",
              content: [{ type: "output_text", text: "OK", annotations: [] }],
              status: "completed",
            };
      const events = [
        {
          type: "response.created",
          response: {
            id: `resp_${requests.length}`,
            object: "response",
            status: "in_progress",
            output: [],
          },
        },
        { type: "response.output_item.added", output_index: 0, item },
        { type: "response.output_item.done", output_index: 0, item },
        {
          type: "response.completed",
          response: {
            id: `resp_${requests.length}`,
            object: "response",
            status: "completed",
            output: [item],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          },
        },
      ];
      const payload = events
        .map(
          (e) => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n",
        )
        .join("");
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Content-Length": Buffer.byteLength(payload),
      });
      res.end(payload);
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    writeFileSync(
      wrapper,
      `import {readFileSync,appendFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';const input=readFileSync(0,'utf8');appendFileSync(${JSON.stringify(audit)},input+'\\n');const r=spawnSync(${JSON.stringify(binary)},[],{input,encoding:'utf8'});process.stdout.write(r.stdout??'');process.exit(r.status??1);`,
    );
    writeFileSync(
      join(home, "config.toml"),
      `model = "gpt-6.1-sol"\nmodel_provider = "fixture"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n[model_providers.fixture]\nname = "Local integration fixture"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n[features]\ncode_mode = true\ncode_mode_only = true\nmulti_agent_v2 = { enabled = true, non_code_mode_only = false }\nhooks = true\n`,
    );
    if (scenario === "timeout")
      writeFileSync(wrapper, "await new Promise(r=>setTimeout(r,3000));");
    if (scenario === "exit-one") writeFileSync(wrapper, "process.exit(1);");
    const config = parse<SourceRecord>(
        readFileSync(resolve(ROOT, "examples/hooks.json"), "utf8"),
      ),
      handler = config.hooks.PreToolUse[0].hooks[0],
      quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
    handler.command =
      scenario === "startup-error"
        ? "/does-not-exist-handoff-hook"
        : quote(process.execPath) + " " + quote(wrapper);
    handler.timeout = 1;
    writeFileSync(join(home, "hooks.json"), JSON.stringify(config));
    const child = spawn(
      "codex",
      [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--dangerously-bypass-hook-trust",
        "-C",
        home,
        "Run the local scripted hook integration fixture.",
      ],
      {
        env: { ...process.env, CODEX_HOME: home },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 45000,
      },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    const [code] = await once(child, "close");
    const events: SourceRecord[] = existsSync(audit)
        ? readFileSync(audit, "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((s) => JSON.parse(s))
        : [],
      target = events.filter((e) =>
        ["spawn_agent", "send_message", "followup_task"].some((t) =>
          e.tool_name.endsWith(t),
        ),
      );
    invariant(code === 0, "Codex fixture failed: " + stderr);
    const outputs = requests.flatMap((r) =>
        (r.input ?? []).filter((x: SourceRecord) =>
          x.type.endsWith("call_output"),
        ),
      ),
      output = JSON.stringify(outputs),
      delivered = JSON.stringify(
        requests.flatMap((r) =>
          (r.input ?? []).filter(
            (x: SourceRecord) => x.type === "agent_message",
          ),
        ),
      );
    if (scenario === "denied") {
      invariant(target.length === 4, "Expected four interceptions");
      for (const tool of ["spawn_agent", "send_message", "followup_task"])
        invariant(
          stderr.includes("Tool: collaboration" + tool),
          "Missing denial for " + tool,
        );
      invariant(
        output.split("Tool call blocked by PreToolUse hook:").length - 1 >= 3,
        "Resolved denial did not block",
      );
      invariant(
        !delivered.includes("wordwordwordwordword"),
        "Forbidden payload delivered",
      );
      invariant(
        output.includes("/root/fixture"),
        "Ordinary child was not delivered",
      );
    } else {
      invariant(
        !output.includes("Tool call blocked by PreToolUse hook:") &&
          output.includes("/root/fixture"),
        "Expected allowed delivery",
      );
      invariant(
        delivered.includes("Message Type: MESSAGE") &&
          delivered.includes("Message Type: NEW_TASK"),
        "Missing send/followup delivery",
      );
      invariant(
        !output.includes("TypeError") && !output.includes("not found"),
        "Tool dispatch failed",
      );
    }
    return {
      scenario,
      codex_exit: code,
      requests: requests.length,
      intercepted: target.map((e) => ({
        tool: e.tool_name,
        characters: Array.from(e.tool_input?.message ?? "").length,
      })),
      assertions_passed: true,
      binary_sha256: checksum(binary),
    };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(home, { recursive: true, force: true });
  }
}
