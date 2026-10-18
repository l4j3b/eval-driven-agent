// Chunks every recipe and article, writes context for article chunks, embeds
// what changed, and upserts it into agent.chunks.
//
//   npm run index                    # incremental
//   npm run index -- --no-context    # skip contextual retrieval
//
// Re-running is cheap: a chunk is only re-embedded when the text it embeds
// changed, and an article's contexts are only rewritten when its chunks did.
// Work is saved article by article, so a failure halfway loses nothing.
//
// Contexts are also kept in data/chunk-contexts.json (committed), so a fresh
// database reuses them instead of making one rate-limited LLM call per article.
import "#/server/telemetry";

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";

import { generateText, Output } from "ai";
import { asc, notInArray, sql } from "drizzle-orm";
import { z } from "zod";

import { sql as client, db } from "#/db/client";
import * as schema from "#/db/schema";
import {
	type ChunkDraft,
	chunkArticle,
	chunkRecipe,
	embeddingText,
} from "#/lib/chunking";
import { MODELS } from "#/lib/models";
import { embedDocuments } from "#/server/embeddings";
import { flushTelemetry } from "#/server/telemetry";

const withContext = !process.argv.includes("--no-context");
const EMBED_BATCH = 50;
// The gateway's free tier allows 5 requests a minute for Flash-Lite.
const CONTEXT_CALL_INTERVAL_MS = 13_000;

const CONTEXTS_FILE = "data/chunk-contexts.json";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

// Chunk id → its context, with a hash of the content it was written for.
type SavedContexts = Record<string, { contentHash: string; context: string }>;

async function readSavedContexts(): Promise<SavedContexts> {
	try {
		return JSON.parse(await readFile(CONTEXTS_FILE, "utf8"));
	} catch {
		return {};
	}
}

type Article = typeof schema.articles.$inferSelect;
type Existing = {
	content: string;
	context: string | null;
	contentHash: string;
};

// Contextual retrieval: a chunk like "Report it within 7 days." is ambiguous
// alone. A sentence saying which article and policy it belongs to makes it
// findable by both embeddings and keywords. One call per article writes the
// contexts for all its chunks, so the model reads the article once.
let lastContextCall = 0;
async function contextualize(article: Article, drafts: ChunkDraft[]) {
	await wait(
		Math.max(0, lastContextCall + CONTEXT_CALL_INTERVAL_MS - Date.now()),
	);
	lastContextCall = Date.now();
	const { output } = await generateText({
		model: MODELS.fast,
		maxRetries: 4,
		output: Output.object({
			schema: z.object({ contexts: z.array(z.string()) }),
		}),
		prompt: `<article title="${article.title}">
${article.body}
</article>

The article is split into these ${drafts.length} chunks:
${drafts.map((draft, index) => `<chunk index="${index + 1}">\n${draft.content}\n</chunk>`).join("\n")}

For each chunk, in order, write one or two short sentences that situate it within the article, to help a search engine find it: name the article's topic and what the chunk covers. Return exactly ${drafts.length} contexts.`,
		telemetry: { functionId: "contextualize-chunks" },
	});
	if (output.contexts.length !== drafts.length) {
		console.warn(
			`contexts: ${article.id} returned ${output.contexts.length} for ${drafts.length} chunks, skipping`,
		);
		return drafts.map(() => null);
	}
	return output.contexts.map((context) => context.trim());
}

// Embeds and upserts the rows whose embedded text changed.
async function save(
	drafts: ChunkDraft[],
	contexts: (string | null)[],
	previous: Map<string, Existing>,
) {
	const rows = drafts.map((draft, index) => {
		const context = contexts[index] ?? null;
		const text = embeddingText(draft, context);
		return {
			draft,
			context,
			text,
			contentHash: hash(`${MODELS.embedding}\n${text}`),
		};
	});
	const stale = rows.filter(
		(row) => previous.get(row.draft.id)?.contentHash !== row.contentHash,
	);
	for (let start = 0; start < stale.length; start += EMBED_BATCH) {
		const batch = stale.slice(start, start + EMBED_BATCH);
		const embeddings = await embedDocuments(batch.map((row) => row.text));
		await db
			.insert(schema.chunks)
			.values(
				batch.map((row, index) => ({
					...row.draft,
					context: row.context,
					contentHash: row.contentHash,
					embedding: embeddings[index] as number[],
				})),
			)
			.onConflictDoUpdate({
				target: schema.chunks.id,
				set: {
					position: sql`excluded.position`,
					title: sql`excluded.title`,
					heading: sql`excluded.heading`,
					content: sql`excluded.content`,
					context: sql`excluded.context`,
					contentHash: sql`excluded.content_hash`,
					embedding: sql`excluded.embedding`,
				},
			});
	}
	return stale.length;
}

