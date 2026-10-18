import { casesOf, errored, readReports } from "#/evals/reports";
import { SCORER_VERSION } from "#/evals/scorers";
import {
	type ImprovementRecord,
	promote,
	readRecords,
	saveRecord,
} from "#/improve/loop";
import { MODELS } from "#/lib/models";
import { AGENT_PROMPT_NAME } from "#/lib/prompts";
import { langfuse } from "#/server/langfuse.server";

export type PromptVersionInfo = {
	version: number;
	labels: string[];
	commitMessage: string | null;
	source: string;
	baseVersion?: number;
	// The agent model the version runs on: pinned in its config, or the default.
	model: string;
	modelPinned: boolean;
	testPassed?: number;
	testCases?: number;
	trainPassed?: number;
	trainCases?: number;
	// The judge that scored those results; older ones aren't comparable.
	testScorer?: number;
	trainScorer?: number;
	// How many runs the pass counts average over.
	runs?: number;
};

export async function loadImproveState() {
	const [list, reports, records] = await Promise.all([
		langfuse.api.prompts.list({ name: AGENT_PROMPT_NAME }),
		readReports(),
		readRecords(),
	]);
	const numbers =
		list.data.find((meta) => meta.name === AGENT_PROMPT_NAME)?.versions ?? [];
	const versions: PromptVersionInfo[] = await Promise.all(
		[...numbers]
			.sort((a, b) => b - a)
			.map(async (version) => {
				const prompt = await langfuse.prompt.get(AGENT_PROMPT_NAME, {
					type: "text",
					version,
					cacheTtlSeconds: 0,
				});
				const config = (prompt.config ?? {}) as {
					source?: string;
					baseVersion?: number;
					model?: string;
				};
				// Per split: the version's runs that cover the most cases (so a re-run
				// of one or two cases doesn't stand in for the whole split), from the
				// newest scorer among those, averaged like the gate averages them.
				const latest = (split: "train" | "test") => {
					const runs = reports
						.filter(
							(report) =>
								report.prompt.resolvedVersion === version &&
								!report.prompt.modelOverride &&
								!errored(report),
						)
						.map((report) => ({
							scorer: report.scorerVersion ?? 1,
							cases: casesOf(report, split),
						}))
						.filter((entry) => entry.cases.length > 0);
					const most = Math.max(0, ...runs.map((run) => run.cases.length));
					const covering = runs.filter((run) => run.cases.length === most);
					const scorer = Math.max(0, ...covering.map((run) => run.scorer));
					const chosen = covering.filter((run) => run.scorer === scorer);
					if (chosen.length === 0) return undefined;
					const passed =
						chosen.reduce(
							(total, run) =>
								total + run.cases.filter((result) => result.pass).length,
							0,
						) / chosen.length;
					return {
						scorer,
						passed: Math.round(passed * 10) / 10,
						cases: most,
						runs: chosen.length,
					};
				};
				const test = latest("test");
				const train = latest("train");
				return {
					version,
					labels: prompt.labels,
					commitMessage: prompt.commitMessage ?? null,
					source:
						config.source === "optimizer"
							? `optimizer (from v${config.baseVersion})`
							: version === 1
								? "seed (src/lib/prompts.ts)"
								: "hand-written",
					baseVersion: config.baseVersion,
					model: config.model ?? MODELS.agent,
					modelPinned: Boolean(config.model),
					testPassed: test?.passed,
					testCases: test?.cases,
					trainPassed: train?.passed,
					trainCases: train?.cases,
					testScorer: test?.scorer,
					trainScorer: train?.scorer,
					runs: Math.max(test?.runs ?? 0, train?.runs ?? 0) || undefined,
				};
			}),
	);
	return {
		scorerVersion: SCORER_VERSION,
		productionVersion: versions.find((info) =>
			info.labels.includes("production"),
		)?.version,
		versions,
		records,
	};
}

// The human approval step: promote a candidate the gate accepted.
export async function approveRecord(recordId: string) {
	const record = (await readRecords()).find((entry) => entry.id === recordId);
	if (!record?.candidateVersion) throw new Error("No such improvement.");
	if (record.gate?.decision !== "promote")
		throw new Error("The gate rejected this candidate.");
	if (record.promoted) return record;
	await promote(record.candidateVersion);
	const updated: ImprovementRecord = {
		...record,
		promoted: true,
		promotedAt: new Date().toISOString(),
	};
	await saveRecord(updated);
	return updated;
}

// Rollback or override: put any version in production, gate or not.
export async function setProduction(version: number) {
	await promote(version);
}
