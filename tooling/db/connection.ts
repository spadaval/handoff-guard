import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { deflateSync, inflateSync } from "node:zlib";
import { mkdirSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import {
  ROOT,
  DATABASE,
  withinRepository,
  isPrivatePath,
  canonical,
  digest,
  invariant,
  type Data,
} from "../shared.ts";
export function configure(raw: DatabaseSync) {
  raw.function("unpack_text", { deterministic: true }, (v) =>
    v instanceof Uint8Array ? inflateSync(v).toString("utf8") : v,
  );
  raw.function("pack_text", { deterministic: true }, (v) =>
    deflateSync(String(v)),
  );
  raw.function("text_key", { deterministic: true }, (v) =>
    Buffer.from(digest(String(v)), "hex"),
  );
  raw.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
}
export function schemaSignature(raw: DatabaseSync) {
  return canonical(
    raw
      .prepare(
        "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle_%' ORDER BY type,name",
      )
      .all(),
  );
}
export function isDataPath(path: string) {
  if (path === ":memory:") return true;
  const within = withinRepository(path);
  return (
    isPrivatePath(path) ||
    (within !== null && /\.(?:sqlite[^/]*|db(?:-.*)?)$/.test(within))
  );
}
export function openDatabase(
  path = DATABASE,
  options: { readOnly?: boolean; initialize?: boolean } = {},
) {
  invariant(
    options.readOnly || isDataPath(path),
    "Database files must remain ignored by Git",
  );
  if (!options.readOnly && path !== ":memory:") {
    mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  }
  const raw = new DatabaseSync(path, { readOnly: options.readOnly ?? false });
  try {
    configure(raw);
    const orm = drizzle({ client: raw });
    const db = {
      raw,
      orm,
      path,
      all<T = Data>(sql: string, ...params: SQLInputValue[]): T[] {
        return raw.prepare(sql).all(...params) as T[];
      },
      get<T = Data>(sql: string, ...params: SQLInputValue[]): T | undefined {
        return raw.prepare(sql).get(...params) as T | undefined;
      },
      run(sql: string, ...params: SQLInputValue[]) {
        return raw.prepare(sql).run(...params);
      },
      transaction<T>(fn: () => T): T {
        raw.exec("BEGIN IMMEDIATE");
        try {
          const result = fn();
          raw.exec("COMMIT");
          return result;
        } catch (e) {
          raw.exec("ROLLBACK");
          throw e;
        }
      },
      close() {
        raw.close();
      },
    };
    if (options.readOnly) raw.exec("PRAGMA query_only=ON");
    if (options.initialize !== false && !options.readOnly) {
      if (path !== ":memory:") chmodSync(path, 0o600);
      const folder = resolve(ROOT, "migrations");
      const version = Number(
        Object.values(raw.prepare("PRAGMA user_version").get()!)[0],
      );
      const tables = raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .all();
      const registered = raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='__drizzle_migrations'",
        )
        .get();
      if (tables.length && !registered) {
        invariant(
          version === 2,
          "Unsupported database; expected the existing v2 dataset",
        );
        const expected = new DatabaseSync(":memory:");
        configure(expected);
        try {
          for (const migration of readMigrationFiles({
            migrationsFolder: folder,
          }))
            for (const statement of migration.sql) expected.exec(statement);
          invariant(
            schemaSignature(raw) === schemaSignature(expected),
            "Existing schema differs from the checked-in baseline; refusing to adopt it",
          );
        } finally {
          expected.close();
        }
        invariant(
          readMigrationFiles({ migrationsFolder: folder }).length === 1,
          "Adopt the v2 baseline before adding later migrations",
        );
        const adoption: Parameters<typeof migrate>[1] & { init: boolean } = {
          migrationsFolder: folder,
          init: true,
        };
        invariant(
          !migrate(orm, adoption),
          "Could not adopt the baseline migration",
        );
      } else migrate(orm, { migrationsFolder: folder });
    }
    return db;
  } catch (e) {
    raw.close();
    throw e;
  }
}
export type ResearchDatabase = ReturnType<typeof openDatabase>;
export function fingerprint(db: ResearchDatabase, table: string) {
  invariant(/^[a-z_]+$/.test(table), "Invalid table name");
  const hash = createHash();
  for (const row of db.raw
    .prepare(
      `SELECT * FROM ${table} ORDER BY 1${table === "context_evidence" ? ",2" : ""}`,
    )
    .iterate()) {
    const value: Data = {};
    for (const [k, v] of Object.entries(row))
      value[k] =
        v instanceof Uint8Array ? { blob: Buffer.from(v).toString("hex") } : v;
    hash.update(canonical(value) + "\n");
  }
  return hash.digest("hex");
}
import { createHash as nativeHash } from "node:crypto";
const createHash = () => nativeHash("sha256");
