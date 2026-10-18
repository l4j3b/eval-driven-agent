// Saves what lives only in Langfuse to files, so a fresh setup starts where
// this one is:
//
//   prompts/v<n>.md, prompts/versions.json   every version of the agent prompt,
//                                            with its labels and changelog
//   evals/feedback-cases.json                eval cases added from user feedback
//
//   npm run seed:export
//
// `npm run prompt:seed` and `npm run eval:seed` load them back. (Chunk
// contexts are saved by `npm run index` itself, in data/chunk-contexts.json.)
import { writeFile } from "node:fs/promises";

import { EVAL_DATASET, type EvalItemMetadata } from "#/lib/evals";
import { AGENT_PROMPT_NAME } from "#/lib/prompts";
import { langfuse } from "#/server/langfuse.server";
import type { PromptManifest } from "./seed-prompts";

const json = (value: unknown) => `${JSON.stringify(value, null, "\t")}\n`;

const versions =
	(await langfuse.api.prompts.list({ name: AGENT_PROMPT_NAME })).data.find(
		(meta) => meta.name === AGENT_PROMPT_NAME,
	)?.versions ?? [];
const manifest: PromptManifest = [];
for (const version of [...versions].sort((a, b) => a - b)) {
	const prompt = await langfuse.prompt.get(AGENT_PROMPT_NAME, {
		type: "text",
		version,
		cacheTtlSeconds: 0,
	});
	const file = `v${version}.md`;
	await writeFile(`prompts/${file}`, `${prompt.prompt}\n`);
	manifest.push({
		version,
		file,
		labels: prompt.labels.filter((label) => label !== "latest"),
		commitMessage: prompt.commitMessage ?? null,
		config: (prompt.config ?? {}) as Record<string, unknown>,
	});
}
await writeFile("prompts/versions.json", json(manifest));
console.log(
	`prompts: ${manifest.map((entry) => `v${entry.version} [${entry.labels.join(", ") || "no label"}]`).join(", ")}`,
);

// Hand-written cases live in src/evals/cases.ts; only the ones that came from
// feedback exist nowhere else. Trace links are dropped: those traces stay in
// this Langfuse.
const dataset = await langfuse.dataset.get(EVAL_DATASET);
const fromFeedback = dataset.items
	.filter(
		(item) =>
			item.status === "ACTIVE" &&
			(item.metadata as EvalItemMetadata | undefined)?.source !== "seed",
	)
	.map(({ id, input, expectedOutput, metadata }) => ({
		id,
		input,
		expectedOutput,
		metadata,
	}));
await writeFile("evals/feedback-cases.json", json(fromFeedback));
console.log(`eval cases from feedback: ${fromFeedback.length}`);
