import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CaseResult } from "#/evals/experiment";
import { gate } from "#/improve/gate";

const result = (
	id: string,
	split: "train" | "test",
	pass: boolean,
	category = "knowledge",
): CaseResult => ({
	id,
	split,
	pass,
	category,
	source: "seed",
	question: id,
	scores: { correctness: pass ? 1 : 0 },
	comments: {},
	answer: "",
	toolCalls: [],
});

const side = (version: number, cases: CaseResult[]) => ({
	version,
	scorerVersion: 2,
	cases,
});

describe("gate", () => {
	test("promotes when more test cases pass and nothing critical breaks", () => {
		const decision = gate(
			side(1, [result("a", "test", false), result("b", "test", true)]),
			side(2, [result("a", "test", true), result("b", "test", true)]),
		);
		assert.equal(decision.decision, "promote");
		assert.deepEqual(decision.fixed, ["a"]);
		assert.equal(decision.candidate.passed, 2);
	});

	test("rejects a tie: one run is too noisy to call it better", () => {
		const decision = gate(
			side(1, [result("a", "test", false), result("b", "test", true)]),
			side(2, [result("a", "test", true), result("b", "test", false)]),
		);
		assert.equal(decision.decision, "reject");
	});

	test("rejects a broken critical case even in the train split", () => {
		const decision = gate(
			side(1, [
				result("a", "test", false),
				result("credit", "train", true, "actions"),
			]),
			side(2, [
				result("a", "test", true),
				result("credit", "train", false, "actions"),
			]),
		);
		assert.equal(decision.decision, "reject");
		assert.deepEqual(decision.criticalRegressions, ["credit"]);
	});

	test("a broken non-critical train case doesn't block if train holds up", () => {
		const decision = gate(
			side(1, [
				result("a", "test", false),
				result("price", "train", true),
				result("cozy", "train", false),
			]),
			side(2, [
				result("a", "test", true),
				result("price", "train", false),
				result("cozy", "train", true),
			]),
		);
		assert.equal(decision.decision, "promote");
		assert.deepEqual(decision.regressed, ["price"]);
	});

	test("compares only the cases both sides ran", () => {
		const decision = gate(
			side(1, [result("a", "test", true)]),
			side(2, [result("a", "test", true), result("new", "test", true)]),
		);
		assert.equal(decision.candidate.cases, 1);
		assert.equal(decision.decision, "reject");
	});

	test("averages over several runs", () => {
		// Baseline: a test case that passes 1 run in 3, and a critical case
		// that passes every time. Candidate: the test case passes every run,
		// the critical case slips once (a 1/3 drop, not "broken").
		const decision = gate(
			{
				...side(1, [
					result("a", "test", true),
					result("a", "test", false),
					result("a", "test", false),
					result("credit", "train", true, "actions"),
					result("credit", "train", true, "actions"),
					result("credit", "train", true, "actions"),
				]),
				runs: 3,
			},
			{
				...side(2, [
					result("a", "test", true),
					result("a", "test", true),
					result("a", "test", true),
					result("credit", "train", true, "actions"),
					result("credit", "train", true, "actions"),
					result("credit", "train", false, "actions"),
				]),
				runs: 3,
			},
		);
		assert.equal(decision.baseline.passed.toFixed(2), "0.33");
		assert.equal(decision.candidate.passed, 1);
		// 0.33 → 1 is less than one full case more.
		assert.equal(decision.decision, "reject");
		assert.deepEqual(decision.criticalRegressions, []);
		assert.deepEqual(decision.fixed, ["a"]);
	});

	test("+1 on test doesn't count if train loses a full case", () => {
		const decision = gate(
			side(1, [result("a", "test", false), result("b", "train", true)]),
			side(2, [result("a", "test", true), result("b", "train", false)]),
		);
		assert.equal(decision.decision, "reject");
		assert.match(decision.reasons.join(" "), /train cases passed dropped/);
	});

	test("averages in thirds still count as a full case", () => {
		const runs = (id: string, passes: boolean[]) =>
			passes.map((pass) => result(id, "test", pass));
		// 1/3 → 1/3 on "a", 1/3 → 3/3 on "b": +2/3; plus "c" 0/3 → 1/3: +1 in all.
		const decision = gate(
			{
				...side(1, [
					...runs("a", [true, false, false]),
					...runs("b", [true, false, false]),
					...runs("c", [false, false, false]),
				]),
				runs: 3,
			},
			{
				...side(2, [
					...runs("a", [true, false, false]),
					...runs("b", [true, true, true]),
					...runs("c", [true, false, false]),
				]),
				runs: 3,
			},
		);
		assert.equal(decision.decision, "promote");
	});

	test("refuses to compare results from different judges", () => {
		assert.throws(() =>
			gate(
				{ ...side(1, []), judge: "google/gemini-2.5-flash" },
				{ ...side(2, []), judge: "anthropic/claude-sonnet-5.5" },
			),
		);
	});

	test("refuses to compare different scorer versions", () => {
		assert.throws(() =>
			gate({ ...side(1, []), scorerVersion: 1 }, side(2, [])),
		);
	});
});
