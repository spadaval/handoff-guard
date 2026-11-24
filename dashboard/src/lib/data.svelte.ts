import { get, type Meta } from "./api.ts";

/**
 * Corpus metadata shared by every view. `version` bumps when the reader asks
 * for fresh data; views refetch on it. A background check notices new reviews
 * and offers a reload instead of changing figures under the reader.
 */
export const data = $state({
  meta: null as Meta | null,
  error: null as string | null,
  version: 0,
  pending: null as { reviewed: number; loaded_at: string } | null,
});

export async function reload() {
  try {
    data.meta = await get<Meta>("/meta");
    data.error = null;
    data.pending = null;
    data.version++;
  } catch (e) {
    data.error = e instanceof Error ? e.message : String(e);
  }
}

async function check() {
  if (!data.meta || document.hidden) return;
  try {
    const next = await get<Meta>("/meta");
    if (next.loaded_at !== data.meta.loaded_at)
      data.pending = { reviewed: next.reviewed - data.meta.reviewed, loaded_at: next.loaded_at };
  } catch {}
}
setInterval(check, 45000);
addEventListener("visibilitychange", check);

/**
 * Choices that hold across views: which sample the figures use and how the
 * sender model is attributed. Kept in this browser between visits.
 */
type Prefs = { sample: "fair" | "all"; basis: "recorded" | "thread" };
function stored(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem("handoff-review-prefs") ?? "{}");
    return { sample: p.sample === "all" ? "all" : "fair", basis: p.basis === "thread" ? "thread" : "recorded" };
  } catch {
    return { sample: "fair", basis: "recorded" };
  }
}
export const prefs = $state<Prefs>(stored());
export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  prefs[key] = value;
  try {
    localStorage.setItem("handoff-review-prefs", JSON.stringify(prefs));
  } catch {}
}
