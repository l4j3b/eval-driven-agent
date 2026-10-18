import assert from "node:assert/strict";
import { test } from "node:test";

import { reciprocalRankFusion } from "#/lib/fusion";

const hits = (...ids: string[]) => ids.map((id) => ({ id, score: 0 }));

test("a hit both lists rank well beats a single first place", () => {
	const fused = reciprocalRankFusion([
		hits("solo", "both"),
		hits("other", "both"),
	]);
	assert.equal(fused[0]?.id, "both");
	assert.deepEqual(fused[0]?.ranks, [2, 2]);
	assert.deepEqual(fused.find((hit) => hit.id === "solo")?.ranks, [1, null]);
});

test("scores are 1 / (k + rank), summed across lists", () => {
	const [top] = reciprocalRankFusion([hits("a"), hits("a")], 60);
	assert.equal(top?.score, 2 / 61);
});
