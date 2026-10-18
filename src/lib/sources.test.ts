import assert from "node:assert/strict";
import { test } from "node:test";

import type { UIMessage } from "ai";

import { SourceRegistry } from "#/lib/sources";

const source = {
	kind: "article" as const,
	sourceId: "credits",
	title: "Credits",
	section: null,
	text: "…",
};

test("citation numbers continue across the chat and repeat for the same source", () => {
	const earlier: UIMessage[] = [
		{
			id: "m1",
			role: "assistant",
			parts: [
				{
					type: "tool-searchKnowledge",
					toolCallId: "t1",
					state: "output-available",
					input: {},
					output: { sources: [{ ...source, n: 3 }] },
				},
			],
		},
	];
	const registry = new SourceRegistry(earlier);
	const first = registry.add("chunk-a", source);
	assert.equal(first.n, 4);
	assert.equal(registry.add("chunk-a", source).n, 4);
	assert.equal(registry.add("chunk-b", source).n, 5);
});
