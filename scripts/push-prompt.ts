// Uploads a system prompt to Langfuse as a new version of "mise-agent" with
// a label, unless the version carrying that label already has the same text.
//
//   npm run prompt:push                                       # src/lib/prompts.ts → production
//   npm run prompt:push -- --file prompts/v2.md --label candidate
//   npm run prompt:push -- --file prompts/v4.md --model anthropic/claude-sonnet-5.5
//
// --model pins the agent model in the version's config, so the version means
// "this text on this model"; without it the version runs on MODELS.agent.
//
// The app serves "production"; evals can run any label or version. Promoting a
// candidate means moving the "production" label (phase 6 automates that).
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { AGENT_PROMPT, AGENT_PROMPT_NAME } from "#/lib/prompts";
import { langfuse } from "#/server/langfuse.server";

const { values: args } = parseArgs({
	options: {
		file: { type: "string" },
		label: { type: "string", default: "production" },
		message: { type: "string" },
		model: { type: "string" },
	},
});

const label = args.label ?? "production";
const text = args.file
	? (await readFile(args.file, "utf8")).trimEnd()
	: AGENT_PROMPT;

const current = await langfuse.prompt
	.get(AGENT_PROMPT_NAME, { label, cacheTtlSeconds: 0 })
	.catch(() => null);

const currentModel = (current?.config as { model?: string } | null)?.model;
if (
	current &&
	!current.isFallback &&
	current.prompt === text &&
	currentModel === args.model
) {
	console.log(
		`${AGENT_PROMPT_NAME} v${current.version} already has label "${label}" and the same text.`,
	);
} else {
	const created = await langfuse.prompt.create({
		name: AGENT_PROMPT_NAME,
		type: "text",
		prompt: text,
		labels: [label],
		commitMessage: args.message ?? `From ${args.file ?? "src/lib/prompts.ts"}`,
		config: args.model ? { model: args.model } : {},
	});
	console.log(
		`Created ${AGENT_PROMPT_NAME} v${created.version} with label "${label}"${args.model ? ` on ${args.model}` : ""}.`,
	);
}
