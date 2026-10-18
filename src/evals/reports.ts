import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { ExperimentReport } from "#/evals/experiment";
import type { EvalSplit } from "#/lib/evals";

const RESULTS = path.resolve("evals/results");

export type StoredReport = ExperimentReport & { file: string };

// Eval reports written by runExperiment, newest first.
export async function readReports(): Promise<StoredReport[]> {
	const files = await readdir(RESULTS).catch(() => [] as string[]);
	const reports = await Promise.all(
		files
			.filter((file) => file.endsWith(".json"))
			.map(async (file) => ({
				...(JSON.parse(
					await readFile(path.join(RESULTS, file), "utf8"),
				) as ExperimentReport),
				file,
			})),
	);
	return reports.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

// A run whose agent or judge calls failed measured nothing.
export const errored = (report: ExperimentReport) =>
	(report.summary.errors ?? 0) > 0;

// Every report for a prompt version that covers every given case of a split,
// newest first. Eval runs are slow on the free tier, so the loop reuses them;
// a report goes stale as soon as the dataset gains a case it didn't run. Runs
// with an overridden agent model are experiments, not the version itself,
// and errored runs aren't results at all.
export async function findReports(
	version: number,
	split: EvalSplit,
	caseIds: string[],
	scorerVersion: number,
): Promise<StoredReport[]> {
	return (await readReports()).filter((report) => {
		if (report.prompt.resolvedVersion !== version) return false;
		if (report.prompt.modelOverride || errored(report)) return false;
		if ((report.scorerVersion ?? 1) !== scorerVersion) return false;
		const covered = new Set(
			report.cases
				.filter((result) => result.split === split)
				.map((result) => result.id),
		);
		return caseIds.every((id) => covered.has(id));
	});
}

// Keeps only one split's cases and recomputes nothing: callers compare cases.
export function casesOf(report: ExperimentReport, split: EvalSplit) {
	return report.cases.filter((result) => result.split === split);
}
