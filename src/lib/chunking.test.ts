import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { chunkArticle, chunkRecipe, embeddingText } from "#/lib/chunking";

const article = (body: string) => ({ id: "a", title: "Storing Herbs", body });

describe("chunkArticle", () => {
	test("splits at headings and drops a heading that repeats the title", () => {
		const chunks = chunkArticle(
			article(
				"# Storing Herbs\n\nIntro.\n\n## Soft herbs\n\nLike flowers.\n\n## Hard herbs\n\nWrap them.",
			),
		);
		assert.deepEqual(
			chunks.map((chunk) => [chunk.heading, chunk.content]),
			[
				[null, "Intro."],
				["Soft herbs", "Like flowers."],
				["Hard herbs", "Wrap them."],
			],
		);
		assert.deepEqual(
			chunks.map((chunk) => chunk.id),
			["article:a#0", "article:a#1", "article:a#2"],
		);
	});

	test("keeps an over-long 'heading' as text instead of losing it", () => {
		const runOn = `# ${"An article that lost its line breaks. ".repeat(10)}`;
		const [chunk] = chunkArticle(article(runOn));
		assert.equal(chunk?.heading, null);
		assert.ok(chunk?.content.startsWith("An article that lost"));
	});

	test("splits long sections with one paragraph of overlap", () => {
		const paragraphs = Array.from(
			{ length: 6 },
			(_, index) => `Paragraph ${index}. ${"Words to fill it up. ".repeat(14)}`,
		);
		const chunks = chunkArticle(article(paragraphs.join("\n\n")));
		assert.ok(chunks.length > 1);
		for (const [index, chunk] of chunks.entries()) {
			assert.ok(chunk.content.length <= 1200, `chunk ${index} is too long`);
			const next = chunks[index + 1];
			if (!next) continue;
			const last = chunk.content.split("\n\n").at(-1) ?? "";
			assert.ok(next.content.startsWith(last), "no overlap between chunks");
		}
	});
});

test("chunkRecipe makes an overview and a method", () => {
	const chunks = chunkRecipe({
		id: "miso-salmon",
		title: "Miso Salmon",
		description: "Glazed salmon.",
		cuisine: "Japanese",
		course: "main",
		difficulty: "easy",
		prepMinutes: 10,
		cookMinutes: 15,
		servings: 2,
		dietTags: ["pescatarian"],
		allergens: ["fish", "soy"],
		steps: ["Glaze.", "Roast."],
		tips: null,
		ingredients: [{ name: "salmon", quantity: 2, unit: null, note: "fillets" }],
	});
	assert.deepEqual(
		chunks.map((chunk) => chunk.heading),
		["Overview", "Method"],
	);
	assert.match(chunks[0]?.content ?? "", /25 minutes.*Allergens: fish, soy/s);
	assert.equal(chunks[1]?.content, "1. Glaze.\n2. Roast.");
	assert.equal(
		embeddingText(chunks[1] as (typeof chunks)[number], "Context."),
		"Recipe: Miso Salmon\nSection: Method\nContext.\n1. Glaze.\n2. Roast.",
	);
});
