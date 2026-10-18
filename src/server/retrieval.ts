import "#/server/telemetry";

import { rerank } from "ai";

import { sql } from "#/db/client";
import { reciprocalRankFusion } from "#/lib/fusion";
import { MODELS } from "#/lib/models";
import { embedQuery } from "#/server/embeddings";

// Four ways to answer "which chunks are relevant to this query?", each a
// building block of the next:
//
//   vector   embeddings + cosine distance: finds meaning ("cozy" ≈ "warming")
//   keyword  Postgres full-text search: finds exact terms ("gochugaru")
//   hybrid   both lists fused with Reciprocal Rank Fusion
//   rerank   a cross-encoder rescores the fused candidates against the query
//
// The agent uses `search()`; the /search playground shows every stage.

export type SearchFilters = {
	sources?: ("recipe" | "article")[];
	includeArchived?: boolean;
	maxMinutes?: number;
	excludeAllergens?: string[];
	dietTags?: string[];
};

export type Hit = {
	id: string;
	sourceType: "recipe" | "article";
	sourceId: string;
	title: string;
	heading: string | null;
	content: string;
	context: string | null;
	score: number;
};

type Row = {
	id: string;
	source_type: "recipe" | "article";
	source_id: string;
	title: string;
	heading: string | null;
	content: string;
	context: string | null;
	score: number;
};

const toHit = (row: Row): Hit => ({
	id: row.id,
	sourceType: row.source_type,
	sourceId: row.source_id,
	title: row.title,
	heading: row.heading,
	content: row.content,
	context: row.context,
	score: Number(row.score),
});

// Filters join back to the source tables, so recipe filters (time, allergens,
// diet) apply to recipe chunks and leave article chunks alone. These are
// postgres.js fragments: they're inlined, with their parameters, into
// whichever query interpolates them.
function filterSql(filters: SearchFilters) {
	const none = sql``;
	return sql`
		${filters.sources?.length ? sql`and c.source_type::text = any(${filters.sources})` : none}
		${filters.includeArchived ? none : sql`and (a.status is null or a.status <> 'archived')`}
		${filters.maxMinutes ? sql`and (r.id is null or r.prep_minutes + r.cook_minutes <= ${filters.maxMinutes})` : none}
		${filters.excludeAllergens?.length ? sql`and (r.id is null or not (r.allergens && ${filters.excludeAllergens}::text[]))` : none}
		${filters.dietTags?.length ? sql`and (r.id is null or r.diet_tags @> ${filters.dietTags}::text[])` : none}
	`;
}

const from = () => sql`
	from agent.chunks c
	left join agent.recipes r on c.source_type = 'recipe' and r.id = c.source_id
	left join agent.articles a on c.source_type = 'article' and a.id = c.source_id
`;

export async function vectorSearch(
	embedding: number[],
	filters: SearchFilters,
	limit: number,
): Promise<Hit[]> {
	const vector = JSON.stringify(embedding);
	const rows = await sql.begin(async (q) => {
		// HNSW finds the nearest neighbors first and filters after, so a strict
		// filter could leave too few rows. pgvector 0.8's iterative scan keeps
		// walking the graph until the limit is met (slightly out of order, so
		// results are re-sorted below).
		await q`set local hnsw.iterative_scan = relaxed_order`;
		return q<Row[]>`
			select c.id, c.source_type, c.source_id, c.title, c.heading, c.content, c.context,
				1 - (c.embedding <=> ${vector}::vector) as score
			${from()}
			where true ${filterSql(filters)}
			order by c.embedding <=> ${vector}::vector
			limit ${limit}
		`;
	});
	return rows.map(toHit).sort((a, b) => b.score - a.score);
}

export async function keywordSearch(
	query: string,
	filters: SearchFilters,
	limit: number,
): Promise<Hit[]> {
	// websearch_to_tsquery would AND every word, so a question like "how long
	// do I braise short ribs" would need all of them. Instead: stem the query
	// with the same English config as the index, OR the stems together, and
	// let ts_rank_cd reward chunks matching more of them (title matches count most).
	const rows = await sql<Row[]>`
		with q as (
			select to_tsquery('simple', array_to_string(array(
				select quote_literal(lexeme)
				from unnest(tsvector_to_array(to_tsvector('english', ${query}))) as lexeme
			), ' | ')) as query
		)
		select c.id, c.source_type, c.source_id, c.title, c.heading, c.content, c.context,
			ts_rank_cd(c.fts, q.query, 32) as score
		${from()}
		cross join q
		where c.fts @@ q.query ${filterSql(filters)}
		order by score desc
		limit ${limit}
	`;
	return rows.map(toHit);
}

const rerankText = (hit: Hit) =>
	[hit.title, hit.heading, hit.content].filter(Boolean).join("\n");

// A reranker reads the query and each candidate together (a cross-encoder),
// which is more accurate than comparing two independent embeddings, but too
// slow to run over the whole corpus. So it only rescores the fused top N.
const RERANK_TIMEOUT_MS = 5000;

export async function rerankHits<T extends Hit>(
	query: string,
	hits: T[],
	topN: number,
	timeoutMs = RERANK_TIMEOUT_MS,
): Promise<(T & { previousRank: number })[]> {
	if (hits.length === 0) return [];
	const { ranking } = await rerank({
		model: MODELS.rerank,
		query,
		documents: hits.map(rerankText),
		topN,
		maxRetries: 1,
		abortSignal: AbortSignal.timeout(timeoutMs),
		telemetry: { functionId: "rerank" },
	});
	return ranking.map((item) => ({
		...(hits[item.originalIndex] as T),
		score: item.score,
		previousRank: item.originalIndex + 1,
	}));
}

export type SearchOptions = {
	filters?: SearchFilters;
	limit?: number;
	candidates?: number;
	rerank?: boolean;
};

export async function search(query: string, options: SearchOptions = {}) {
	const { filters = {}, limit = 6, candidates = 20 } = options;
	const timings: Record<string, number> = {};
	const time = async <T>(name: string, run: () => Promise<T>) => {
		const started = performance.now();
		const result = await run();
		timings[name] = Math.round(performance.now() - started);
		return result;
	};

	const embedding = await time("embed", () => embedQuery(query));
	const [vector, keyword] = await Promise.all([
		time("vector", () => vectorSearch(embedding, filters, candidates)),
		time("keyword", () => keywordSearch(query, filters, candidates)),
	]);
	const hybrid = reciprocalRankFusion([vector, keyword]).slice(0, candidates);
	const fusedOrder = () =>
		hybrid
			.slice(0, limit)
			.map((hit, index) => ({ ...hit, previousRank: index + 1 }));

	// Reranking improves the order but isn't required to answer, so a slow or
	// failing reranker (rate limits, outages) falls back to the fused order
	// instead of failing the search.
	let rerankFallback: string | null = null;
	let reranked = fusedOrder();
	if (options.rerank !== false) {
		try {
			reranked = await time("rerank", () =>
				rerankHits(query, hybrid, limit, RERANK_TIMEOUT_MS),
			);
		} catch (error) {
			rerankFallback =
				error instanceof Error && error.name.includes("Timeout")
					? `Reranker took over ${RERANK_TIMEOUT_MS / 1000}s; showing the fused order.`
					: "Reranker failed; showing the fused order.";
		}
	}

	return { vector, keyword, hybrid, reranked, rerankFallback, timings };
}
