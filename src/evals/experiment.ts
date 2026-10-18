import { mkdir, writeFile } from "node:fs/promises";

import { type AgentOutput, runAgent } from "#/evals/run-agent";
import { SCORER_VERSION, scoreCase } from "#/evals/scorers";
import {
	EVAL_DATASET,
	type EvalCategory,
	type EvalExpected,
	type EvalInput,
	type EvalItemMetadata,
	type EvalSplit,
} from "#/lib/evals";
import { MODELS, shortModel } from "#/lib/models";
import type { PromptSelector } from "#/server/agent/prompt";
import { langfuse } from "#/server/langfuse.server";

export type ExperimentOptions = {
	prompt: PromptSelector;
	// Run another agent model than the prompt version's (an experiment).
	model?: string;
	split?: EvalSplit | "all";
	category?: EvalCategory;
	ids?: string[];
	limit?: number;
	concurrency?: number;
};

export type CaseResult = {
	id: string;
	category: string;
	split: EvalSplit;
	source: string;
	question: string;
	transcript?: EvalInput["transcript"];
	criteria?: string;
	pass: boolean;
	scores: Record<string, number>;
	comments: Record<string, string>;
	answer: string;
	// What the agent called, with what, and how it went (inputs are small:
	// queries, filters, ids). Older reports don't have inputs.
	toolCalls: {
		name: string;
		outcome: string;
		input?: Record<string, unknown>;
		reason?: string;
	}[];
	latencyMs?: number;
	traceId?: string;
};

export type ExperimentReport = {
	runName: string;
	split?: EvalSplit | "all";
	// Missing on reports from before scorer versions existed: those are v1.
	scorerVersion?: number;
	prompt: PromptSelector & { resolvedVersion?: number; modelOverride?: string };
	// What ran. `agent` is what the runs actually used: the prompt version's
	// model, the default, or the override.
	models: {
		agent: string;
		judge: string;
		embedding?: string;
		rerank?: string;
	};
	startedAt: string;
	finishedAt: string;
	datasetRunUrl?: string;
	cases: CaseResult[];
	summary: {
		cases: number;
		// Cases where the agent or the judge failed to run (rate limits, an
		// exhausted budget, outages). A run with any isn't a measurement.
		errors?: number;
		passRate: number;
		means: Record<string, number>;
		byCategory: Record<string, { cases: number; passRate: number }>;
		bySplit: Record<string, { cases: number; passRate: number }>;
	};
};

export const promptLabel = (prompt: PromptSelector) =>
	prompt.version ? `v${prompt.version}` : (prompt.label ?? "production");

const meta = (item: { metadata?: unknown }) =>
	(item.metadata ?? {}) as Partial<EvalItemMetadata>;
// Cases from user feedback have no split yet; they count as training data.
const splitOf = (item: { metadata?: unknown }): EvalSplit =>
	meta(item).split ?? "train";

export async function loadEvalItems(
	options: Omit<ExperimentOptions, "prompt">,
) {
	const dataset = await langfuse.dataset.get(EVAL_DATASET);
	let items = dataset.items.filter((item) => item.status === "ACTIVE");
	if (options.split && options.split !== "all") {
		items = items.filter((item) => splitOf(item) === options.split);
	}
	if (options.category) {
		items = items.filter((item) => meta(item).category === options.category);
	}
	if (options.ids?.length) {
		items = items.filter((item) =>
			options.ids?.some((id) => item.id === id || item.id === `seed-${id}`),
		);
	}
	return options.limit ? items.slice(0, options.limit) : items;
}

const mean = (values: number[]) =>
	values.length
		? values.reduce((total, value) => total + value, 0) / values.length
		: 0;

function summarize(cases: CaseResult[]): ExperimentReport["summary"] {
	const names = [
		...new Set(cases.flatMap((result) => Object.keys(result.scores))),
	];
	const group = (key: (result: CaseResult) => string) => {
		const groups: Record<string, { cases: number; passRate: number }> = {};
		for (const name of new Set(cases.map(key))) {
			const members = cases.filter((result) => key(result) === name);
			groups[name] = {
				cases: members.length,
				passRate: mean(members.map((result) => (result.pass ? 1 : 0))),
			};
		}
		return groups;
	};
	return {
		cases: cases.length,
		errors: cases.filter(
			(result) => result.comments.error || result.scores.pass === undefined,
		).length,
		passRate: mean(cases.map((result) => (result.pass ? 1 : 0))),
		means: Object.fromEntries(
			names.map((name) => [
				name,
				mean(
					cases
						.map((result) => result.scores[name])
						.filter((value): value is number => value !== undefined),
				),
			]),
		),
		byCategory: group((result) => result.category),
		bySplit: group((result) => result.split),
	};
}

