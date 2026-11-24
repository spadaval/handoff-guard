/** Hash routes: #/ · #/hook · #/messages?… · #/m/<id>?from=<list query> · #/rubric */
export type Route =
  | { view: "overview"; params: URLSearchParams }
  | { view: "hook"; params: URLSearchParams }
  | { view: "messages"; params: URLSearchParams }
  | { view: "message"; id: string; params: URLSearchParams }
  | { view: "rubric"; params: URLSearchParams }
  | { view: "agreement"; params: URLSearchParams };

function parse(): Route {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, query = ""] = raw.split("?");
  const params = new URLSearchParams(query);
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "hook") return { view: "hook", params };
  if (parts[0] === "messages") return { view: "messages", params };
  if (parts[0] === "rubric") return { view: "rubric", params };
  if (parts[0] === "agreement") return { view: "agreement", params };
  if (parts[0] === "m" && parts[1]) return { view: "message", id: parts[1], params };
  return { view: "overview", params };
}

export const router = $state({ route: parse() });
addEventListener("hashchange", () => {
  const before = router.route;
  router.route = parse();
  if (before.view !== router.route.view || (before.view === "message" && router.route.view === "message" && before.id !== router.route.id))
    scrollTo({ top: 0 });
});

export function href(path: string, params?: URLSearchParams | Record<string, string | undefined | null>) {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(Object.entries(params ?? {}).filter((e): e is [string, string] => !!e[1]));
  const q = p.toString();
  return "#" + path + (q ? "?" + q : "");
}
export function go(path: string, params?: URLSearchParams | Record<string, string | undefined | null>) {
  location.hash = href(path, params).slice(1);
}
/** Replace query without adding history. */
export function setParams(params: URLSearchParams) {
  const raw = location.hash.replace(/^#/, "") || "/";
  const path = raw.split("?")[0];
  const q = params.toString();
  history.replaceState(null, "", "#" + path + (q ? "?" + q : ""));
  router.route = parse();
}
export function messageHref(id: string, from?: URLSearchParams | string) {
  const q = typeof from === "string" ? from : from?.toString();
  return href("/m/" + id, q ? { from: q } : undefined);
}
