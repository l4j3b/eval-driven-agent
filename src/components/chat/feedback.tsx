import { ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";
import { useState } from "react";

import {
	MessageAction,
	MessageActions,
} from "#/components/ai-elements/message";
import { Button } from "#/components/ui/button";
import { Textarea } from "#/components/ui/textarea";
import type { MessageMetadata } from "#/lib/evals";
import { cn } from "#/lib/utils";
import { submitFeedback } from "#/server/feedback";

// Thumbs up/down under an answer. Each vote becomes a Langfuse score on the
// trace that produced the answer; a thumbs-down can carry a short note, which
// is what a reviewer sees later on the Feedback page.
export function Feedback({
	chatId,
	messageId,
	metadata,
}: {
	chatId: string;
	messageId: string;
	metadata?: MessageMetadata;
}) {
	const [value, setValue] = useState(metadata?.feedback);
	const [comment, setComment] = useState(metadata?.feedbackComment ?? "");
	const [asking, setAsking] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (!metadata?.traceId) return null;

	const send = async (next: "up" | "down", note?: string) => {
		setSaving(true);
		setError(null);
		try {
			await submitFeedback({
				data: { chatId, messageId, value: next, comment: note },
			});
			setValue(next);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Couldn't save that.");
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="mt-1 grid gap-2">
			<MessageActions>
				<MessageAction
					disabled={saving}
					onClick={() => {
						setAsking(false);
						void send("up");
					}}
					tooltip="Good answer"
				>
					<ThumbsUpIcon className={cn(value === "up" && "fill-current")} />
				</MessageAction>
				<MessageAction
					disabled={saving}
					onClick={() => {
						setAsking(true);
						void send("down", comment);
					}}
					tooltip="Bad answer"
				>
					<ThumbsDownIcon className={cn(value === "down" && "fill-current")} />
				</MessageAction>
				{value && !asking && (
					<span className="text-muted-foreground text-xs">
						Thanks, saved to Langfuse.
					</span>
				)}
			</MessageActions>
			{asking && (
				<form
					className="grid max-w-md gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						setAsking(false);
						void send("down", comment);
					}}
				>
					<Textarea
						autoFocus
						className="min-h-16 text-sm"
						onChange={(event) => setComment(event.target.value)}
						placeholder="What went wrong? (optional)"
						value={comment}
					/>
					<div className="flex gap-2">
						<Button disabled={saving} size="sm" type="submit">
							Send
						</Button>
						<Button
							onClick={() => setAsking(false)}
							size="sm"
							type="button"
							variant="ghost"
						>
							Skip
						</Button>
					</div>
				</form>
			)}
			{error && <p className="text-destructive text-xs">{error}</p>}
		</div>
	);
}
