import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "sqlite",
  schema: "./tooling/db/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.HANDOFF_DATABASE ?? "./data/handoffs.sqlite3",
  },
});
