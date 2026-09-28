import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

// Lazy initialization: Next.js evaluates top-level module code at build time,
// before DATABASE_URL is necessarily available — a module-scope postgres()
// call would crash `next build`. Do not wrap this in a Proxy (breaks libraries
// that inspect the client object, e.g. auth adapters); a plain lazy getter is enough.
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!_db) {
    const sql = postgres(process.env.DATABASE_URL!, { max: 10 });
    _db = drizzle(sql, { schema });
  }
  return _db;
}
