import assert from "node:assert/strict";
import { test } from "node:test";

import { lineDiff } from "#/lib/diff";

test("lineDiff keeps common lines and marks the rest", () => {
	assert.deepEqual(lineDiff("a\nb\nc", "a\nB\nc\nd"), [
		{ type: "same", text: "a" },
		{ type: "remove", text: "b" },
		{ type: "add", text: "B" },
		{ type: "same", text: "c" },
		{ type: "add", text: "d" },
	]);
});
