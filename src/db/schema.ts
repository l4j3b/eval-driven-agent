import { sql } from "drizzle-orm";
import {
	boolean,
	customType,
	date,
	index,
	integer,
	jsonb,
	numeric,
	pgSchema,
	primaryKey,
	real,
	text,
	timestamp,
	uniqueIndex,
	vector,
} from "drizzle-orm/pg-core";

import { EMBEDDING_DIMENSIONS } from "#/lib/models";

// Everything the demo stores lives in its own schema, owned by the agent_app role.
// Catalog and account rows use readable, stable ids ("miso-butter-salmon",
// "ord_0042") instead of generated ones, so eval cases can point at the same
// rows after every reseed. Every table has RLS on with no policies: agent_app
// owns the tables and bypasses it, and any other role sees nothing.
export const agent = pgSchema("agent");

const createdAt = () =>
	timestamp({ withTimezone: true }).notNull().defaultNow();
const emptyArray = sql`'{}'`;
const money = (precision = 8) =>
	numeric({ precision, scale: 2, mode: "number" });
const tsvector = customType<{ data: string }>({
	dataType: () => "tsvector",
});

export const course = agent.enum("course", [
	"main",
	"side",
	"dessert",
	"breakfast",
]);
export const difficulty = agent.enum("difficulty", ["easy", "medium", "hard"]);
export const ingredientCategory = agent.enum("ingredient_category", [
	"produce",
	"protein",
	"seafood",
	"dairy",
	"grain",
	"pantry",
	"spice",
	"herb",
	"sauce",
]);
export const articleCategory = agent.enum("article_category", [
	"technique",
	"food-safety",
	"substitutions",
	"help-center",
]);
export const articleStatus = agent.enum("article_status", [
	"published",
	"archived",
]);
export const subscriptionStatus = agent.enum("subscription_status", [
	"active",
	"paused",
	"cancelled",
]);
export const chunkSource = agent.enum("chunk_source", ["recipe", "article"]);
export const orderStatus = agent.enum("order_status", [
	"scheduled",
	"processing",
	"delivered",
	"skipped",
]);

// --- Catalog -----------------------------------------------------------------

export const recipes = agent
	.table("recipes", {
		id: text().primaryKey(),
		title: text().notNull(),
		description: text().notNull(),
		cuisine: text().notNull(),
		course: course().notNull(),
		difficulty: difficulty().notNull(),
		prepMinutes: integer().notNull(),
		cookMinutes: integer().notNull(),
		servings: integer().notNull(),
		calories: integer().notNull(),
		proteinG: integer().notNull(),
		carbsG: integer().notNull(),
		fatG: integer().notNull(),
		dietTags: text().array().notNull().default(emptyArray),
		allergens: text().array().notNull().default(emptyArray),
		steps: text().array().notNull(),
		tips: text(),
		isPremium: boolean().notNull().default(false),
		rating: real().notNull(),
		ratingCount: integer().notNull(),
		createdAt: createdAt(),
	})
	.enableRLS();

export const ingredients = agent
	.table("ingredients", {
		id: text().primaryKey(),
		name: text().notNull().unique(),
		category: ingredientCategory().notNull(),
	})
	.enableRLS();

export const recipeIngredients = agent
	.table(
		"recipe_ingredients",
		{
			recipeId: text()
				.notNull()
				.references(() => recipes.id, { onDelete: "cascade" }),
			position: integer().notNull(),
			ingredientId: text()
				.notNull()
				.references(() => ingredients.id),
			quantity: real(),
			unit: text(),
			note: text(),
			allergens: text().array().notNull().default(emptyArray),
		},
		(t) => [
			primaryKey({ columns: [t.recipeId, t.position] }),
			index().on(t.ingredientId),
		],
	)
	.enableRLS();

export const articles = agent
	.table("articles", {
		id: text().primaryKey(),
		title: text().notNull(),
		category: articleCategory().notNull(),
		status: articleStatus().notNull().default("published"),
		summary: text().notNull(),
		body: text().notNull(),
		publishedOn: date().notNull(),
		supersededBy: text(),
		createdAt: createdAt(),
	})
	.enableRLS();

export const weeklyMenus = agent
	.table(
		"weekly_menus",
		{
			weekStart: date().notNull(),
			recipeId: text()
				.notNull()
				.references(() => recipes.id, { onDelete: "cascade" }),
		},
		(t) => [
			primaryKey({ columns: [t.weekStart, t.recipeId] }),
			index().on(t.recipeId),
		],
	)
	.enableRLS();

// --- Retrieval ---------------------------------------------------------------

