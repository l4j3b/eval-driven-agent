// Uploads the eval cases to the Langfuse dataset (creating it if needed): the
// hand-written ones in src/evals/cases.ts, and the ones saved from user
// feedback in evals/feedback-cases.json (`npm run seed:export`). Item ids are
// stable, so re-running updates cases in place.
//
//   npm run eval:seed
import { readFile } from "node:fs/promises";

import { EVAL_CASES } from "#/evals/cases";
import { EVAL_DATASET, type EvalItemMetadata } from "#/lib/evals";
import { ensureEvalDataset, langfuse } from "#/server/langfuse.server";

await ensureEvalDataset();

for (const testCase of EVAL_CASES) {
	await langfuse.dataset.createItem({
		id: `seed-${testCase.id}`,
		datasetName: EVAL_DATASET,
		input: testCase.input,
		expectedOutput: testCase.expected,
		metadata: {
			source: "seed",
			category: testCase.category,
			split: testCase.split,
		} satisfies EvalItemMetadata,
	});
}

// Cases from feedback, as exported. Missing file: none saved yet.
const fromFeedback = JSON.parse(
	await readFile("evals/feedback-cases.json", "utf8").catch(() => "[]"),
) as {
	id: string;
	input: unknown;
	expectedOutput: unknown;
	metadata: unknown;
}[];
for (const item of fromFeedback) {
	await langfuse.dataset.createItem({ datasetName: EVAL_DATASET, ...item });
}

const tally = new Map<string, number>();
for (const testCase of EVAL_CASES) {
	const key = `${testCase.category}/${testCase.split}`;
	tally.set(key, (tally.get(key) ?? 0) + 1);
}
const counts = [...tally]
	.map(([key, count]) => `${key} ${count}`)
	.sort()
	.join(", ");
console.log(
	`Uploaded ${EVAL_CASES.length} hand-written cases (${counts}) and ${fromFeedback.length} from feedback to ${EVAL_DATASET}.`,
);
