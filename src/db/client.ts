import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "#/db/schema";

// One pool per process. Through Supavisor's session pooler, so the role's
// search_path (agent, extensions) applies and prepared statements are fine.
const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

export const sql =
	globalForDb.sql ??
	postgres(process.env.DATABASE_URL as string, { max: 5, idle_timeout: 20 });

if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;

export const db = drizzle(sql, { schema, casing: "snake_case" });
