/** Compile-time checks for the shared Drizzle model. Never executed. */
import type { ResearchDatabase } from "../tooling/db/connection.ts";
import { messages } from "../tooling/db/schema.ts";
function check(db: ResearchDatabase) {
  const row = db.orm.select({ id: messages.message_id }).from(messages).get();
  if (row) {
    const id: string = row.id;
    // @ts-expect-error Only selected columns are available.
    row.text;
  }
  const invalid: typeof messages.$inferInsert = {
    message_id: "id",
    text: "body",
    // @ts-expect-error Character counts are numbers, not arbitrary strings.
    characters: "wrong",
    words: 1,
    kinds: "[]",
    projects: "[]",
    is_input: 1,
  };
  // @ts-expect-error Misspelled database fields are rejected.
  db.orm.select({ id: messages.mesage_id });
}
