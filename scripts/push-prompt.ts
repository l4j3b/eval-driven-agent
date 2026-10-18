// Uploads the system prompt in src/lib/prompts.ts to Langfuse as a new version
// of "mise-agent" and labels it "production", unless production already has
// exactly this text.
//
//   npm run prompt:push
//
// After this, edit and promote prompts in Langfuse (or let the optimizer in
// phase 6 do it); the code copy stays as the fallback.
import { LangfuseClient } from "@langfuse/client";

import { AGENT_PROMPT, AGENT_PROMPT_NAME } from "#/lib/prompts";

const langfuse = new LangfuseClient();

const current = await langfuse.prompt
	.get(AGENT_PROMPT_NAME, { label: "production", cacheTtlSeconds: 0 })
	.catch(() => null);

if (current?.prompt === AGENT_PROMPT) {
	console.log(
		`${AGENT_PROMPT_NAME} v${current.version} is already production and identical.`,
	);
} else {
	const created = await langfuse.prompt.create({
		name: AGENT_PROMPT_NAME,
		type: "text",
		prompt: AGENT_PROMPT,
		labels: ["production"],
		commitMessage: "From src/lib/prompts.ts",
	});
	console.log(`Created ${AGENT_PROMPT_NAME} v${created.version} (production).`);
}
