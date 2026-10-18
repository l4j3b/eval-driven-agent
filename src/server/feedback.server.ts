import { LangfuseClient } from "@langfuse/client";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "#/db/client";
import { chatMessages, chats } from "#/db/schema";
import {
	EVAL_DATASET,
	type EvalExpected,
	type EvalInput,
	type MessageMetadata,
} from "#/lib/evals";

const langfuse = new LangfuseClient();

const textOf = (parts: unknown) =>
	(parts as { type: string; text?: string }[])
		.map((part) => (part.type === "text" ? (part.text ?? "") : ""))
		.join("\n")
		.trim();

async function findAnswer(chatId: string, messageId: string) {
	const [row] = await db
		.select({
			metadata: chatMessages.metadata,
			createdAt: chatMessages.createdAt,
			customerId: chats.customerId,
		})
		.from(chatMessages)
		.innerJoin(chats, eq(chats.id, chatMessages.chatId))
		.where(
			and(
				eq(chatMessages.id, messageId),
				eq(chatMessages.chatId, chatId),
				eq(chatMessages.role, "assistant"),
			),
		);
	return row
		? { ...row, metadata: (row.metadata ?? {}) as MessageMetadata }
		: undefined;
}

async function mergeMetadata(messageId: string, patch: MessageMetadata) {
	await db
		.update(chatMessages)
		.set({
			metadata: sql`coalesce(${chatMessages.metadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
		})
		.where(eq(chatMessages.id, messageId));
}

// Thumbs up/down → a Langfuse score on the answer's trace. The trace id comes
// from the stored message, not the client. One score per answer: voting again
// updates it (same id and timestamp) instead of adding a second one.
export async function recordFeedback(input: {
	customerId: string | null;
	chatId: string;
	messageId: string;
	value: "up" | "down";
	comment?: string;
}) {
	const answer = await findAnswer(input.chatId, input.messageId);
	if (!answer || answer.customerId !== input.customerId) {
		throw new Error("Answer not found.");
	}
	const { traceId } = answer.metadata;
	if (!traceId) throw new Error("This answer has no trace to score.");

	const feedbackAt = answer.metadata.feedbackAt ?? new Date().toISOString();
	langfuse.score.create({
		id: `feedback-${input.messageId}`,
		timestamp: feedbackAt,
		traceId,
		name: "user-feedback",
		dataType: "BOOLEAN",
		value: input.value === "up" ? 1 : 0,
		comment: input.comment || undefined,
		metadata: { chatId: input.chatId, messageId: input.messageId },
	});
	await langfuse.score.flush();
	await mergeMetadata(input.messageId, {
		feedback: input.value,
		feedbackComment: input.comment ?? "",
		feedbackAt,
	});
}

export type FeedbackItem = {
	chatId: string;
	messageId: string;
	customerId: string | null;
	question: string;
	answer: string;
	transcript: EvalInput["transcript"];
	feedback: "up" | "down";
	comment: string;
	traceId: string | null;
	datasetItemId: string | null;
	at: string;
};

// Every answer that got a vote, with the conversation that led to it. An
// internal review tool: it spans all customers (staff-only in a real app).
export async function listFeedback(): Promise<FeedbackItem[]> {
	const rated = await db
		.select({ chatId: chatMessages.chatId })
		.from(chatMessages)
		.where(sql`${chatMessages.metadata} ? 'feedback'`);
	const chatIds = [...new Set(rated.map((row) => row.chatId))];
	if (chatIds.length === 0) return [];

	const rows = await db
		.select({
			id: chatMessages.id,
			chatId: chatMessages.chatId,
			role: chatMessages.role,
			parts: chatMessages.parts,
			metadata: chatMessages.metadata,
			createdAt: chatMessages.createdAt,
			customerId: chats.customerId,
		})
		.from(chatMessages)
		.innerJoin(chats, eq(chats.id, chatMessages.chatId))
		.where(inArray(chatMessages.chatId, chatIds))
		.orderBy(asc(chatMessages.createdAt));

	const items: FeedbackItem[] = [];
	for (const chatId of chatIds) {
		const messages = rows.filter((row) => row.chatId === chatId);
		messages.forEach((row, index) => {
			const metadata = (row.metadata ?? {}) as MessageMetadata;
			if (row.role !== "assistant" || !metadata.feedback) return;
			const transcript = messages
				.slice(0, index)
				.map((earlier) => ({
					role: earlier.role as "user" | "assistant",
					text: textOf(earlier.parts),
				}))
				.filter((turn) => turn.text);
			items.push({
				chatId,
				messageId: row.id,
				customerId: row.customerId,
				question:
					transcript.findLast((turn) => turn.role === "user")?.text ?? "",
				answer: textOf(row.parts),
				transcript,
				feedback: metadata.feedback,
				comment: metadata.feedbackComment ?? "",
				traceId: metadata.traceId ?? null,
				datasetItemId: metadata.datasetItemId ?? null,
				at: metadata.feedbackAt ?? row.createdAt.toISOString(),
			});
		});
	}
	return items.sort((a, b) => b.at.localeCompare(a.at));
}

let datasetReady: Promise<unknown> | null = null;
function ensureDataset() {
	datasetReady ??= langfuse.api.datasets
		.create({
			name: EVAL_DATASET,
			description:
				"Eval cases for the Mise agent: hand-written cases and answers users flagged, each with criteria for a good answer.",
		})
		.catch((error) => {
			datasetReady = null;
			throw error;
		});
	return datasetReady;
}

// The flywheel: a flagged answer plus a human's description of what a good
// answer would do becomes a regression case, linked to the trace it came from.
export async function addToDataset(input: {
	chatId: string;
	messageId: string;
	criteria: string;
	reference?: string;
}) {
	const item = (await listFeedback()).find(
		(candidate) =>
			candidate.chatId === input.chatId &&
			candidate.messageId === input.messageId,
	);
	if (!item) throw new Error("No feedback for that answer.");
	await ensureDataset();

	const evalInput: EvalInput = {
		customerId: item.customerId,
		transcript: item.transcript,
	};
	const expected: EvalExpected = {
		criteria: input.criteria,
		...(input.reference ? { reference: input.reference } : {}),
	};
	const created = await langfuse.dataset.createItem({
		id: `feedback-${input.messageId}`,
		datasetName: EVAL_DATASET,
		input: evalInput,
		expectedOutput: expected,
		metadata: {
			source: "user-feedback",
			feedback: item.feedback,
			comment: item.comment,
			flaggedAnswer: item.answer,
			chatId: item.chatId,
			messageId: item.messageId,
		},
		...(item.traceId ? { sourceTraceId: item.traceId } : {}),
	});
	await mergeMetadata(input.messageId, { datasetItemId: created.id });
	return created.id;
}
