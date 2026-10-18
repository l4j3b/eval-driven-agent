import { createFileRoute, useRouter } from "@tanstack/react-router";
import {
	CheckIcon,
	ExternalLinkIcon,
	ThumbsDownIcon,
	ThumbsUpIcon,
} from "lucide-react";
import { useId, useState } from "react";

import { MessageResponse } from "#/components/ai-elements/message";
import { PageHeader } from "#/components/page-header";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader } from "#/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { Textarea } from "#/components/ui/textarea";
import { createDatasetItem, getFeedback } from "#/server/feedback";
import type { FeedbackItem } from "#/server/feedback.server";

export const Route = createFileRoute("/feedback")({
	loader: () => getFeedback(),
	component: FeedbackPage,
});

type Filter = "review" | "dataset" | "all";

const needsReview = (item: FeedbackItem) =>
	item.feedback === "down" && !item.datasetItemId;

function FeedbackPage() {
	const { items, langfuseUrl } = Route.useLoaderData();
	const [filter, setFilter] = useState<Filter>("review");
	const shown = items.filter((item) =>
		filter === "review"
			? needsReview(item)
			: filter === "dataset"
				? item.datasetItemId
				: true,
	);
	const count = (predicate: (item: FeedbackItem) => unknown) =>
		items.filter(predicate).length;

	return (
		<>
			<PageHeader>Feedback</PageHeader>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto grid max-w-4xl gap-5 p-6">
					<div>
						<h1 className="font-semibold text-2xl tracking-tight">
							Feedback and the eval flywheel
						</h1>
						<p className="text-muted-foreground">
							Every thumbs up or down is a score on the answer's trace in
							Langfuse. A bad answer, plus a sentence on what a good one would
							do, becomes an eval case in the <code>mise-agent-evals</code>{" "}
							dataset, so the same mistake is tested on every future prompt.
						</p>
					</div>

					<Tabs
						onValueChange={(value) => setFilter(value as Filter)}
						value={filter}
					>
						<TabsList>
							<TabsTrigger value="review">
								Needs review ({count(needsReview)})
							</TabsTrigger>
							<TabsTrigger value="dataset">
								In dataset ({count((item) => item.datasetItemId)})
							</TabsTrigger>
							<TabsTrigger value="all">All ({items.length})</TabsTrigger>
						</TabsList>
					</Tabs>

					{shown.length === 0 && (
						<p className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
							{filter === "review"
								? "Nothing to review. Thumbs-down an answer in a chat and it shows up here."
								: "Nothing here yet."}
						</p>
					)}
					{shown.map((item) => (
						<FeedbackCard
							item={item}
							key={item.messageId}
							langfuseUrl={langfuseUrl}
						/>
					))}
				</div>
			</div>
		</>
	);
}

function FeedbackCard({
	item,
	langfuseUrl,
}: {
	item: FeedbackItem;
	langfuseUrl: string;
}) {
	const router = useRouter();
	const criteriaId = useId();
	const referenceId = useId();
	const [open, setOpen] = useState(false);
	const [criteria, setCriteria] = useState(
		item.comment
			? `A good answer should… (the user said: "${item.comment}")`
			: "",
	);
	const [reference, setReference] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			await createDatasetItem({
				data: {
					chatId: item.chatId,
					messageId: item.messageId,
					criteria,
					reference: reference || undefined,
				},
			});
			setOpen(false);
			await router.invalidate();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Couldn't save that.");
		} finally {
			setSaving(false);
		}
	};

	return (
		<Card className="gap-3">
			<CardHeader className="flex flex-row flex-wrap items-center gap-2">
				{item.feedback === "up" ? (
					<Badge variant="secondary">
						<ThumbsUpIcon /> Good
					</Badge>
				) : (
					<Badge variant="destructive">
						<ThumbsDownIcon /> Bad
					</Badge>
				)}
				<Badge variant="outline">{item.customerId ?? "guest"}</Badge>
				<span className="text-muted-foreground text-xs">
					{new Date(item.at).toLocaleString()}
				</span>
				<div className="ml-auto flex gap-2">
					{item.traceId && (
						<Button asChild size="sm" variant="ghost">
							<a
								href={`${langfuseUrl}/traces/${item.traceId}`}
								rel="noreferrer"
								target="_blank"
							>
								Trace <ExternalLinkIcon />
							</a>
						</Button>
					)}
					{item.datasetItemId ? (
						<Badge className="bg-emerald-500/20 text-emerald-300">
							<CheckIcon /> In eval dataset
						</Badge>
					) : (
						item.feedback === "down" &&
						!open && (
							<Button onClick={() => setOpen(true)} size="sm">
								Add to eval dataset
							</Button>
						)
					)}
				</div>
			</CardHeader>
			<CardContent className="grid gap-3 text-sm">
				<p className="font-medium">{item.question}</p>
				<div className="max-h-48 overflow-y-auto rounded-md border bg-muted/30 p-3">
					<MessageResponse>{item.answer || "(no text)"}</MessageResponse>
				</div>
				{item.comment && (
					<p className="text-muted-foreground">
						<span className="font-medium text-foreground">Note: </span>
						{item.comment}
					</p>
				)}
				{open && (
					<form
						className="grid gap-2 rounded-md border p-3"
						onSubmit={(event) => {
							event.preventDefault();
							void save();
						}}
					>
						<label className="grid gap-1" htmlFor={criteriaId}>
							<span className="font-medium">What would a good answer do?</span>
							<span className="text-muted-foreground text-xs">
								The judge grades future answers against this, so be specific:
								facts it must state, tools it must use, things it must not do.
							</span>
							<Textarea
								autoFocus
								className="min-h-20"
								id={criteriaId}
								onChange={(event) => setCriteria(event.target.value)}
								value={criteria}
							/>
						</label>
						<label className="grid gap-1" htmlFor={referenceId}>
							<span className="font-medium">
								Example of a good answer (optional)
							</span>
							<Textarea
								className="min-h-16"
								id={referenceId}
								onChange={(event) => setReference(event.target.value)}
								value={reference}
							/>
						</label>
						{error && <p className="text-destructive text-xs">{error}</p>}
						<div className="flex gap-2">
							<Button
								disabled={saving || criteria.trim().length < 10}
								size="sm"
								type="submit"
							>
								Save eval case
							</Button>
							<Button
								onClick={() => setOpen(false)}
								size="sm"
								type="button"
								variant="ghost"
							>
								Cancel
							</Button>
						</div>
					</form>
				)}
			</CardContent>
		</Card>
	);
}
