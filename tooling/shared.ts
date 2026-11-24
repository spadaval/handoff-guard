import { createHash } from "node:crypto";
import { readFileSync, openSync, readSync, closeSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const DATABASE = resolve(ROOT, "data/handoffs.sqlite3");
export const INPUT_KINDS = new Set([
  "assignment",
  "agent_message",
  "followup_assignment",
  "cached_agent_message",
  "agent_delivery",
]);
export type Data = Record<string, unknown>;
export const object = (v: unknown): Data =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Data) : {};
export const str = (v: unknown): string => (typeof v === "string" ? v : "");
export const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export function parse<T = Data>(s: string): T {
  return JSON.parse(s) as T;
}
export function canonical(v: unknown): string {
  if (Array.isArray(v))
    return "[" + v.map((x) => canonical(x)).join(", ") + "]";
  if (v !== null && typeof v === "object")
    return (
      "{" +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ": " + canonical((v as Data)[k]))
        .join(", ") +
      "}"
    );
  return JSON.stringify(v) ?? "null";
}
export const digest = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
export function checksum(path: string) {
  return digest(readFileSync(path));
}
export const decode = (raw: Uint8Array) =>
  new TextDecoder("utf-8", { fatal: true }).decode(raw);
export const now = () => new Date().toISOString();
export const chars = (s: string) => Array.from(s).length;
export const cut = (s: string, n: number) => Array.from(s).slice(0, n).join("");
export const words = (s: string) =>
  s
    .split(
      /[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/u,
    )
    .filter(Boolean).length;
export function* lines(
  path: string,
  limit = Infinity,
): Generator<{ line: number; raw: Buffer }> {
  const fd = openSync(path, "r");
  let pending = Buffer.alloc(0),
    offset = 0,
    n = 0;
  try {
    const maximum = Math.min(statSync(path).size, limit);
    while (offset < maximum) {
      const chunk = Buffer.alloc(Math.min(65536, maximum - offset));
      const bytes = readSync(fd, chunk);
      if (!bytes) break;
      offset += bytes;
      pending = Buffer.concat([pending, chunk.subarray(0, bytes)]);
      let end: number;
      while ((end = pending.indexOf(10)) !== -1) {
        yield { line: ++n, raw: pending.subarray(0, end + 1) };
        pending = pending.subarray(end + 1);
      }
    }
    if (pending.length) yield { line: ++n, raw: pending };
  } finally {
    closeSync(fd);
  }
}
export function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export const count = (rows: Iterable<string>) => {
  const out: Record<string, number> = {};
  for (const key of rows) out[key] = (out[key] ?? 0) + 1;
  return out;
};
