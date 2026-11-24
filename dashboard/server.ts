/**
 * Serve the review dashboard and its read-only API from one Node process.
 *
 *   npm run dev      Vite in middleware mode, with hot reload
 *   npm start        the built app from dist/ (run `npm run build` first)
 *
 * Environment: HOST, PORT, HANDOFF_DB, HANDOFF_GUARD, HANDOFF_RUBRIC,
 * ALLOWED_HOSTS. See README.md.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { createDashboardApi } from "../scripts/dashboard-api.ts";

const here = import.meta.dirname;
const root = resolve(here, "..");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 5180);
const production = process.argv.includes("--production");
const database = resolve(process.env.HANDOFF_DB || join(root, "data/handoffs.sqlite3"));
const allowed = new Set(
  ["localhost", "127.0.0.1", "::1", host, ...(process.env.ALLOWED_HOSTS ?? "").split(",")]
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);

if (!existsSync(database)) {
  console.error(`No database at ${database}. Set HANDOFF_DB to the SQLite file.`);
  process.exit(1);
}
const api = createDashboardApi({
  database,
  guard: process.env.HANDOFF_GUARD ? resolve(process.env.HANDOFF_GUARD) : undefined,
  rubric: process.env.HANDOFF_RUBRIC ? resolve(process.env.HANDOFF_RUBRIC) : undefined,
});

/** Refuse requests whose Host header names another site (DNS rebinding). */
function hostAllowed(req: IncomingMessage) {
  const header = (req.headers.host ?? "").toLowerCase();
  const name = header.startsWith("[") ? header.slice(1, header.indexOf("]")) : header.split(":")[0];
  return allowed.has(name);
}

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};
function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const dist = join(here, "dist");
  const path = decodeURIComponent(new URL(req.url || "/", "http://x").pathname);
  let file = resolve(dist, "." + path);
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory())
    file = join(dist, "index.html");
  res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
  if (file.includes("/assets/")) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.end(readFileSync(file));
}

const server = createServer();
let app: (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
if (production) {
  if (!existsSync(join(here, "dist/index.html"))) {
    console.error("No build in dashboard/dist. Run `npm run build` first, or use `npm run dev`.");
    process.exit(1);
  }
  app = (req, res) => serveStatic(req, res);
} else {
  const { createServer: createVite } = await import("vite");
  const vite = await createVite({
    root: here,
    configFile: join(here, "vite.config.ts"),
    server: { middlewareMode: true, hmr: { server }, allowedHosts: [...allowed] },
    appType: "spa",
  });
  app = vite.middlewares;
}
server.on("request", (req, res) => {
  if (!hostAllowed(req)) {
    res.statusCode = 421;
    res.end("This dashboard does not answer for that host name. Add it to ALLOWED_HOSTS.");
    return;
  }
  api.middleware(req, res, () => app(req, res, () => {
    res.statusCode = 404;
    res.end();
  }));
});
server.listen(port, host, () => {
  const shown = host.includes(":") ? `[${host}]` : host;
  console.log(`Handoff review dashboard on http://${shown}:${port}/ (${production ? "built app" : "dev"})`);
  console.log(`Database: ${database}`);
});
const stop = () => {
  api.close();
  server.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
