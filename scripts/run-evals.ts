// Runs the eval cases against a prompt version and prints the results.
//
//   npm run eval                                   # production prompt, all cases
//   npm run eval -- --label candidate --split test
//   npm run eval -- --compare production,candidate --limit 8
//   npm run eval -- --version 1 --category safety
//   npm run eval -- --ids next-box,credit-over-cap
//   npm run eval -- --version 4 --model anthropic/claude-sonnet-5.5  # try another agent model
//
// Each run is a Langfuse experiment (Datasets → mise-agent-evals → runs) and
// a JSON report in evals/results/.
import "#/server/telemetry";

import { parseArgs } from "node:util";

import { count, eq } from "drizzle-orm";

import { db, sql } from "#/db/client";
import { credits } from "#/db/schema";
import {
	type ExperimentOptions,
	type ExperimentReport,
	promptLabel,
	runExperiment,
} from "#/evals/experiment";
import { type EvalCategory, type EvalSplit, PASS_RULE } from "#/lib/evals";
import type { PromptSelector } from "#/server/agent/prompt";
import { flushTelemetry } from "#/server/telemetry";

const { values: args } = parseArgs({
	options: {
		label: { type: "string" },
		version: { type: "string" },
		compare: { type: "string" },
		split: { type: "string", default: "all" },
		category: { type: "string" },
		ids: { type: "string" },
		limit: { type: "string" },
		concurrency: { type: "string", default: "2" },
		model: { type: "string" },
	},
});

const selector = (value: string): PromptSelector =>
	/^v?\d+$/.test(value)
		? { version: Number(value.replace("v", "")) }
		: { label: value };

const pct = (value: number) => `${Math.round(value * 100)}%`.padStart(4);

function printReport(report: ExperimentReport) {
	const { summary } = report;
	console.log(
		`\n━━ ${report.runName} (prompt v${report.prompt.resolvedVersion ?? "?"}) ━━`,
	);
	console.log(
		`agent ${report.models.agent}${report.prompt.modelOverride ? " (override)" : ""} · judge ${report.models.judge}`,
	);
	console.log(
		`pass rate ${pct(summary.passRate)} over ${summary.cases} cases  ·  ${PASS_RULE}`,
	);
	console.log(
		Object.entries(summary.means)
			.filter(([name]) => name !== "pass")
			.map(([name, value]) => `${name} ${pct(value)}`)
			.join("  ·  "),
	);
	console.log(
		`by category: ${Object.entries(summary.byCategory)
			.map(([name, group]) => `${name} ${pct(group.passRate)} (${group.cases})`)
			.join(", ")}`,
	);
	console.log(
		`by split: ${Object.entries(summary.bySplit)
			.map(([name, group]) => `${name} ${pct(group.passRate)} (${group.cases})`)
			.join(", ")}`,
	);
	if (summary.errors) {
		console.warn(
			`⚠ ${summary.errors} case(s) errored (rate limits, budget or an outage), so this run isn't a measurement: the gate and the Improve page ignore it.`,
		);
	}
	const failures = report.cases.filter((result) => !result.pass);
	if (failures.length) console.log("\nfailures:");
	for (const result of failures) {
		const reasons = Object.entries(result.scores)
			.filter(
				([name, value]) =>
					name !== "pass" && name !== "retrieval-recall" && value < 1,
			)
			.map(([name]) => `${name}: ${result.comments[name]?.slice(0, 160)}`);
		console.log(`  ✗ ${result.id} [${result.category}/${result.split}]`);
		for (const reason of reasons.length
			? reasons
			: [result.comments.error ?? result.comments.pass]) {
			console.log(`      ${reason}`);
		}
	}
	if (report.datasetRunUrl) console.log(`\nLangfuse: ${report.datasetRunUrl}`);
}

function printComparison(a: ExperimentReport, b: ExperimentReport) {
	const nameA = promptLabel(a.prompt);
	const nameB = promptLabel(b.prompt);
	console.log(`\n━━ ${nameA} → ${nameB} ━━`);
	const metrics = [
		...new Set([
			...Object.keys(a.summary.means),
			...Object.keys(b.summary.means),
		]),
	];
	for (const metric of metrics) {
		const before = a.summary.means[metric] ?? 0;
		const after = b.summary.means[metric] ?? 0;
		const delta = Math.round((after - before) * 100);
		console.log(
			`  ${metric.padEnd(20)} ${pct(before)} → ${pct(after)}  ${delta > 0 ? `+${delta}` : delta}`,
		);
	}
	for (const split of ["train", "test"]) {
		const before = a.summary.bySplit[split];
		const after = b.summary.bySplit[split];
		if (before && after) {
			console.log(
				`  pass on ${split.padEnd(12)} ${pct(before.passRate)} → ${pct(after.passRate)}`,
			);
		}
	}
	const byId = new Map(a.cases.map((result) => [result.id, result]));
	const fixed = b.cases.filter(
		(result) => result.pass && byId.get(result.id)?.pass === false,
	);
	const broken = b.cases.filter(
		(result) => !result.pass && byId.get(result.id)?.pass === true,
	);
	console.log(
		`\n  fixed (${fixed.length}): ${fixed.map((result) => result.id).join(", ") || "none"}`,
	);
	console.log(
		`  regressed (${broken.length}): ${broken.map((result) => result.id).join(", ") || "none"}`,
	);
}

// Evals assume the seeded accounts. Credits the agent issued in earlier chats
// change what the credit cases should do, so warn about them.
const [{ value: agentCredits } = { value: 0 }] = await db
	.select({ value: count() })
	.from(credits)
	.where(eq(credits.issuedBy, "agent"));
if (agentCredits > 0) {
	console.warn(
		`⚠ ${agentCredits} credit(s) were issued by the agent in earlier chats; credit cases may fail. Run npm run db:reset-activity first.`,
	);
}

const shared: Omit<ExperimentOptions, "prompt"> = {
	split: args.split as EvalSplit | "all",
	category: args.category as EvalCategory | undefined,
	ids: args.ids?.split(","),
	limit: args.limit ? Number(args.limit) : undefined,
	concurrency: Number(args.concurrency),
	model: args.model,
};

try {
	if (args.compare) {
		const [first = "production", second = "candidate"] =
			args.compare.split(",");
		const a = await runExperiment({ ...shared, prompt: selector(first) });
		printReport(a);
		const b = await runExperiment({ ...shared, prompt: selector(second) });
		printReport(b);
		printComparison(a, b);
	} else {
		const prompt = args.version
			? selector(args.version)
			: { label: args.label ?? "production" };
		printReport(await runExperiment({ ...shared, prompt }));
	}
} finally {
	await flushTelemetry();
	await sql.end();
}
