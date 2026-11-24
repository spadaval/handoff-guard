/**
 * Highlights over the exact message text.
 *
 * Hook spans arrive as zero-based Unicode scalar offsets (end exclusive);
 * reviewer quotes are exact substrings. Both become UTF-16 ranges here, then
 * the text is cut into per-line segments that carry the marks covering them.
 */
import type { HookReport, Review } from "./api.ts";

export type MarkKind = "hook" | "reviewer";
export interface Mark {
  id: string;
  kind: MarkKind;
  start: number;
  end: number;
  label: string;
  detail: string;
  status?: string;
  cite: string;
  line: number;
}
export interface Segment {
  text: string;
  marks: string[];
  first: string[];
}
export interface Line {
  number: number;
  segments: Segment[];
}
export interface Unplaced {
  kind: MarkKind;
  label: string;
  quote: string;
}

/** Map each scalar offset to its UTF-16 index. */
function scalarIndex(text: string) {
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    map.push(i);
    i += ch.length;
  }
  map.push(i);
  return map;
}

export function locate(text: string) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return (index: number) => {
    let lo = 0,
      hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    const column = Array.from(text.slice(starts[lo], index)).length + 1;
    return { line: lo + 1, column };
  };
}

export function buildMarks(text: string, hook: HookReport | null, review: Review | null) {
  const scalars = scalarIndex(text);
  const where = locate(text);
  const marks: Mark[] = [];
  const unplaced: Unplaced[] = [];
  const add = (m: Omit<Mark, "cite" | "line">) => {
    const at = where(m.start);
    marks.push({ ...m, cite: `L${at.line}:${at.column}`, line: at.line });
  };
  (hook?.checks ?? []).forEach((check, c) => {
    (check.spans ?? []).forEach((span, i) => {
      const s = scalars[Math.max(0, Math.min(span.start, scalars.length - 1))];
      const e = scalars[Math.max(0, Math.min(span.end, scalars.length - 1))];
      if (e <= s) return;
      add({
        id: `h-${c}-${i}`,
        kind: "hook",
        start: s,
        end: e,
        label: check.rule,
        detail: check.status,
        status: check.status,
      });
    });
  });
  if (review) {
    for (const dim of ["intent", "content", "presentation"] as const) {
      (review[dim]?.issues ?? []).forEach((issue, i) => {
        if (!issue.quote) return;
        const at = text.indexOf(issue.quote);
        if (at < 0) {
          unplaced.push({ kind: "reviewer", label: issue.kind, quote: issue.quote });
          return;
        }
        add({
          id: `r-${dim}-${i}`,
          kind: "reviewer",
          start: at,
          end: at + issue.quote.length,
          label: issue.kind,
          detail: dim,
        });
      });
    }
    if (review.rewrite?.of) {
      const at = text.indexOf(review.rewrite.of);
      if (at >= 0) {
        const p = where(at);
        marks.push({
          id: "rewrite-of",
          kind: "reviewer",
          start: at,
          end: at + review.rewrite.of.length,
          label: "rewritten passage",
          detail: "rewrite",
          cite: `L${p.line}:${p.column}`,
          line: p.line,
        });
      }
    }
  }
  marks.sort((a, b) => a.start - b.start || b.end - a.end);
  return { marks, unplaced, lines: segment(text, marks.filter((m) => m.id !== "rewrite-of")) };
}

function segment(text: string, marks: Mark[]): Line[] {
  const cuts = new Set<number>([0, text.length]);
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") cuts.add(i), cuts.add(i + 1);
  for (const m of marks) cuts.add(m.start), cuts.add(m.end);
  const points = [...cuts].sort((a, b) => a - b);
  const lines: Line[] = [{ number: 1, segments: [] }];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1];
    const piece = text.slice(a, b);
    if (piece === "\n") {
      lines.push({ number: lines.length + 1, segments: [] });
      continue;
    }
    const covering = marks.filter((m) => m.start <= a && m.end >= b);
    lines.at(-1)!.segments.push({
      text: piece,
      marks: covering.map((m) => m.id),
      first: covering.filter((m) => m.start === a).map((m) => m.id),
    });
  }
  return lines;
}

/** Characters and words, counted the way a reader would. */
export function measure(text: string) {
  return {
    characters: Array.from(text).length,
    words: text.split(/\s+/).filter(Boolean).length,
  };
}
