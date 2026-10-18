import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadEvalItems, runExperiment } from "#/evals/experiment";
import { casesOf, findReports, type StoredReport } from "#/evals/reports";
import { SCORER_VERSION } from "#/evals/scorers";
import { type GateInput, type GateResult, gate } from "#/improve/gate";
import { proposePrompt } from "#/improve/optimizer";
import type { EvalSplit } from "#/lib/evals";
import { MODELS } from "#/lib/models";
import { AGENT_PROMPT_NAME } from "#/lib/prompts";
import { langfuse } from "#/server/langfuse.server";

const RECORDS = path.resolve("evals/improvements");

// The label the loop puts on its own proposals. "production" is what the app
// serves; "candidate" is for hand-written versions; neither is touched until
// a proposal passes the gate and is promoted.
const PROPOSED_LABEL = "proposed";

export type ImprovementRecord = {
	id: string;
	kind: "optimizer" | "manual";
	startedAt: string;
	finishedAt?: string;
	status: "nothing-to-improve" | "gated" | "failed";
	baseVersion: number;
	candidateVersion?: number;
	analysis?: string;
	changes?: string[];
	trainFailures?: string[];
	promptBefore?: string;
	promptAfter?: string;
	gate?: GateResult;
	// The models behind this record: each version's agent model (from its
	// eval runs), the judge that scored them, and the optimizer that wrote
	// the candidate (optimizer runs only).
	models?: {
		baselineAgent?: string;
		candidateAgent?: string;
		judge: string;
		optimizer?: string;
	};
	// Files in evals/results/ the gate compared: every run of each side.
	// (Records from before repeated runs name one file per split instead.)
	reports?: {
		baseline?: string[];
		candidate?: string[];
		baselineTrain?: string;
		baselineTest?: string;
		candidateTrain?: string;
		candidateTest?: string;
	};
	promoted: boolean;
	promotedAt?: string;
	error?: string;
};

type Log = (message: string) => void;

async function getPrompt(selector: { label?: string; version?: number }) {
	const prompt = await langfuse.prompt.get(AGENT_PROMPT_NAME, {
		type: "text",
		cacheTtlSeconds: 0,
		...(selector.version
			? { version: selector.version }
			: { label: selector.label }),
	});
	if (prompt.isFallback)
		throw new Error(
			"Langfuse is unreachable; refusing to optimize the fallback prompt.",
		);
	return prompt;
}

// Moving the "production" label is the whole deploy: the app picks the new
// version up within a minute (its prompt cache), and rollback is the same
// call with the old version.
export async function promote(version: number) {
	await langfuse.prompt.update({
		name: AGENT_PROMPT_NAME,
		version,
		newLabels: ["production"],
	});
}

export async function saveRecord(record: ImprovementRecord) {
	await mkdir(RECORDS, { recursive: true });
	await writeFile(
		path.join(RECORDS, `${record.id}.json`),
		`${JSON.stringify(record, null, "\t")}\n`,
	);
}