async function main() {
	const started = Date.now();
	const [recipes, recipeIngredients, ingredients, articles, existing] =
		await Promise.all([
			db.select().from(schema.recipes),
			db
				.select()
				.from(schema.recipeIngredients)
				.orderBy(
					asc(schema.recipeIngredients.recipeId),
					asc(schema.recipeIngredients.position),
				),
			db.select().from(schema.ingredients),
			db.select().from(schema.articles),
			db
				.select({
					id: schema.chunks.id,
					content: schema.chunks.content,
					context: schema.chunks.context,
					contentHash: schema.chunks.contentHash,
				})
				.from(schema.chunks),
		]);
	const previous = new Map(existing.map((row) => [row.id, row]));
	const saved = await readSavedContexts();
	const ingredientName = new Map(ingredients.map((row) => [row.id, row.name]));

	// Recipes: self-contained chunks with the title in the header, no context needed.
	const recipeDrafts = recipes.flatMap((recipe) =>
		chunkRecipe({
			...recipe,
			ingredients: recipeIngredients
				.filter((row) => row.recipeId === recipe.id)
				.map((row) => ({
					name: ingredientName.get(row.ingredientId) ?? row.ingredientId,
					quantity: row.quantity,
					unit: row.unit,
					note: row.note,
				})),
		}),
	);
	let embedded = await save(
		recipeDrafts,
		recipeDrafts.map(() => null),
		previous,
	);
	console.log(`recipes: ${recipeDrafts.length} chunks, ${embedded} embedded`);

	// Articles: contexts first (reused when every chunk is unchanged), then embed.
	let contextCalls = 0;
	const articleDrafts: ChunkDraft[] = [];
	for (const article of articles) {
		const drafts = chunkArticle(article);
		if (drafts.length === 0) {
			console.warn(`article ${article.id}: no chunks, it won't be searchable`);
			continue;
		}
		articleDrafts.push(...drafts);
		const reusable = drafts.map((draft) => {
			const before = previous.get(draft.id);
			if (before?.context && before.content === draft.content)
				return before.context;
			const file = saved[draft.id];
			return file?.contentHash === hash(draft.content) ? file.context : null;
		});
		let contexts: (string | null)[] = drafts.map(() => null);
		if (withContext && reusable.every(Boolean)) {
			contexts = reusable;
		} else if (withContext) {
			contextCalls++;
			contexts = await contextualize(article, drafts);
		}
		const count = await save(drafts, contexts, previous);
		embedded += count;
		console.log(
			`article ${article.id}: ${drafts.length} chunks, ${count} embedded`,
		);
	}

	// Chunks whose source disappeared or now splits differently.
	const removed = await db
		.delete(schema.chunks)
		.where(
			notInArray(
				schema.chunks.id,
				[...recipeDrafts, ...articleDrafts].map((draft) => draft.id),
			),
		)
		.returning({ id: schema.chunks.id });

	// Keep the contexts file in step with the database.
	const contexts = await db
		.select({
			id: schema.chunks.id,
			content: schema.chunks.content,
			context: schema.chunks.context,
		})
		.from(schema.chunks)
		.orderBy(asc(schema.chunks.id));
	const file: SavedContexts = {};
	for (const row of contexts) {
		if (row.context)
			file[row.id] = { contentHash: hash(row.content), context: row.context };
	}
	await writeFile(CONTEXTS_FILE, `${JSON.stringify(file, null, "\t")}\n`);

	const total = recipeDrafts.length + articleDrafts.length;
	console.log(
		[
			`chunks: ${total} (${recipeDrafts.length} from ${recipes.length} recipes, ${articleDrafts.length} from ${articles.length} articles)`,
			`context calls: ${contextCalls}${withContext ? "" : " (skipped: --no-context)"}`,
			`embedded: ${embedded}, unchanged: ${total - embedded}, removed: ${removed.length}`,
			`took ${((Date.now() - started) / 1000).toFixed(1)}s`,
		].join("\n"),
	);
}

try {
	await main();
} finally {
	await flushTelemetry();
	await client.end();
}
