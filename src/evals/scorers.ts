import type { Evaluation } from "@langfuse/client";
import { generateText, Output } from "ai";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/client";
import { customers, recipes } from "#/db/schema";
import type { AgentOutput } from "#/evals/run-agent";
import { TODAY } from "#/lib/clock";
import type { EvalExpected, EvalInput } from "#/lib/evals";
import { MODELS } from "#/lib/models";
import { throttled } from "#/server/throttle";

// Scorers turn one agent run into numbers between 0 and 1. Code checks come
// first: they're exact, free and fast. The LLM judge handles what code can't
// (does this answer meet the criteria? is it supported by the tool results?).

type Score = { name: string; value: number; comment: string; gate: boolean };

const score = (
	name: string,
	value: number,
	comment: string,
	gate = true,
): Score => ({ name, value, comment, gate });

const toEvaluation = ({ name, value, comment }: Score): Evaluation => ({
	name,
	value,
	comment,
	dataType: "NUMERIC",
});

// Bump whenever scoring changes, or anything else that makes old results
// incomparable (case checks, the context every prompt version gets). Scores
// from different versions are never mixed: the loop re-runs the baseline.
// v2: the judge sees the agent's instructions and every source.
// v3: the reporting-window case accepts "7-day"; the customer context says
//     until when a plan is paused.
// v4: the judge is Claude Sonnet 5.5 instead of Gemini 2.5 Flash.
// v5: the judge sees long tool outputs in full and the tools' descriptions.
// v6: the judge sees every source's full text and full recipe details.
export const SCORER_VERSION = 6;

// --- Code checks -------------------------------------------------------------

function toolChecks(output: AgentOutput, expected: EvalExpected): Score[] {
	const rule = expected.checks?.tools;
	if (!rule) return [];
	const called = new Set(output.toolCalls.map((call) => call.name));
	const missing = (rule.required ?? []).filter((name) => !called.has(name));
	const forbidden = (rule.forbidden ?? []).filter((name) => called.has(name));
	const problems = [
		missing.length ? `didn't call ${missing.join(", ")}` : "",
		forbidden.length ? `called forbidden ${forbidden.join(", ")}` : "",
	].filter(Boolean);
	return [
		score(
			"tools",
			problems.length ? 0 : 1,
			problems.join("; ") || `called: ${[...called].join(", ") || "none"}`,
		),
	];
}

function textChecks(output: AgentOutput, expected: EvalExpected): Score[] {
	const rule = expected.checks?.text;
	if (!rule) return [];
	const answer = output.text.toLowerCase();
	const missing = (rule.include ?? []).filter((group) =>
		(Array.isArray(group) ? group : [group]).every(
			(phrase) => !answer.includes(phrase.toLowerCase()),
		),
	);
	const present = (rule.exclude ?? []).filter((phrase) =>
		answer.includes(phrase.toLowerCase()),
	);
	const problems = [
		...missing.map(
			(group) =>
				`missing ${Array.isArray(group) ? group.map((p) => `"${p}"`).join(" or ") : `"${group}"`}`,
		),
		...present.map((phrase) => `contains "${phrase}"`),
	];
	return [
		score(
			"phrases",
			problems.length ? 0 : 1,
			problems.join("; ") || "all present",
		),
	];
}

function citationChecks(output: AgentOutput, expected: EvalExpected): Score[] {
	const cited = [
		...output.text.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g),
	].flatMap((match) =>
		(match[1] ?? "").split(",").map((n) => Number(n.trim())),
	);
	const required = expected.checks?.requireCitations ?? false;
	if (cited.length === 0 && !required) return [];
	if (cited.length === 0) return [score("citations", 0, "no citations")];
	const known = new Set(output.sources.map((source) => source.n));
	const invalid = [...new Set(cited.filter((n) => !known.has(n)))];
	return [
		score(
			"citations",
			invalid.length ? 0 : 1,
			invalid.length
				? `cited sources no tool returned: ${invalid.join(", ")}`
				: `cited ${[...new Set(cited)].join(", ")}`,
		),
	];
}

function recallCheck(output: AgentOutput, expected: EvalExpected): Score[] {
	const wanted = expected.checks?.sources;
	if (!wanted?.length) return [];
	const found = new Set(output.sources.map((source) => source.sourceId));
	const hits = wanted.filter((id) => found.has(id));
	return [
		score(
			"retrieval-recall",
			hits.length / wanted.length,
			`found ${hits.length}/${wanted.length}${hits.length < wanted.length ? `, missed ${wanted.filter((id) => !found.has(id)).join(", ")}` : ""}`,
			false,
		),
	];
}

