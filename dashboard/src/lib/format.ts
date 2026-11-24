import type { Proportion } from "./api.ts";

const int = new Intl.NumberFormat("en-GB");
export const n = (v: number | null | undefined) => (v === null || v === undefined ? "–" : int.format(v));
export function pct(p: number | null | undefined, digits = 0) {
  if (p === null || p === undefined || Number.isNaN(p)) return "–";
  return (p * 100).toFixed(digits) + "%";
}
/** "42–67%" */
export function ci(x: Proportion | { k: number; n: number; p: number } | null) {
  if (!x || !("low" in x) || x.low === undefined || x.high === undefined) return "";
  return `${Math.round(x.low * 100)}–${Math.round(x.high * 100)}%`;
}
export const docket = (id: string) => id.slice(0, 8);
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function month(key: string | null | undefined, long = false) {
  if (!key || key === "unknown") return "Unknown";
  const [y, m] = key.split("-").map(Number);
  return long ? `${months[m - 1]} ${y}` : `${months[m - 1]} ’${String(y).slice(2)}`;
}
export function date(iso: string | null | undefined) {
  if (!iso) return "Unknown";
  const d = new Date(iso);
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}
export function time(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
export const SCORE_NAMES: Record<string, string> = { "4": "Clean", "3": "Minor", "2": "Costly", "1": "Broken", null: "Unknown" };
/** How a sampled message was picked. Worded so it cannot be read as a hook check or an issue kind. */
export const PICKED_NAMES: Record<string, string> = {
  random: "Picked at random",
  fused: "Picked for long letter runs",
  long: "Picked for length",
  pilot: "Earlier pilot set",
};
export const SAMPLE_NAMES: Record<string, string> = { fair: "Fair sample", all: "All reviewed" };
export const CLEAR_VERSION = "Clear version";
export const DIMENSION_NAMES: Record<string, string> = { intent: "Intent", content: "Content", presentation: "Presentation" };
export const humanise = (s: string) => s.replace(/_/g, " ");
export function plural(count: number, one: string, many = one + "s") {
  return `${n(count)} ${count === 1 ? one : many}`;
}
