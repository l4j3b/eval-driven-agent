import { propagateAttributes } from "@langfuse/tracing";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { search } from "#/server/retrieval";

const searchInput = z.object({
	query: z.string().trim().min(1).max(300),
	filters: z
		.object({
			sources: z.array(z.enum(["recipe", "article"])).optional(),
			includeArchived: z.boolean().optional(),
			maxMinutes: z.number().int().positive().optional(),
			excludeAllergens: z.array(z.string()).optional(),
			dietTags: z.array(z.string()).optional(),
		})
		.default({}),
	rerank: z.boolean().default(true),
});

export type SearchInput = z.input<typeof searchInput>;

export const runSearch = createServerFn({ method: "POST" })
	.validator(searchInput)
	.handler(({ data }) =>
		propagateAttributes({ tags: ["search-playground"] }, () =>
			search(data.query, {
				filters: data.filters,
				rerank: data.rerank,
				limit: 8,
				candidates: 20,
			}),
		),
	);

export type SearchResult = Awaited<ReturnType<typeof runSearch>>;