function creditCheck(output: AgentOutput, expected: EvalExpected): Score[] {
	const wanted = expected.checks?.credit;
	if (!wanted) return [];
	const attempts = output.toolCalls.filter(
		(call) => call.name === "issueCredit",
	);
	const match = attempts.find(
		(call) =>
			call.input.orderId === wanted.orderId &&
			call.input.recipeId === wanted.recipeId,
	);
	return [
		score(
			"credit",
			match ? 1 : 0,
			match
				? `attempted ${wanted.recipeId} on ${wanted.orderId}: ${match.outcome}${match.reason ? ` (${match.reason})` : ""}`
				: attempts.length
					? `wrong credit: ${attempts.map((call) => JSON.stringify(call.input)).join("; ")}`
					: "never called issueCredit",
		),
	];
}

// Recipes are matched by title in the answer, with or without a parenthetical
// ("Silken Sundubu Jjigae (Spicy Soft Tofu Stew)"). Short or paraphrased
// mentions are missed: a known limitation of string matching.
type CatalogRecipe = {
	id: string;
	title: string;
	cuisine: string;
	minutes: number;
	dietTags: string[];
	allergens: string[];
};
let catalog: Promise<CatalogRecipe[]> | null = null;
function loadCatalog() {
	catalog ??= db
		.select({
			id: recipes.id,
			title: recipes.title,
			cuisine: recipes.cuisine,
			prep: recipes.prepMinutes,
			cook: recipes.cookMinutes,
			dietTags: recipes.dietTags,
			allergens: recipes.allergens,
		})
		.from(recipes)
		.then((rows) =>
			rows.map(({ prep, cook, ...row }) => ({ ...row, minutes: prep + cook })),
		);
	return catalog;
}

async function mentionedRecipes(text: string) {
	const answer = text.toLowerCase();
	return (await loadCatalog()).filter((recipe) => {
		const full = recipe.title.toLowerCase();
		const short = full.replace(/\s*\(.*\)\s*$/, "");
		return (
			answer.includes(full) || (short.length > 12 && answer.includes(short))
		);
	});
}

async function recipeChecks(
	input: EvalInput,
	output: AgentOutput,
	expected: EvalExpected,
): Promise<Score[]> {
	const scores: Score[] = [];
	const named = await mentionedRecipes(output.text);
	const rule = expected.checks?.recipes;
	if (rule) {
		const problems: string[] = [];
		if (named.length < (rule.min ?? 1)) {
			problems.push(
				`named ${named.length} catalog recipe(s), expected ${rule.min ?? 1}+`,
			);
		}
		for (const recipe of named) {
			if (
				rule.cuisine &&
				recipe.cuisine.toLowerCase() !== rule.cuisine.toLowerCase()
			) {
				problems.push(`${recipe.title} is ${recipe.cuisine}`);
			}
			if (rule.maxMinutes && recipe.minutes > rule.maxMinutes) {
				problems.push(`${recipe.title} takes ${recipe.minutes} min`);
			}
			const missingTags = (rule.dietTags ?? []).filter(
				(tag) => !recipe.dietTags.includes(tag),
			);
			if (missingTags.length) {
				problems.push(`${recipe.title} isn't ${missingTags.join(", ")}`);
			}
		}
		scores.push(
			score(
				"recipe-constraints",
				problems.length ? 0 : 1,
				problems.join("; ") ||
					`named: ${named.map((recipe) => recipe.title).join(", ")}`,
			),
		);
	}

	// Allergen safety applies to every case with a signed-in, allergic customer:
	// naming a recipe that contains their allergen is only OK with a warning.
	if (input.customerId && named.length) {
		const [customer] = await db
			.select({ allergies: customers.allergies })
			.from(customers)
			.where(eq(customers.id, input.customerId));
		const allergies = customer?.allergies ?? [];
		if (allergies.length) {
			const answer = output.text.toLowerCase();
			const unsafe = named.filter((recipe) =>
				recipe.allergens.some(
					(allergen) =>
						allergies.includes(allergen) &&
						!answer.includes(allergen.replace(/s$/, "").replace("-", " ")),
				),
			);
			scores.push(
				score(
					"allergen-safety",
					unsafe.length ? 0 : 1,
					unsafe.length
						? `named ${unsafe.map((recipe) => recipe.title).join(", ")} without warning about ${allergies.join(", ")}`
						: "no unflagged allergens",
				),
			);
		}
	}
	return scores;
}

// --- LLM judge ---------------------------------------------------------------

const judgeModel = throttled(MODELS.judge);

const verdictSchema = z.object({
	correctnessReasoning: z.string(),
	correctness: z.number().int().min(1).max(5),
	faithfulnessReasoning: z.string(),
	faithfulness: z.number().int().min(1).max(5),
});

const truncate = (value: unknown, max: number) => {
	const text = typeof value === "string" ? value : JSON.stringify(value);
	return text.length > max ? `${text.slice(0, max)}…` : text;
};

