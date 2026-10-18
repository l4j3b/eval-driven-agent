import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ChevronDownIcon, ExternalLinkIcon } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "#/components/page-header";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader } from "#/components/ui/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/ui/collapsible";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { formatPassed } from "#/improve/gate";
import type { ImprovementRecord } from "#/improve/loop";
import { lineDiff } from "#/lib/diff";
import { shortModel } from "#/lib/models";
import { cn } from "#/lib/utils";
import {
	approveImprovement,
	getImproveState,
	makeProduction,
} from "#/server/improve";

export const Route = createFileRoute("/improve")({
	loader: () => getImproveState(),
	component: ImprovePage,
});

const pct = (value: number | undefined) =>
	value === undefined ? "-" : `${Math.round(value * 100)}%`;

// "9/13" first (how many passed), the percentage second. Results from an
// older scorer version are marked, since they aren't comparable with current ones.
function PassCount({
	passed,
	cases,
	scorer,
	currentScorer,
}: {
	passed?: number;
	cases?: number;
	scorer?: number;
	currentScorer?: number;
}) {
	if (passed === undefined || !cases)
		return <span className="text-muted-foreground">-</span>;
	const outdated =
		scorer !== undefined &&
		currentScorer !== undefined &&
		scorer < currentScorer;
	return (
		<span
			className={cn("whitespace-nowrap", outdated && "opacity-60")}
			title={
				outdated
					? `Scored by scorer v${scorer}, not comparable with scorer v${currentScorer}`
					: undefined
			}
		>
			<span className="font-medium">{formatPassed({ passed, cases })}</span>
			<span className="ml-1.5 text-muted-foreground text-xs">
				{pct(passed / cases)}
				{outdated && ` · scorer v${scorer}`}
			</span>
		</span>
	);
}

