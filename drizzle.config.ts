import { defineConfig } from "drizzle-kit";

process.loadEnvFile(".env.local");

export default defineConfig({
	dialect: "postgresql",
	schema: "./src/db/schema.ts",
	out: "./drizzle",
	schemaFilter: ["agent"],
	casing: "snake_case",
	dbCredentials: { url: process.env.DATABASE_URL as string },
});