export async function readRecords(): Promise<ImprovementRecord[]> {
	const files = await readdir(RECORDS).catch(() => [] as string[]);
	const records = await Promise.all(
		files
			.filter((file) => file.endsWith(".json"))
			.map(
				async (file) =>
					JSON.parse(
						await readFile(path.join(RECORDS, file), "utf8"),
					) as ImprovementRecord,
			),
	);
	return records.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

async function caseIds(split: EvalSplit) {
	return (await loadEvalItems({ split })).map((item) =>
		item.id.replace(/^seed-/, ""),
	);
}

// Every valid run of this version that covers the split, newest first, so
// the gate can average over them; if there's none, runs one. On the free tier
// a run takes many minutes.
async function runsFor(
	version: number,
	split: EvalSplit,
	log: Log,
	scorerVersion = SCORER_VERSION,
): Promise<StoredReport[]> {
	const cached = await findReports(
		version,
		split,
		await caseIds(split),
		scorerVersion,
	);
	if (cached.length > 0) {
		log(`reusing ${cached.length} run(s) of v${version} on ${split}`);
		return cached;
	}
	log(`running v${version} on the ${split} split…`);
	return [await runExperiment({ prompt: { version }, split })];
}

// A version's cases across all its train and test runs.
function merged(
	version: number,
	train: StoredReport[],
	test: StoredReport[],
): GateInput {
	const first = train[0] ?? test[0];
	return {
		version,
		scorerVersion: first?.scorerVersion,
		judge: first?.models.judge,
		runs: Math.max(train.length, test.length),
		cases: [
			...train.flatMap((report) => casesOf(report, "train")),
			...test.flatMap((report) => casesOf(report, "test")),
		],
	};
}

const files = (...runs: StoredReport[][]) => [
	...new Set(runs.flat().map((report) => report.file)),
];

const newId = (kind: string) =>
	`${new Date().toISOString().replace(/[:.]/g, "-")}-${kind}`;

// One turn of the loop: production's train failures → optimizer → proposed
// version → test-split gate → record (and promotion, if allowed).
export async function improveOnce(options: {
	autoPromote?: boolean;
	log?: Log;
}): Promise<ImprovementRecord> {
	const log = options.log ?? console.log;
	const production = await getPrompt({ label: "production" });
	const record: ImprovementRecord = {
		id: newId("optimizer"),
		kind: "optimizer",
		startedAt: new Date().toISOString(),
		status: "failed",
		baseVersion: production.version,
		promptBefore: production.prompt,
		promoted: false,
	};
	try {
		log(`production is v${production.version}`);
		const trainRuns = await runsFor(production.version, "train", log);
		// The optimizer learns from the newest run's failures.
		const trainCases = casesOf(trainRuns[0] as StoredReport, "train");
		const failures = trainCases.filter((result) => !result.pass);
		record.trainFailures = failures.map((result) => result.id);
		record.reports = { baseline: files(trainRuns) };
		if (failures.length === 0) {
			record.status = "nothing-to-improve";
			log("every train case passes; nothing to improve");
			return record;
		}

		log(
			`${failures.length} train failure(s): ${record.trainFailures.join(", ")}`,
		);
		log("asking the optimizer for a revision…");
		const proposal = await proposePrompt({
			currentPrompt: production.prompt,
			failures,
			passing: trainCases.filter((result) => result.pass),
		});
		record.analysis = proposal.analysis;
		record.changes = proposal.changes;
		record.promptAfter = proposal.prompt;

		const productionModel = (production.config as { model?: string } | null)
			?.model;
		const created = await langfuse.prompt.create({
			name: AGENT_PROMPT_NAME,
			type: "text",
			prompt: proposal.prompt,
			labels: [PROPOSED_LABEL],
			commitMessage:
				`Optimizer from v${production.version}: ${proposal.changes.join("; ")}`.slice(
					0,
					500,
				),
			config: {
				// The proposal targets the same model as the version it improves.
				...(productionModel ? { model: productionModel } : {}),
				source: "optimizer",
				baseVersion: production.version,
				changes: proposal.changes,
			},
		});
		record.candidateVersion = created.version;
		log(`proposed v${created.version}: ${proposal.changes.join("; ")}`);

		const testRuns = await runsFor(production.version, "test", log);
		// The candidate runs on every case: improvement is judged on test, but a
		// broken safety, injection or action case blocks it in either split.
		log(`running v${created.version} on all cases…`);
		const candidateAll = await runExperiment({
			prompt: { version: created.version },
			split: "all",
		});
		record.reports = {
			baseline: files(trainRuns, testRuns),
			candidate: [candidateAll.file],
		};
		record.models = {
			baselineAgent: trainRuns[0]?.models.agent,
			candidateAgent: candidateAll.models.agent,
			judge: candidateAll.models.judge,
			optimizer: MODELS.optimizer,
		};
		record.gate = gate(
			merged(production.version, trainRuns, testRuns),
			merged(created.version, [candidateAll], [candidateAll]),
		);
		record.status = "gated";
		log(`gate: ${record.gate.decision}. ${record.gate.reasons.join("; ")}`);

		if (record.gate.decision === "promote" && options.autoPromote) {
			await promote(created.version);
			record.promoted = true;
			record.promotedAt = new Date().toISOString();
			log(`promoted v${created.version} to production`);
		}
		return record;
	} catch (error) {
		record.status = "failed";
		record.error = error instanceof Error ? error.message : String(error);
		throw error;
	} finally {
		record.finishedAt = new Date().toISOString();
		await saveRecord(record);
	}
}

// Gates two existing versions (e.g. a hand-written candidate), reusing
// reports where possible. Promotion still needs approval.
export async function gateVersions(
	baseVersion: number,
	candidateVersion: number,
	log: Log = console.log,
	scorerVersion = SCORER_VERSION,
): Promise<ImprovementRecord> {
	const [base, candidate] = await Promise.all([
		getPrompt({ version: baseVersion }),
		getPrompt({ version: candidateVersion }),
	]);
	const [baseTrain, baseTest, candidateTrain, candidateTest] = [
		await runsFor(baseVersion, "train", log, scorerVersion),
		await runsFor(baseVersion, "test", log, scorerVersion),
		await runsFor(candidateVersion, "train", log, scorerVersion),
		await runsFor(candidateVersion, "test", log, scorerVersion),
	];
	const record: ImprovementRecord = {
		id: newId("manual"),
		kind: "manual",
		startedAt: new Date().toISOString(),
		finishedAt: new Date().toISOString(),
		status: "gated",
		baseVersion,
		candidateVersion,
		changes: candidate.commitMessage ? [candidate.commitMessage] : undefined,
		promptBefore: base.prompt,
		promptAfter: candidate.prompt,
		gate: gate(
			merged(baseVersion, baseTrain, baseTest),
			merged(candidateVersion, candidateTrain, candidateTest),
		),
		models: {
			baselineAgent: baseTest[0]?.models.agent,
			candidateAgent: candidateTest[0]?.models.agent,
			judge: candidateTest[0]?.models.judge ?? MODELS.judge,
		},
		reports: {
			baseline: files(baseTrain, baseTest),
			candidate: files(candidateTrain, candidateTest),
		},
		promoted: false,
	};
	await saveRecord(record);
	log(
		`gate v${baseVersion} → v${candidateVersion}: ${record.gate?.decision}. ${record.gate?.reasons.join("; ")}`,
	);
	return record;
}