async function judge(
	input: EvalInput,
	output: AgentOutput,
	expected: EvalExpected,
): Promise<Score[]> {
	// The judge must see what the agent saw. Each cut here once made it call
	// correct answers invented: raw JSON truncated at 2,000 characters hid
	// sources 4-6, each source cut at 400 characters hid prices further down a
	// chunk, and account JSON cut at 2,500 hid orders. Chunks are short (at
	// most ~1,200 characters), so they're shown whole.
	const describeOutput = (value: unknown) => {
		const sources = (value as { sources?: AgentOutput["sources"] } | undefined)
			?.sources;
		if (!sources?.length) return truncate(value ?? "", 15_000);
		const { sources: _, ...rest } = value as Record<string, unknown>;
		return [
			...sources.map(
				(source) =>
					`[${source.n}] ${source.title}${source.section ? ` › ${source.section}` : ""}: ${truncate(source.text, 4000)}`,
			),
			Object.keys(rest).length ? truncate(rest, 15_000) : "",
		]
			.filter(Boolean)
			.join("\n  ");
	};
	const toolLog = output.toolCalls
		.map(
			(call) =>
				`- ${call.name}(${truncate(call.input, 300)}) → ${call.outcome}${call.reason ? `: ${call.reason}` : ""}\n  ${describeOutput(call.output)}`,
		)
		.join("\n");
	const { output: verdict } = await generateText({
		model: judgeModel,
		maxRetries: 4,
		output: Output.object({ schema: verdictSchema }),
		telemetry: { functionId: "eval-judge" },
		prompt: `You grade an AI assistant for Mise, a meal-kit company. Today is ${TODAY} (fixed for tests).

<assistant_instructions>
${output.instructions}
</assistant_instructions>

<assistant_tools>
${Object.entries(output.toolDescriptions)
	.map(([name, description]) => `- ${name}: ${description}`)
	.join("\n")}
</assistant_tools>

<conversation>
${input.transcript.map((turn) => `${turn.role}: ${turn.text}`).join("\n")}
</conversation>

<tool_calls>
${toolLog || "(none)"}
</tool_calls>

<answer>
${output.text || "(no text)"}
</answer>

<criteria>
${expected.criteria}
</criteria>
${expected.reference ? `\n<reference_answer>\n${expected.reference}\n</reference_answer>\n` : ""}
Grade two things from 1 to 5. Write your reasoning before each score.

correctness: how well the answer and the actions taken meet every point of the criteria. 5 = all points met, 4 = a minor omission, 3 = partly met, 2 = mostly not met, 1 = wrong or harmful.

faithfulness: whether every Mise-specific claim in the answer (recipes, prices, policies, orders, amounts, dates) is supported by the tool calls above, or stated in the assistant's instructions or its tools' descriptions. 5 = everything supported, 3 = a minor unsupported detail, 1 = invented facts. General cooking knowledge that doesn't contradict the tools is fine. If the answer makes no Mise-specific claims, give 5.

Notes: the customer can't reply during this test, so a tool call with outcome "approval-requested" counts as the action having been requested, but the answer must not claim it was completed. "denied" means the system's policy refused the call, with the reason shown.`,
	});
	return [
		score(
			"correctness",
			(verdict.correctness - 1) / 4,
			`${verdict.correctness}/5: ${verdict.correctnessReasoning}`,
		),
		score(
			"faithfulness",
			(verdict.faithfulness - 1) / 4,
			`${verdict.faithfulness}/5: ${verdict.faithfulnessReasoning}`,
		),
	];
}

// --- Everything for one case -------------------------------------------------

export async function scoreCase(params: {
	input: EvalInput;
	output: AgentOutput | undefined;
	expectedOutput?: EvalExpected;
}): Promise<Evaluation[]> {
	const { input, output, expectedOutput } = params;
	if (!output || !expectedOutput) {
		return [toEvaluation(score("pass", 0, "the agent run failed"))];
	}
	const scores = [
		...toolChecks(output, expectedOutput),
		...textChecks(output, expectedOutput),
		...citationChecks(output, expectedOutput),
		...recallCheck(output, expectedOutput),
		...creditCheck(output, expectedOutput),
		...(await recipeChecks(input, output, expectedOutput)),
		...(await judge(input, output, expectedOutput)),
	];
	const failed = scores.filter((entry) => {
		if (!entry.gate) return false;
		if (entry.name === "correctness") return entry.value < 0.75;
		if (entry.name === "faithfulness") return entry.value < 0.5;
		return entry.value < 1;
	});
	return [
		...scores,
		score(
			"pass",
			failed.length ? 0 : 1,
			failed.length
				? `failed: ${failed.map((entry) => entry.name).join(", ")}`
				: "passed",
		),
	].map(toEvaluation);
}
