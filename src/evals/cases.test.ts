import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { EVAL_CASES } from "#/evals/cases";
import { AGENT_PROMPT } from "#/lib/prompts";

test("case ids are unique", () => {
	const ids = EVAL_CASES.map((testCase) => testCase.id);
	assert.equal(new Set(ids).size, ids.length);
});

test("every category has cases in both splits", () => {
	for (const category of new Set(EVAL_CASES.map((c) => c.category))) {
		const splits = new Set(
			EVAL_CASES.filter((c) => c.category === category).map((c) => c.split),
		);
		assert.deepEqual([...splits].sort(), ["test", "train"], category);
	}
});

test("prompts/v1.md is the prompt the app falls back to", async () => {
	assert.equal(
		(await readFile("prompts/v1.md", "utf8")).trimEnd(),
		AGENT_PROMPT,
	);
});
