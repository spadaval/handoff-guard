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
import { ROOT, canonical, checksum, invariant, parse } from "./shared.ts";
import type { SourceRecord } from "./capture.ts";

export const SCENARIOS = [
  "denied",
  "normal",
  "startup-error",
  "timeout",
  "exit-one",
  "mcp",
];
const BLOCKED = "Tool call blocked by PreToolUse hook:";

/** A loopback Responses server. `respond(n, request)` returns the output items for the n-th request. */
export async function scriptedModel(
  respond: (n: number, request: SourceRecord) => SourceRecord[],
) {
  const requests: SourceRecord[] = [];
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
      const id = `resp_${requests.length}`,
        items = respond(requests.length, data);
      const events = [
        {
          type: "response.created",
          response: {
            id,
            object: "response",
            status: "in_progress",
            output: [],
          },
        },
        ...items.flatMap((item, output_index) => [
          { type: "response.output_item.added", output_index, item },
          { type: "response.output_item.done", output_index, item },
        ]),
        {
          type: "response.completed",
          response: {
            id,
            object: "response",
            status: "completed",
            output: items,
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
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    requests,
    port: (server.address() as { port: number }).port,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

const reply = {
  type: "message",
  id: "msg_ok",
  role: "assistant",
  content: [{ type: "output_text", text: "OK", annotations: [] }],
  status: "completed",
};
const execCall = (input: string) => ({
  type: "custom_tool_call",
  id: "call_item",
  call_id: "call_guard",
  name: "exec",
  namespace: "functions",
  input,
  status: "completed",
});

const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";

/** Writes a hook command that records each event it receives, then runs the guard. */
function auditWrapper(path: string, audit: string, binary: string) {
  writeFileSync(
    path,
    `import {readFileSync,appendFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';const input=readFileSync(0,'utf8');appendFileSync(${JSON.stringify(audit)},input+'\\n');const r=spawnSync(${JSON.stringify(binary)},[],{input,encoding:'utf8'});process.stdout.write(r.stdout??'');process.exit(r.status??1);`,
  );
}

const readJsonl = (path: string): SourceRecord[] =>
  existsSync(path)
    ? readFileSync(path, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((s) => JSON.parse(s))
    : [];

function providerConfig(model: string, port: number, features: string) {
  return `model = "${model}"\nmodel_provider = "fixture"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n[model_providers.fixture]\nname = "Local integration fixture"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n[features]\n${features}hooks = true\n`;
}

/** The example hooks.json with its command replaced. */
function hooksConfig(command: string, timeout?: number) {
  const config = parse<SourceRecord>(
      readFileSync(resolve(ROOT, "examples/hooks.json"), "utf8"),
    ),
    handler = config.hooks.PreToolUse[0].hooks[0];
  handler.command = command;
  if (timeout !== undefined) handler.timeout = timeout;
  return JSON.stringify(config);
}

async function runCodex(home: string) {
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
  return { code: code as number | null, stdout, stderr };
}

const callOutputs = (requests: SourceRecord[]): SourceRecord[] =>
  requests.flatMap((r) =>
    (r.input ?? []).filter((x: SourceRecord) => x.type.endsWith("call_output")),
  );

export async function hookTest(binary: string, scenario = "denied") {
  invariant(SCENARIOS.includes(scenario), "Invalid scenario");
  binary = resolve(binary);
  if (scenario === "mcp") return mcpTest(binary);
  const home = mkdtempSync(join(tmpdir(), "handoff-hook-")),
    audit = join(home, "hook-events.jsonl"),
    wrapper = join(home, "audit-hook.mjs");
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
  const model = await scriptedModel((n) =>
    n === 1 ? [execCall(commands.join("\n"))] : [reply],
  );
  const requests = model.requests;
  try {
    auditWrapper(wrapper, audit, binary);
    writeFileSync(
      join(home, "config.toml"),
      providerConfig(
        "gpt-6.1-sol",
        model.port,
        "code_mode = true\ncode_mode_only = true\nmulti_agent_v2 = { enabled = true, non_code_mode_only = false }\n",
      ),
    );
    if (scenario === "timeout")
      writeFileSync(wrapper, "await new Promise(r=>setTimeout(r,3000));");
    if (scenario === "exit-one") writeFileSync(wrapper, "process.exit(1);");
    writeFileSync(
      join(home, "hooks.json"),
      hooksConfig(
        scenario === "startup-error"
          ? "/does-not-exist-handoff-hook"
          : quote(process.execPath) + " " + quote(wrapper),
        1,
      ),
    );
    const { code, stderr } = await runCodex(home);
    const events = readJsonl(audit),
      target = events.filter((e) =>
        ["spawn_agent", "send_message", "followup_task"].some((t) =>
          e.tool_name.endsWith(t),
        ),
      );
    invariant(code === 0, "Codex fixture failed: " + stderr);
    const output = JSON.stringify(callOutputs(requests)),
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
        output.split(BLOCKED).length - 1 >= 3,
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
        !output.includes(BLOCKED) && output.includes("/root/fixture"),
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
    await model.close();
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * A stdio MCP server named `t3-code` with T3 Code's three handoff tools. It
 * records every `tools/call` it receives, so the test can tell whether a call
 * the hook denied still reached the server.
 */
function mcpServer(calls: string) {
  return `import {appendFileSync} from 'node:fs';import {createInterface} from 'node:readline';
const str=(description)=>({type:'string',description});
const tools=[
{name:'delegate_task',description:'Delegate a task to another agent.',inputSchema:{type:'object',properties:{task:str('What the other agent should do.')},required:['task']}},
{name:'t3_thread_send',description:'Send a message to an existing thread.',inputSchema:{type:'object',properties:{threadId:str('Thread id.'),message:str('Message text.')},required:['threadId','message']}},
{name:'t3_thread_launch',description:'Launch a new thread.',inputSchema:{type:'object',properties:{title:str('Thread title.'),message:str('Optional first message.')},required:['title']}}];
const send=(m)=>process.stdout.write(JSON.stringify(m)+'\\n');
createInterface({input:process.stdin}).on('line',(line)=>{
if(!line.trim())return;const m=JSON.parse(line);
if(m.method==='initialize')send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params?.protocolVersion??'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'t3-code',version:'0.0.0'}}});
else if(m.method==='tools/list')send({jsonrpc:'2.0',id:m.id,result:{tools}});
else if(m.method==='tools/call'){appendFileSync(${JSON.stringify(calls)},JSON.stringify({name:m.params.name,arguments:m.params.arguments})+'\\n');send({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'fixture received '+m.params.name}]}});}
else if(m.method==='ping')send({jsonrpc:'2.0',id:m.id,result:{}});
else if(m.id!==undefined)send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}});});
`;
}

/** Invented fixture calls. Every argument object is distinct, so each call can be traced. */
const LONG =
  "Please read the fixture notes before you reply to this request. ".repeat(
    200,
  );
const MCP_CALLS: { tool: string; args: SourceRecord; denied: boolean }[] = [
  {
    tool: "delegate_task",
    args: { task: "Please check the fixture greeting and reply with OK." },
    denied: false,
  },
  { tool: "delegate_task", args: { task: "Task one. " + LONG }, denied: true },
  {
    tool: "t3_thread_send",
    args: {
      threadId: "fixture-thread",
      message: "Please confirm that the fixture thread is idle.",
    },
    denied: false,
  },
  {
    tool: "t3_thread_send",
    args: { threadId: "fixture-thread", message: "Message two. " + LONG },
    denied: true,
  },
  {
    tool: "t3_thread_launch",
    args: {
      title: "Fixture launch with a message",
      message: "Please list the files in the fixture directory.",
    },
    denied: false,
  },
  {
    tool: "t3_thread_launch",
    args: { title: "Fixture launch without a message" },
    denied: false,
  },
  {
    tool: "t3_thread_launch",
    args: {
      title: "Fixture launch, too long",
      message: "Launch three. " + LONG,
    },
    denied: true,
  },
];

/**
 * Codex offers MCP tools to the model in one of two ways, chosen by model and
 * features: as nested `tools.mcp__t3_code__*` calls inside the code-mode `exec`
 * tool, or as ordinary function calls in a `mcp__t3_code` namespace. Run both.
 */
const MCP_PATHS = [
  {
    path: "code_mode",
    model: "gpt-6.1-sol",
    features: "code_mode = true\ncode_mode_only = true\n",
  },
  {
    path: "direct_function",
    model: "gpt-5.4",
    features: "code_mode = false\n",
  },
];

/** Function and namespace names the first request offered the model. */
function offeredTools(request: SourceRecord) {
  const names: string[] = [];
  const walk = (tools: SourceRecord[], prefix: string) => {
    for (const t of tools) {
      names.push(prefix + t.name);
      if (Array.isArray(t.tools)) walk(t.tools, t.name + ".");
    }
  };
  walk(request.tools ?? [], "");
  for (const item of request.input ?? [])
    if (item.type === "additional_tools") walk(item.tools ?? [], "");
  return names;
}

async function mcpTest(binary: string) {
  const paths = [];
  for (const p of MCP_PATHS) paths.push(await mcpPath(binary, p));
  return {
    scenario: "mcp",
    paths,
    assertions_passed: true,
    binary_sha256: checksum(binary),
  };
}

async function mcpPath(
  binary: string,
  { path, model: modelName, features }: (typeof MCP_PATHS)[number],
) {
  const home = mkdtempSync(join(tmpdir(), "handoff-hook-")),
    audit = join(home, "hook-events.jsonl"),
    wrapper = join(home, "audit-hook.mjs"),
    calls = join(home, "mcp-calls.jsonl"),
    serverScript = join(home, "t3-code-mcp.mjs");
  const code = path === "code_mode";
  const script = MCP_CALLS.map(
    (c, i) =>
      `try { text("call ${i}: " + JSON.stringify(await tools.mcp__t3_code__${c.tool}(${JSON.stringify(c.args)}))); } catch (e) { text("call ${i}: " + String(e)); }`,
  ).join("\n");
  const functionCalls = MCP_CALLS.map((c, i) => ({
    type: "function_call",
    id: `fc_${i}`,
    call_id: `call_${i}`,
    name: c.tool,
    namespace: "mcp__t3_code",
    arguments: JSON.stringify(c.args),
    status: "completed",
  }));
  const model = await scriptedModel((n) =>
    n > 1 ? [reply] : code ? [execCall(script)] : functionCalls,
  );
  try {
    auditWrapper(wrapper, audit, binary);
    writeFileSync(serverScript, mcpServer(calls));
    writeFileSync(
      join(home, "config.toml"),
      providerConfig(modelName, model.port, features) +
        `[mcp_servers.t3-code]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(serverScript)}]\nrequired = true\n`,
    );
    writeFileSync(
      join(home, "hooks.json"),
      hooksConfig(quote(process.execPath) + " " + quote(wrapper)),
    );
    const run = await runCodex(home);
    invariant(
      run.code === 0,
      `Codex MCP fixture (${path}) failed: ` + run.stderr,
    );
    const offered = offeredTools(model.requests[0] ?? {}),
      firstRequest = JSON.stringify(model.requests[0] ?? {});
    if (code)
      invariant(
        offered.includes("functions.exec") &&
          !offered.some((n) => n.startsWith("mcp__t3_code.")) &&
          firstRequest.includes("Deferred tool namespaces:\\n- mcp__t3_code"),
        "Expected MCP tools as deferred code-mode tools",
      );
    else
      invariant(
        !offered.includes("functions.exec") &&
          MCP_CALLS.every((c) => offered.includes("mcp__t3_code." + c.tool)),
        "Expected MCP tools as direct function tools",
      );
    const events = readJsonl(audit).filter((e) =>
        String(e.tool_name).startsWith("mcp__"),
      ),
      received = readJsonl(calls),
      outputs = callOutputs(model.requests);
    // What the model was sent back for call i.
    const sentBack = (i: number): string => {
      if (!code)
        return JSON.stringify(
          outputs.find((o) => o.call_id === `call_${i}`)?.output ?? "",
        );
      const texts: string[] = outputs.flatMap((o) =>
        (Array.isArray(o.output) ? o.output : []).map((x: SourceRecord) =>
          String(x.text ?? ""),
        ),
      );
      return texts.find((t) => t.startsWith(`call ${i}: `)) ?? "";
    };
    invariant(
      events.length === MCP_CALLS.length,
      `Expected ${MCP_CALLS.length} MCP hook events on ${path}, saw ${events.length}`,
    );
    const results = MCP_CALLS.map((c, i) => {
      const key = canonical(c.args),
        event = events.find((e) => canonical(e.tool_input) === key),
        reached = received.some(
          (r) => r.name === c.tool && canonical(r.arguments) === key,
        ),
        back = sentBack(i),
        label = `${path} call ${i} (${c.tool})`;
      invariant(event, `No hook event for ${label}`);
      invariant(
        event.tool_name === `mcp__t3_code__${c.tool}`,
        `Unexpected tool_name ${event.tool_name} for ${label}`,
      );
      invariant(
        typeof event.tool_input === "object" &&
          !Array.isArray(event.tool_input),
        `tool_input is not an object for ${label}`,
      );
      invariant(
        reached === !c.denied,
        `${label} reached the server: ${reached}`,
      );
      invariant(
        c.denied
          ? back.includes(BLOCKED) && back.includes("Handoff Guard blocked")
          : back.includes("fixture received " + c.tool) &&
              !back.includes(BLOCKED),
        `Unexpected result sent back for ${label}: ${back.slice(0, 300)}`,
      );
      return {
        tool: c.tool,
        expected: c.denied ? "deny" : "allow",
        hook_tool_name: event.tool_name,
        hook_input_keys: Object.keys(event.tool_input).sort(),
        characters: Array.from(
          String(event.tool_input.task ?? event.tool_input.message ?? ""),
        ).length,
        reached_server: reached,
        model_saw: back.includes(BLOCKED) ? "blocked" : "server result",
      };
    });
    invariant(
      received.length === MCP_CALLS.filter((c) => !c.denied).length,
      `Unexpected MCP server calls on ${path}`,
    );
    return {
      path,
      model: modelName,
      offered_as: code
        ? "deferred tools.mcp__t3_code__* inside exec"
        : "functions in namespace mcp__t3_code",
      codex_exit: run.code,
      requests: model.requests.length,
      hook_events: events.length,
      server_calls: received.length,
      calls: results,
    };
  } finally {
    await model.close();
    rmSync(home, { recursive: true, force: true });
  }
}
