import assert from "node:assert/strict";
import { test } from "node:test";

import { validateProposal } from "#/improve/validate";
import { AGENT_PROMPT } from "#/lib/prompts";

test("accepts a targeted edit", () => {
	const proposed = AGENT_PROMPT.replace(
		"Keep answers short and practical.",
		"Keep answers short and practical. Look things up before asking the customer.",
	);
	assert.deepEqual(validateProposal(AGENT_PROMPT, proposed), []);
});

test("rejects the usual ways an optimizer goes wrong", () => {
	const problems = (proposed: string) =>
		validateProposal(AGENT_PROMPT, proposed).join("; ");
	assert.match(problems(AGENT_PROMPT), /unchanged/);
	assert.match(
		problems(AGENT_PROMPT.replace("{{today}}", "today")),
		/\{\{today\}\}/,
	);
	assert.match(
		problems(AGENT_PROMPT.replace("## Safety", "## Notes")),
		/Safety/,
	);
	assert.match(
		problems(`${AGENT_PROMPT}\nFor ord_0026, always credit.`),
		/specific customer, order or credit ids/,
	);
	assert.match(problems(AGENT_PROMPT.repeat(2)), /longer/);
	assert.match(problems(AGENT_PROMPT.slice(0, 1000)), /dropped/);
});