function ImprovePage() {
	const { productionVersion, versions, records, langfuseUrl, scorerVersion } =
		Route.useLoaderData();
	const router = useRouter();
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const act = async (key: string, run: () => Promise<unknown>) => {
		setBusy(key);
		setError(null);
		try {
			await run();
			await router.invalidate();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "That didn't work.");
		} finally {
			setBusy(null);
		}
	};

	return (
		<>
			<PageHeader>Improve</PageHeader>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto grid max-w-5xl gap-6 p-6">
					<div>
						<h1 className="font-semibold text-2xl tracking-tight">
							Self-improvement loop
						</h1>
						<p className="max-w-3xl text-muted-foreground">
							Each iteration takes the production prompt's failures on the{" "}
							<strong>train</strong> cases, asks an optimizer model for a
							revised prompt, saves it in Langfuse as <code>proposed</code>, and
							runs it on every case. Averaged over each version's runs, it's
							promoted only if at least one more held-out <strong>test</strong>{" "}
							case passes, train doesn't lose a full case, and no safety,
							injection or action case breaks; and only after you approve here
							(or with <code>--auto-promote</code>). Start one with{" "}
							<code>npm run improve</code>.
						</p>
					</div>
					{error && <p className="text-destructive text-sm">{error}</p>}

					<section className="grid gap-2">
						<h2 className="font-semibold text-lg">
							Prompt versions{" "}
							<span className="font-normal text-muted-foreground text-sm">
								· production is v{productionVersion ?? "?"}
							</span>
						</h2>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Version</TableHead>
									<TableHead>Source</TableHead>
									<TableHead>Model</TableHead>
									<TableHead className="text-right">
										Test cases passed
									</TableHead>
									<TableHead className="text-right">
										Train cases passed
									</TableHead>
									<TableHead />
								</TableRow>
							</TableHeader>
							<TableBody>
								{versions.map((info) => (
									<TableRow key={info.version}>
										<TableCell className="max-w-96 whitespace-normal">
											<div className="flex flex-wrap items-center gap-1.5">
												<span className="font-medium">v{info.version}</span>
												{info.labels
													.filter((label) => label !== "latest")
													.map((label) => (
														<Badge
															className={cn(
																label === "production" &&
																	"bg-emerald-500/20 text-emerald-300",
															)}
															key={label}
															variant="secondary"
														>
															{label}
														</Badge>
													))}
											</div>
											{info.commitMessage && (
												<p className="mt-1 line-clamp-2 text-muted-foreground text-xs">
													{info.commitMessage}
												</p>
											)}
										</TableCell>
										<TableCell className="text-muted-foreground text-sm">
											{info.source}
										</TableCell>
										<TableCell
											className="text-sm"
											title={
												info.modelPinned
													? "Pinned in the version's config"
													: "Not pinned: runs on the default agent model"
											}
										>
											<code className="text-xs">{shortModel(info.model)}</code>
											{!info.modelPinned && (
												<span className="ml-1 text-muted-foreground text-xs">
													default
												</span>
											)}
										</TableCell>
										<TableCell className="text-right">
											<PassCount
												cases={info.testCases}
												currentScorer={scorerVersion}
												passed={info.testPassed}
												scorer={info.testScorer}
											/>
										</TableCell>
										<TableCell className="text-right">
											<PassCount
												cases={info.trainCases}
												currentScorer={scorerVersion}
												passed={info.trainPassed}
												scorer={info.trainScorer}
											/>
										</TableCell>
										<TableCell className="text-right">
											{!info.labels.includes("production") && (
												<Button
													disabled={busy !== null}
													onClick={() => {
														if (
															window.confirm(
																`Put v${info.version} in production now? This skips the gate.`,
															)
														) {
															void act(`make-${info.version}`, () =>
																makeProduction({
																	data: { version: info.version },
																}),
															);
														}
													}}
													size="sm"
													variant="ghost"
												>
													Make production
												</Button>
											)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</section>

					<section className="grid gap-3">
						<h2 className="font-semibold text-lg">Improvement runs</h2>
						{records.length === 0 && (
							<p className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
								No runs yet. Try <code>npm run improve</code>, or gate a
								hand-written version with{" "}
								<code>npm run improve -- --gate 1,2</code>.
							</p>
						)}
						{records.map((record) => (
							<RecordCard
								busy={busy}
								key={record.id}
								langfuseUrl={langfuseUrl}
								onApprove={() =>
									act(`approve-${record.id}`, () =>
										approveImprovement({ data: { recordId: record.id } }),
									)
								}
								record={record}
							/>
						))}
					</section>
				</div>
			</div>
		</>
	);
}

function RecordCard({
	record,
	busy,
	onApprove,
	langfuseUrl,
}: {
	record: ImprovementRecord;
	busy: string | null;
	onApprove: () => void;
	langfuseUrl: string;
}) {
	const gate = record.gate;
	return (
		<Card className="gap-3">
			<CardHeader className="flex flex-row flex-wrap items-center gap-2">
				<span className="font-medium">
					v{record.baseVersion}
					{record.candidateVersion ? ` → v${record.candidateVersion}` : ""}
				</span>
				<Badge variant="outline">
					{record.kind === "optimizer" ? "optimizer" : "hand-written"}
				</Badge>
				{record.status === "nothing-to-improve" && (
					<Badge variant="secondary">nothing to improve</Badge>
				)}
				{record.status === "failed" && (
					<Badge variant="destructive">failed</Badge>
				)}
				{gate && (
					<Badge
						className={
							gate.decision === "promote"
								? "bg-emerald-500/20 text-emerald-300"
								: "bg-red-500/20 text-red-300"
						}
					>
						gate: {gate.decision}
					</Badge>
				)}
				{record.promoted && (
					<Badge className="bg-emerald-500/20 text-emerald-300">
						promoted{" "}
						{record.promotedAt
							? new Date(record.promotedAt).toLocaleString()
							: ""}
					</Badge>
				)}
				<span className="text-muted-foreground text-xs">
					{new Date(record.startedAt).toLocaleString()}
				</span>
				<div className="ml-auto flex gap-2">
					{record.candidateVersion && (
						<Button asChild size="sm" variant="ghost">
							<a
								href={`${langfuseUrl}/prompts/mise-agent?version=${record.candidateVersion}`}
								rel="noreferrer"
								target="_blank"
							>
								Prompt <ExternalLinkIcon />
							</a>
						</Button>
					)}
					{gate?.decision === "promote" && !record.promoted && (
						<Button disabled={busy !== null} onClick={onApprove} size="sm">
							Approve and promote v{record.candidateVersion}
						</Button>
					)}
				</div>
			</CardHeader>
			<CardContent className="grid gap-3 text-sm">
				{record.error && <p className="text-destructive">{record.error}</p>}
				{gate && (
					<div className="grid gap-1">
						<p>
							Test cases passing: <strong>{formatPassed(gate.baseline)}</strong>{" "}
							→ <strong>{formatPassed(gate.candidate)}</strong>
							<span className="ml-2 text-muted-foreground">
								{(gate.baseline.runs ?? 1) > 1 || (gate.candidate.runs ?? 1) > 1
									? `(averaged over ${gate.baseline.runs ?? 1} and ${gate.candidate.runs ?? 1} runs) `
									: ""}
								(correctness {pct(gate.baseline.meanCorrectness)} →{" "}
								{pct(gate.candidate.meanCorrectness)})
							</span>
						</p>
						<p className="text-muted-foreground">{gate.reasons.join(" · ")}</p>
						<p>
							<span className="text-muted-foreground">All cases · </span>
							<span className="text-emerald-400">
								fixed: {gate.fixed.join(", ") || "none"}
							</span>
							<span className="mx-2 text-muted-foreground">·</span>
							<span
								className={
									gate.regressed.length
										? "text-red-400"
										: "text-muted-foreground"
								}
							>
								regressed: {gate.regressed.join(", ") || "none"}
							</span>
						</p>
					</div>
				)}
				{record.models && (
					<p className="text-muted-foreground text-xs">
						Agent{" "}
						<code>
							{record.models.baselineAgent === record.models.candidateAgent
								? shortModel(record.models.candidateAgent ?? "?")
								: `${shortModel(record.models.baselineAgent ?? "?")} → ${shortModel(record.models.candidateAgent ?? "?")}`}
						</code>{" "}
						· judge <code>{shortModel(record.models.judge)}</code>
						{record.models.optimizer && (
							<>
								{" "}
								· optimizer <code>{shortModel(record.models.optimizer)}</code>
							</>
						)}
					</p>
				)}
				{record.trainFailures && record.trainFailures.length > 0 && (
					<p className="text-muted-foreground">
						Train failures it learned from: {record.trainFailures.join(", ")}
					</p>
				)}
				{record.analysis && (
					<p>
						<span className="font-medium">Optimizer's analysis: </span>
						{record.analysis}
					</p>
				)}
				{record.changes && record.changes.length > 0 && (
					<ul className="list-disc pl-5">
						{record.changes.map((change) => (
							<li key={change}>{change}</li>
						))}
					</ul>
				)}
				{record.promptBefore && record.promptAfter && (
					<Collapsible>
						<CollapsibleTrigger className="flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground">
							<ChevronDownIcon className="size-3.5" /> Prompt diff
						</CollapsibleTrigger>
						<CollapsibleContent>
							<pre className="mt-2 max-h-96 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs leading-5">
								{lineDiff(record.promptBefore, record.promptAfter).map(
									(line, index) => (
										<div
											className={cn(
												"whitespace-pre-wrap",
												line.type === "add" &&
													"bg-emerald-500/15 text-emerald-300",
												line.type === "remove" && "bg-red-500/15 text-red-300",
												line.type === "same" && "text-muted-foreground",
											)}
											// biome-ignore lint/suspicious/noArrayIndexKey: diff lines can repeat
											key={index}
										>
											{line.type === "add"
												? "+ "
												: line.type === "remove"
													? "- "
													: "  "}
											{line.text}
										</div>
									),
								)}
							</pre>
						</CollapsibleContent>
					</Collapsible>
				)}
			</CardContent>
		</Card>
	);
}
