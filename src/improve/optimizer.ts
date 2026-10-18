import { generateText, Output } from "ai";
import { z } from "zod";

import type { CaseResult } from "#/evals/experiment";
import { validateProposal } from "#/improve/validate";
import { MODELS } from "#/lib/models";
import { throttled } from "#/server/throttle";

// Reflective prompt optimization: show a model the current prompt, the cases
// it fails (with the judge's reasons), and the cases it passes, and ask for a
// revised prompt that fixes the underlying behaviors. The same idea as DSPy's
// and GEPA's reflective optimizers, in one call plus validation.

const optimizerModel = throttled(MODELS.optimizer);

const proposalSchema = z.object({
	analysis: z
		.string()
		.describe(
			"The failure patterns, and any failures the prompt can't fix, in 3 to 6 sentences",
		),
	changes: z.array(z.string()).describe("Each edit, in a short sentence"),
	prompt: z.string().describe("The complete revised prompt"),
});

export type Proposal = z.infer<typeof proposalSchema>;

const clip = (text: string, max: number) =>
	text.length > max ? `${text.slice(0, max)}…` : text;

function describeFailure(result: CaseResult) {
	const reasons = Object.entries(result.scores)
		.filter(
			([name, value]) =>
				name !== "pass" && name !== "retrieval-recall" && value < 1,
		)
		.map(([name]) => `- ${name}: ${clip(result.comments[name] ?? "", 500)}`);
	const transcript = (
		result.transcript ?? [{ role: "user" as const, text: result.question }]
	)
		.map((turn) => `${turn.role}: ${turn.text}`)
		.join("\n");
	return `<case id="${result.id}" category="${result.category}">
<conversation>
${transcript}
</conversation>
<criteria>${result.criteria ?? "(not recorded)"}</criteria>
<answer>${clip(result.answer || "(no text)", 1200)}</answer>
<tools>${result.toolCalls.map((call) => `${call.name} (${call.outcome})`).join(" → ") || "none"}</tools>
<why_it_failed>
${reasons.join("\n") || result.comments.error || result.comments.pass}
</why_it_failed>
</case>`;
}

export async function proposePrompt(input: {
	currentPrompt: string;
	failures: CaseResult[];
	passing: CaseResult[];
}): Promise<Proposal> {
	const base = `You improve the system prompt of an AI assistant for Mise, a meal-kit company. The assistant answers customers using the tools the prompt describes.

<current_prompt>
${input.currentPrompt}
</current_prompt>

These test cases fail with the current prompt. Each shows the conversation, what a good answer must do, what the assistant answered, the tools it called, and why it failed (automatic checks and a judge's reasoning):

<failures>
${input.failures.map(describeFailure).join("\n\n")}
</failures>

These cases pass today, and must keep passing:
<passing>
${input.passing.map((result) => `- ${result.id} [${result.category}]: ${result.criteria ?? result.question}`).join("\n")}
</passing>

Revise the prompt to fix the behaviors behind the failures, not the individual cases:
- Find the patterns (for example: asking permission instead of acting, skipping a tool, warning about the wrong things).
- Make targeted edits and keep everything that works: same structure, sections and voice.
- Keep the variables {{today}} and {{customer}} exactly as written.
- Never weaken a safety rule (allergies, untrusted content, policies, citations).
- Write general rules. Don't mention specific customers, orders, recipes, dates or amounts from the cases.
- If a failure comes from a tool, the data or the test itself rather than the prompt, say so in the analysis and leave it alone.`;

	let feedback = "";
	for (let attempt = 1; attempt <= 2; attempt++) {
		const { output } = await generateText({
			model: optimizerModel,
			maxRetries: 4,
			output: Output.object({ schema: proposalSchema }),
			telemetry: { functionId: "prompt-optimizer" },
			prompt: base + feedback,
		});
		const problems = validateProposal(input.currentPrompt, output.prompt);
		if (problems.length === 0) return output;
		feedback = `\n\nYour previous revision was rejected because ${problems.join("; ")}. Fix that and return the whole revision again.`;
	}
	throw new Error(
		`The optimizer's revisions kept failing validation.${feedback}`,
	);
}
