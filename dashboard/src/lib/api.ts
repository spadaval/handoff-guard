import type { createDashboardApi } from "../../../scripts/dashboard-api.ts";
export type { HookCheck, HookReport } from "../../../scripts/dashboard-api.ts";
export type { Review, Issue, Verdict, Dimension } from "../../../tooling/reviews.ts";

type Api = ReturnType<typeof createDashboardApi>;
export type Meta = ReturnType<Api["meta"]>;
export type Overview = ReturnType<Api["overview"]>;
export type MessageList = ReturnType<Api["list"]>;
export type MessageSummary = MessageList["messages"][number];
export type Detail = NonNullable<Awaited<ReturnType<Api["detail"]>>>;
export type Proportion = { k: number; n: number; p: number; low: number; high: number } | null;
export type BreakdownRow = Overview["breakdowns"]["model"][number];

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch("/api" + path, { signal, headers: { Accept: "application/json" } });
  const body = await res.json().catch(() => ({ error: `The server answered ${res.status} without JSON.` }));
  if (!res.ok) throw new ApiError(body.error ?? `Request failed with ${res.status}`, res.status);
  return body as T;
}
