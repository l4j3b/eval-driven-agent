// Applies Drizzle migrations from ./drizzle as agent_app.
// Used instead of `drizzle-kit migrate`, which exits silently on some errors.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

process.loadEnvFile(".env.local");

const sql = postgres(process.env.DATABASE_URL as string, {
	max: 1,
	onnotice: () => {},
});

try {
	await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
	const applied =
		await sql`select count(*)::int as count from drizzle.__drizzle_migrations`;
	console.log(`Migrations applied: ${applied[0]?.count}`);
} finally {
	await sql.end();
}
