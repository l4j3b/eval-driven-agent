import { createFileRoute } from "@tanstack/react-router";
import { CheckIcon, ExternalLinkIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { MessageResponse } from "#/components/ai-elements/message";
import { PageHeader } from "#/components/page-header";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "#/components/ui/sheet";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import type { CaseResult, ExperimentReport } from "#/evals/experiment";
import { PASS_RULE } from "#/lib/evals";
import { shortModel } from "#/lib/models";
import { cn } from "#/lib/utils";
import { getEvalReports } from "#/server/evals";

export const Route = createFileRoute("/evals")({
	loader: () => getEvalReports(),
	component: EvalsPage,
});

type Report = ExperimentReport & { file: string };

const pct = (value: number | undefined) =>
	value === undefined ? "-" : `${Math.round(value * 100)}%`;

const promptName = (report: Report) =>
	report.prompt.version
		? `v${report.prompt.version}`
		: `${report.prompt.label ?? "production"} (v${report.prompt.resolvedVersion ?? "?"})`;

// How many cases passed, overall or within a split or category.
const tally = (
	report: Report | undefined,
	keep: (result: CaseResult) => boolean = () => true,
) => {
	if (!report) return undefined;
	const cases = report.cases.filter(keep);
	return cases.length
		? {
				passed: cases.filter((result) => result.pass).length,
				cases: cases.length,
			}
		: undefined;
};

const runLabel = (report: Report) => {
	const all = tally(report);
	const errors = report.summary.errors
		? ` · ${report.summary.errors} errored`
		: "";
	return `${promptName(report)} on ${shortModel(report.models.agent)} · ${all?.passed ?? 0}/${all?.cases ?? 0} passed${errors} · ${new Date(report.startedAt).toLocaleString()}`;
};

// Which models produced a run: the agent (and whether it was an experiment
// overriding the version's model) and the judge that scored it.
function RunModels({ report }: { report: Report }) {
	return (
		<span>
			agent <code>{shortModel(report.models.agent)}</code>
			{report.prompt.modelOverride && " (override)"} · judge{" "}
			<code>{shortModel(report.models.judge)}</code>
		</span>
	);
}

// "9/13" first (how many passed), the percentage second.
function PassCount({ count }: { count?: { passed: number; cases: number } }) {
	if (!count) return <span className="text-muted-foreground">-</span>;
	return (
		<span className="whitespace-nowrap">
			<span className="font-medium">
				{count.passed}/{count.cases}
			</span>
			<span className="ml-1.5 text-muted-foreground text-xs">
				{pct(count.passed / count.cases)}
			</span>
		</span>
	);
}

// Change in passing cases, e.g. "+2".
function CountDelta({ before, after }: { before?: number; after?: number }) {
	if (before === undefined || after === undefined) return null;
	const delta = after - before;
	if (delta === 0) return <span className="text-muted-foreground">±0</span>;
	return (
		<span className={delta > 0 ? "text-emerald-400" : "text-red-400"}>
			{delta > 0 ? `+${delta}` : delta}
		</span>
	);
}

function Delta({ before, after }: { before?: number; after?: number }) {
	if (before === undefined || after === undefined) return null;
	const delta = Math.round((after - before) * 100);
	if (delta === 0) return <span className="text-muted-foreground">±0</span>;
	return (
		<span className={delta > 0 ? "text-emerald-400" : "text-red-400"}>
			{delta > 0 ? `+${delta}` : delta}
		</span>
	);
}

function PassMark({ result }: { result?: CaseResult }) {
	if (!result) return <span className="text-muted-foreground">-</span>;
	return result.pass ? (
		<CheckIcon className="size-4 text-emerald-400" />
	) : (
		<XIcon className="size-4 text-red-400" />
	);
}

function EvalsPage() {
	const { reports, langfuseUrl } = Route.useLoaderData();
	const latest = reports[0];
	// Prefer a baseline scored the same way (same scorer version, so the same
	// judge) that ran the same cases as the newest run, for another prompt.
	const sameCases = (x: Report, y: Report) =>
		x.cases.length === y.cases.length &&
		x.cases.every((result) => y.cases.some((other) => other.id === result.id));
	const sameScorer = (x: Report, y: Report) =>
		(x.scorerVersion ?? 1) === (y.scorerVersion ?? 1);
	const others = reports.filter((report) => report !== latest);
	const preferences = latest
		? [
				(report: Report) =>
					sameScorer(report, latest) &&
					sameCases(report, latest) &&
					promptName(report) !== promptName(latest),
				(report: Report) =>
					sameScorer(report, latest) && sameCases(report, latest),
				(report: Report) => sameScorer(report, latest),
				(report: Report) => promptName(report) !== promptName(latest),
			]
		: [];
	const baseline =
		preferences.map((matches) => others.find(matches)).find(Boolean) ??
		others[0] ??
		latest;
	const [bFile, setB] = useState(latest?.file);
	const [aFile, setA] = useState(baseline?.file);
	const [selected, setSelected] = useState<string | null>(null);

	const a = reports.find((report) => report.file === aFile);
	const b = reports.find((report) => report.file === bFile);
	// Two different runs are compared on the cases they share, so a run over
	// more (or fewer) cases can't skew the numbers. Same rule as the gate.
	const shared =
		a && b && a.file !== b.file
			? new Set(
					a.cases
						.map((result) => result.id)
						.filter((id) => b.cases.some((result) => result.id === id)),
				)
			: null;
	const inScope = (result: CaseResult) => !shared || shared.has(result.id);
	const scoped = (
		report: Report | undefined,
		keep: (result: CaseResult) => boolean = () => true,
	) => tally(report, (result) => inScope(result) && keep(result));
	const meanOf = (report: Report | undefined, metric: string) => {
		const values = (report?.cases ?? [])
			.filter(inScope)
			.map((result) => result.scores[metric])
			.filter((value): value is number => value !== undefined);
		return values.length
			? values.reduce((total, value) => total + value, 0) / values.length
			: undefined;
	};
	const ids = [
		...new Set(
			[...(a?.cases ?? []), ...(b?.cases ?? [])].map((result) => result.id),
		),
	].sort();
	const caseIn = (report: Report | undefined, id: string) =>
		report?.cases.find((result) => result.id === id);
	const metrics = [
		...new Set([
			...Object.keys(a?.summary.means ?? {}),
			...Object.keys(b?.summary.means ?? {}),
		]),
	].sort((x, y) => (x === "pass" ? -1 : y === "pass" ? 1 : x.localeCompare(y)));

	return (
		<>
			<PageHeader>Evals</PageHeader>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto grid max-w-6xl gap-6 p-6">
					<div>
						<h1 className="font-semibold text-2xl tracking-tight">Eval runs</h1>
						<p className="max-w-3xl text-muted-foreground">
							Each run replays every case in <code>mise-agent-evals</code>{" "}
							through the real agent with one prompt version (no side effects),
							then scores it with code checks and an LLM judge. A case passes
							when {PASS_RULE}. Runs come from <code>npm run eval</code>; each
							is also a Langfuse experiment.
						</p>
					</div>

					{reports.length === 0 ? (
						<p className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
							No runs yet. Try{" "}
							<code>npm run eval -- --compare production,candidate</code>.
						</p>
					) : (
						<>
							<div className="grid gap-3 sm:grid-cols-2">
								{(
									[
										["Baseline", aFile, setA],
										["Compared with", bFile, setB],
									] as const
								).map(([title, value, set]) => (
									<div className="grid gap-1 text-sm" key={title}>
										<span className="text-muted-foreground">{title}</span>
										<Select onValueChange={set} value={value}>
											<SelectTrigger aria-label={title} className="w-full">
												<SelectValue>
													{reports.find((report) => report.file === value)
														? runLabel(
																reports.find(
																	(report) => report.file === value,
																) as Report,
															)
														: "Pick a run"}
												</SelectValue>
											</SelectTrigger>
											<SelectContent>
												{reports.map((report) => (
													<SelectItem key={report.file} value={report.file}>
														{runLabel(report)}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
								))}
							</div>

							{a && b && (
								<p className="-mt-3 grid gap-3 text-muted-foreground text-xs sm:grid-cols-2">
									<RunModels report={a} />
									<RunModels report={b} />
								</p>
							)}
							{a && b && (a.scorerVersion ?? 1) !== (b.scorerVersion ?? 1) && (
								<p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-200 text-sm">
									These runs were scored differently (scorer v
									{a.scorerVersion ?? 1} and v{b.scorerVersion ?? 1}), so their
									scores aren't comparable. The gate refuses to compare them.
								</p>
							)}

							{shared &&
								a &&
								b &&
								(shared.size < a.cases.length ||
									shared.size < b.cases.length) && (
									<p className="text-muted-foreground text-sm">
										{shared.size
											? `Comparing the ${shared.size} cases both runs include (the baseline ran ${a.cases.length}, the other ${b.cases.length}).`
											: "These two runs have no cases in common."}
									</p>
								)}
							<div className="grid gap-6 lg:grid-cols-2">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Score</TableHead>
											<TableHead className="text-right">
												{a ? promptName(a) : "-"}
											</TableHead>
											<TableHead className="text-right">
												{b ? promptName(b) : "-"}
											</TableHead>
											<TableHead className="text-right">Δ</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{metrics.map((metric) => (
											<TableRow key={metric}>
												<TableCell
													className={cn(metric === "pass" && "font-semibold")}
												>
													{metric === "pass" ? "cases passed" : metric}
												</TableCell>
												<TableCell className="text-right">
													{metric === "pass" ? (
														<PassCount count={scoped(a)} />
													) : (
														pct(meanOf(a, metric))
													)}
												</TableCell>
												<TableCell className="text-right">
													{metric === "pass" ? (
														<PassCount count={scoped(b)} />
													) : (
														pct(meanOf(b, metric))
													)}
												</TableCell>
												<TableCell className="text-right">
													{metric === "pass" ? (
														<CountDelta
															after={scoped(b)?.passed}
															before={scoped(a)?.passed}
														/>
													) : (
														<Delta
															after={meanOf(b, metric)}
															before={meanOf(a, metric)}
														/>
													)}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Cases passed by</TableHead>
											<TableHead className="text-right">
												{a ? promptName(a) : "-"}
											</TableHead>
											<TableHead className="text-right">
												{b ? promptName(b) : "-"}
											</TableHead>
											<TableHead className="text-right">Δ</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{[
											...["train", "test"].map(
												(split) => ["split", split] as const,
											),
											...[
												...new Set([
													...Object.keys(a?.summary.byCategory ?? {}),
													...Object.keys(b?.summary.byCategory ?? {}),
												]),
											]
												.sort()
												.map((category) => ["category", category] as const),
										].map(([kind, name]) => {
											const count = (report?: Report) =>
												scoped(report, (result) =>
													kind === "split"
														? result.split === name
														: result.category === name,
												);
											return (
												<TableRow key={`${kind}:${name}`}>
													<TableCell>
														{name}
														<span className="ml-1 text-muted-foreground text-xs">
															{kind}
														</span>
													</TableCell>
													<TableCell className="text-right">
														<PassCount count={count(a)} />
													</TableCell>
													<TableCell className="text-right">
														<PassCount count={count(b)} />
													</TableCell>
													<TableCell className="text-right">
														<CountDelta
															after={count(b)?.passed}
															before={count(a)?.passed}
														/>
													</TableCell>
												</TableRow>
											);
										})}
									</TableBody>
								</Table>
							</div>

							<div className="flex flex-wrap gap-2">
								{[a, b].map(
									(report) =>
										report?.datasetRunUrl && (
											<Button
												asChild
												key={report.file}
												size="sm"
												variant="outline"
											>
												<a
													href={report.datasetRunUrl}
													rel="noreferrer"
													target="_blank"
												>
													{promptName(report)} in Langfuse <ExternalLinkIcon />
												</a>
											</Button>
										),
								)}
							</div>

							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Case</TableHead>
										<TableHead>Category</TableHead>
										<TableHead className="text-center">
											{a ? promptName(a) : "-"}
										</TableHead>
										<TableHead className="text-center">
											{b ? promptName(b) : "-"}
										</TableHead>
										<TableHead>Change</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{ids.map((id) => {
										const before = caseIn(a, id);
										const after = caseIn(b, id);
										const change =
											before && after && before.pass !== after.pass
												? after.pass
													? "fixed"
													: "regressed"
												: null;
										return (
											<TableRow
												className="cursor-pointer"
												key={id}
												onClick={() => setSelected(id)}
											>
												<TableCell className="max-w-80 whitespace-normal">
													<div className="font-medium">{id}</div>
													<div className="text-muted-foreground text-xs">
														{(after ?? before)?.question}
													</div>
												</TableCell>
												<TableCell>
													{(after ?? before)?.category}
													<span className="ml-1 text-muted-foreground text-xs">
														{(after ?? before)?.split}
													</span>
												</TableCell>
												<TableCell>
													<div className="flex justify-center">
														<PassMark result={before} />
													</div>
												</TableCell>
												<TableCell>
													<div className="flex justify-center">
														<PassMark result={after} />
													</div>
												</TableCell>
												<TableCell>
													{change && (
														<Badge
															className={
																change === "fixed"
																	? "bg-emerald-500/20 text-emerald-300"
																	: "bg-red-500/20 text-red-300"
															}
														>
															{change}
														</Badge>
													)}
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						</>
					)}
				</div>
			</div>

			<Sheet
				onOpenChange={(open) => !open && setSelected(null)}
				open={selected !== null}
			>
				<SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
					<SheetHeader>
						<SheetTitle>{selected}</SheetTitle>
						<SheetDescription>
							{
								(caseIn(b, selected ?? "") ?? caseIn(a, selected ?? ""))
									?.question
							}
						</SheetDescription>
					</SheetHeader>
					<div className="grid gap-6 px-4 pb-6">
						{[a, b].map((report) => {
							const result =
								report && selected ? caseIn(report, selected) : undefined;
							if (!report || !result) return null;
							return (
								<section className="grid gap-3" key={report.file}>
									<div className="flex items-center gap-2">
										<h3 className="font-semibold">{promptName(report)}</h3>
										<PassMark result={result} />
										{result.traceId && (
											<a
												className="ml-auto text-muted-foreground text-xs underline"
												href={`${langfuseUrl}/traces/${result.traceId}`}
												rel="noreferrer"
												target="_blank"
											>
												trace
											</a>
										)}
									</div>
									<div className="rounded-md border bg-muted/30 p-3 text-sm">
										<MessageResponse>
											{result.answer || "(no text)"}
										</MessageResponse>
									</div>
									{result.toolCalls.length > 0 && (
										<p className="text-muted-foreground text-xs">
											Tools:{" "}
											{result.toolCalls
												.map((call) => `${call.name} (${call.outcome})`)
												.join(" → ")}
										</p>
									)}
									<div className="grid gap-1">
										{Object.entries(result.scores).map(([name, value]) => (
											<div
												className="grid grid-cols-[9rem_3rem_1fr] gap-2 text-xs"
												key={name}
											>
												<span className="font-medium">{name}</span>
												<span
													className={
														value >= 1
															? "text-emerald-400"
															: value >= 0.75
																? ""
																: "text-red-400"
													}
												>
													{pct(value)}
												</span>
												<span className="text-muted-foreground">
													{result.comments[name]}
												</span>
											</div>
										))}
									</div>
								</section>
							);
						})}
					</div>
				</SheetContent>
			</Sheet>
		</>
	);
}