// Runs the agent with the given prompt over the eval cases as a Langfuse
// experiment: every case becomes a trace linked to a dataset run, with its
// scores attached, so runs can be compared in the Langfuse UI. Returns a
// local report too, which the CLI prints and the optimizer (phase 6) reads.
export async function runExperiment(
	options: ExperimentOptions,
): Promise<ExperimentReport & { file: string }> {
	const items = await loadEvalItems(options);
	if (items.length === 0) throw new Error("No eval cases match those filters.");
	const label = `${promptLabel(options.prompt)}${options.model ? `@${shortModel(options.model)}` : ""}`;
	const startedAt = new Date().toISOString();
	const runName = `${label} · ${options.split ?? "all"} · ${startedAt.slice(0, 16)}`;

	const result = await langfuse.experiment.run({
		name: "mise-agent",
		runName,
		description: `Prompt ${label} on ${items.length} cases (${options.split ?? "all"}).`,
		metadata: {
			prompt: options.prompt,
			split: options.split ?? "all",
			modelOverride: options.model,
			judgeModel: MODELS.judge,
		},
		data: items,
		task: async ({ input }) => {
			try {
				return await runAgent(
					input as EvalInput,
					options.prompt,
					options.model,
				);
			} catch (error) {
				return {
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
		evaluators: [
			async ({ input, output, expectedOutput }) =>
				scoreCase({
					input: input as EvalInput,
					output:
						output && !("error" in output)
							? (output as AgentOutput)
							: undefined,
					expectedOutput: expectedOutput as EvalExpected,
				}),
		],
		maxConcurrency: options.concurrency ?? 2,
	});

	const cases: CaseResult[] = result.itemResults.map((itemResult) => {
		const item = itemResult.item as {
			id?: string;
			metadata?: unknown;
			input?: unknown;
			expectedOutput?: unknown;
		};
		const output = itemResult.output as
			| AgentOutput
			| { error: string }
			| undefined;
		const run = output && !("error" in output) ? output : undefined;
		const scores: Record<string, number> = {};
		const comments: Record<string, string> = {};
		for (const evaluation of itemResult.evaluations) {
			scores[evaluation.name] = Number(evaluation.value);
			comments[evaluation.name] = evaluation.comment ?? "";
		}
		// Dataset items keep their input on the item itself.
		const input = (itemResult.input ?? item.input) as EvalInput;
		return {
			id: (item.id ?? "").replace(/^seed-/, ""),
			category: meta(item).category ?? "feedback",
			split: splitOf(item),
			source: meta(item).source ?? "seed",
			question: input.transcript.at(-1)?.text ?? "",
			transcript: input.transcript,
			criteria: (
				(itemResult.expectedOutput ?? item.expectedOutput) as
					| EvalExpected
					| undefined
			)?.criteria,
			pass: scores.pass === 1,
			scores,
			comments: {
				...comments,
				...(output && "error" in output ? { error: output.error } : {}),
			},
			answer: run?.text ?? "",
			toolCalls:
				run?.toolCalls.map(({ name, outcome, input, reason }) => ({
					name,
					outcome,
					input,
					...(reason ? { reason } : {}),
				})) ?? [],
			latencyMs: run?.latencyMs,
			traceId: itemResult.traceId,
		};
	});

	const outputs = result.itemResults.map(
		(itemResult) => itemResult.output as Partial<AgentOutput> | undefined,
	);
	const resolvedVersion = outputs
		.map((output) => output?.prompt?.version)
		.find(Boolean);
	const agentModel =
		outputs.map((output) => output?.model).find(Boolean) ??
		options.model ??
		MODELS.agent;
	const report: ExperimentReport = {
		runName,
		split: options.split ?? "all",
		scorerVersion: SCORER_VERSION,
		prompt: {
			...options.prompt,
			resolvedVersion,
			...(options.model ? { modelOverride: options.model } : {}),
		},
		models: {
			agent: agentModel,
			judge: MODELS.judge,
			embedding: MODELS.embedding,
			rerank: MODELS.rerank,
		},
		startedAt,
		finishedAt: new Date().toISOString(),
		datasetRunUrl: result.datasetRunUrl,
		cases: cases.sort((a, b) => a.id.localeCompare(b.id)),
		summary: summarize(cases),
	};

	const file = `${startedAt.replace(/[:.]/g, "-")}-${label}.json`;
	await mkdir("evals/results", { recursive: true });
	await writeFile(
		`evals/results/${file}`,
		`${JSON.stringify(report, null, "\t")}\n`,
	);
	return { ...report, file };
}