// What search runs over: pieces of recipes and articles, each embedded once.
// `content` is the raw text; `context` is a sentence an LLM wrote to situate an
// article chunk in its article (contextual retrieval). Both are embedded and
// indexed for keyword search, with the title and heading weighted higher.
export const chunks = agent
	.table(
		"chunks",
		{
			id: text().primaryKey(),
			sourceType: chunkSource().notNull(),
			sourceId: text().notNull(),
			position: integer().notNull(),
			title: text().notNull(),
			heading: text(),
			content: text().notNull(),
			context: text(),
			// Hash of everything that goes into the embedding, so re-indexing
			// only re-embeds chunks that changed.
			contentHash: text().notNull(),
			embedding: vector({ dimensions: EMBEDDING_DIMENSIONS }).notNull(),
			fts: tsvector().generatedAlwaysAs(
				sql`setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("heading", '')), 'B') || setweight(to_tsvector('english', coalesce("context", '') || ' ' || "content"), 'C')`,
			),
			createdAt: createdAt(),
		},
		(t) => [
			index().on(t.sourceType, t.sourceId),
			index("chunks_embedding_hnsw").using(
				"hnsw",
				t.embedding.op("vector_cosine_ops"),
			),
			index("chunks_fts_gin").using("gin", t.fts),
		],
	)
	.enableRLS();

// --- Accounts ----------------------------------------------------------------

export const customers = agent
	.table("customers", {
		id: text().primaryKey(),
		name: text().notNull(),
		email: text().notNull().unique(),
		city: text().notNull(),
		householdSize: integer().notNull(),
		dietaryPreferences: text().array().notNull().default(emptyArray),
		allergies: text().array().notNull().default(emptyArray),
		joinedOn: date().notNull(),
	})
	.enableRLS();

export const subscriptions = agent
	.table("subscriptions", {
		id: text().primaryKey(),
		customerId: text()
			.notNull()
			.unique()
			.references(() => customers.id, { onDelete: "cascade" }),
		servingsPerRecipe: integer().notNull(),
		recipesPerWeek: integer().notNull(),
		status: subscriptionStatus().notNull(),
		deliveryDay: text().notNull(),
		pricePerServing: money(6).notNull(),
		startedOn: date().notNull(),
		pausedUntil: date(),
		cancelledOn: date(),
	})
	.enableRLS();

export const orders = agent
	.table(
		"orders",
		{
			id: text().primaryKey(),
			customerId: text()
				.notNull()
				.references(() => customers.id, { onDelete: "cascade" }),
			weekStart: date().notNull(),
			status: orderStatus().notNull(),
			deliveryDate: date().notNull(),
			subtotal: money().notNull(),
			shipping: money(6).notNull(),
		},
		(t) => [uniqueIndex().on(t.customerId, t.weekStart)],
	)
	.enableRLS();

export const orderItems = agent
	.table(
		"order_items",
		{
			orderId: text()
				.notNull()
				.references(() => orders.id, { onDelete: "cascade" }),
			recipeId: text()
				.notNull()
				.references(() => recipes.id),
			servings: integer().notNull(),
			unitPrice: money(6).notNull(),
		},
		(t) => [
			primaryKey({ columns: [t.orderId, t.recipeId] }),
			index().on(t.recipeId),
		],
	)
	.enableRLS();

export const credits = agent
	.table(
		"credits",
		{
			id: text().primaryKey(),
			customerId: text()
				.notNull()
				.references(() => customers.id, { onDelete: "cascade" }),
			orderId: text().references(() => orders.id, { onDelete: "set null" }),
			recipeId: text().references(() => recipes.id),
			amount: money(6).notNull(),
			reason: text().notNull(),
			issuedBy: text().notNull(),
			issuedAt: timestamp({ withTimezone: true }).notNull(),
		},
		(t) => [
			index().on(t.customerId),
			index().on(t.orderId),
			index().on(t.recipeId),
		],
	)
	.enableRLS();

export const ticketStatus = agent.enum("ticket_status", ["open", "resolved"]);

// Cases the agent hands to a human, e.g. a credit above the automatic limit.
export const supportTickets = agent
	.table(
		"support_tickets",
		{
			id: text().primaryKey(),
			customerId: text()
				.notNull()
				.references(() => customers.id, { onDelete: "cascade" }),
			orderId: text().references(() => orders.id, { onDelete: "set null" }),
			chatId: text(),
			summary: text().notNull(),
			status: ticketStatus().notNull().default("open"),
			createdAt: createdAt(),
		},
		(t) => [index().on(t.customerId), index().on(t.orderId)],
	)
	.enableRLS();

// --- Chats -------------------------------------------------------------------

export const chats = agent
	.table(
		"chats",
		{
			id: text().primaryKey(),
			title: text().notNull(),
			customerId: text().references(() => customers.id, {
				onDelete: "set null",
			}),
			createdAt: createdAt(),
			updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
		},
		(t) => [index().on(t.customerId), index().on(t.updatedAt.desc())],
	)
	.enableRLS();

// One row per AI SDK UIMessage. `parts` is stored as-is, so tool calls,
// citations and reasoning round-trip without a column per part type.
export const chatMessages = agent
	.table(
		"chat_messages",
		{
			id: text().primaryKey(),
			chatId: text()
				.notNull()
				.references(() => chats.id, { onDelete: "cascade" }),
			role: text().notNull(),
			parts: jsonb().notNull(),
			metadata: jsonb(),
			createdAt: createdAt(),
		},
		(t) => [index().on(t.chatId, t.createdAt)],
	)
	.enableRLS();
