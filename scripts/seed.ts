// Loads ./data/*.json (from `npm run data:generate`) into the agent schema.
// Replaces the catalog and accounts in one transaction; chats are left alone.
import { readFile } from "node:fs/promises";
import type { PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "#/db/schema";
import { slugify } from "#/lib/slug";

type GeneratedRecipe = typeof schema.recipes.$inferInsert & {
	ingredients: {
		name: string;
		quantity: number | null;
		unit: string | null;
		note: string | null;
		category: (typeof schema.ingredientCategory.enumValues)[number];
		allergens: string[];
	}[];
};

type Accounts = {
	customers: (typeof schema.customers.$inferInsert)[];
	subscriptions: (typeof schema.subscriptions.$inferInsert)[];
	weeklyMenus: (typeof schema.weeklyMenus.$inferInsert)[];
	orders: (typeof schema.orders.$inferInsert)[];
	orderItems: (typeof schema.orderItems.$inferInsert)[];
	credits: (Omit<typeof schema.credits.$inferInsert, "issuedAt"> & {
		issuedAt: string;
	})[];
};

const read = async <T>(file: string) =>
	JSON.parse(await readFile(`data/${file}`, "utf8")) as T;

const recipes = await read<GeneratedRecipe[]>("recipes.json");
const articles =
	await read<(typeof schema.articles.$inferInsert)[]>("articles.json");
const accounts = await read<Accounts>("accounts.json");

// One row per distinct ingredient name; the first category seen wins.
const ingredients = new Map<string, typeof schema.ingredients.$inferInsert>();
const recipeIngredients: (typeof schema.recipeIngredients.$inferInsert)[] = [];
for (const recipe of recipes) {
	recipe.ingredients.forEach((ingredient, position) => {
		const id = slugify(ingredient.name);
		if (!ingredients.has(id)) {
			ingredients.set(id, {
				id,
				name: ingredient.name,
				category: ingredient.category,
			});
		}
		recipeIngredients.push({
			recipeId: recipe.id,
			position,
			ingredientId: id,
			quantity: ingredient.quantity,
			unit: ingredient.unit,
			note: ingredient.note,
			allergens: ingredient.allergens,
		});
	});
}

const sql = postgres(process.env.DATABASE_URL as string, {
	max: 1,
	onnotice: () => {},
});
const db = drizzle(sql, { schema, casing: "snake_case" });

async function insertAll<T extends PgTable>(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	table: T,
	rows: T["$inferInsert"][],
) {
	for (let start = 0; start < rows.length; start += 500) {
		await tx.insert(table).values(rows.slice(start, start + 500));
	}
}

try {
	await db.transaction(async (tx) => {
		// Children first, so foreign keys never block a delete.
		for (const table of [
			schema.credits,
			schema.orderItems,
			schema.orders,
			schema.subscriptions,
			schema.customers,
			schema.weeklyMenus,
			schema.recipeIngredients,
			schema.ingredients,
			schema.recipes,
			schema.articles,
		]) {
			await tx.delete(table);
		}

		await insertAll(
			tx,
			schema.recipes,
			recipes.map(({ ingredients: _, ...recipe }) => recipe),
		);
		await insertAll(tx, schema.ingredients, [...ingredients.values()]);
		await insertAll(tx, schema.recipeIngredients, recipeIngredients);
		await insertAll(tx, schema.articles, articles);
		await insertAll(tx, schema.weeklyMenus, accounts.weeklyMenus);
		await insertAll(tx, schema.customers, accounts.customers);
		await insertAll(tx, schema.subscriptions, accounts.subscriptions);
		await insertAll(tx, schema.orders, accounts.orders);
		await insertAll(tx, schema.orderItems, accounts.orderItems);
		await insertAll(
			tx,
			schema.credits,
			accounts.credits.map((credit) => ({
				...credit,
				issuedAt: new Date(credit.issuedAt),
			})),
		);
	});
	console.log(
		[
			`recipes ${recipes.length}`,
			`ingredients ${ingredients.size}`,
			`recipe_ingredients ${recipeIngredients.length}`,
			`articles ${articles.length}`,
			`weekly_menus ${accounts.weeklyMenus.length}`,
			`customers ${accounts.customers.length}`,
			`orders ${accounts.orders.length}`,
			`order_items ${accounts.orderItems.length}`,
			`credits ${accounts.credits.length}`,
		].join("\n"),
	);
} finally {
	await sql.end();
}
