import "#/server/telemetry";

import { propagateAttributes, startActiveObservation } from "@langfuse/tracing";
import { createFileRoute } from "@tanstack/react-router";
import {
	convertToModelMessages,
	createIdGenerator,
	createUIMessageStreamResponse,
	isToolUIPart,
	streamText,
	toUIMessageStream,
	type UIMessage,
	validateUIMessages,
} from "ai";
import { z } from "zod";

import type { MessageMetadata } from "#/lib/evals";
import { prepareAgent } from "#/server/agent/agent";
import {
	CHAT_ID,
	chatOwner,
	loadMessages,
	MESSAGE_ID,
	saveMessages,
} from "#/server/chat-store";
import { currentCustomerId } from "#/server/session.server";

// When the customer answers an approval, the client sends the assistant
// message back. Only the decisions are taken from it: the tool calls and
// inputs come from the stored copy, so a client can't edit what it approves.
function applyApprovals(stored: UIMessage, incoming: UIMessage): UIMessage {
	const decisions = new Map(
		incoming.parts.flatMap((part) =>
			isToolUIPart(part) && part.state === "approval-responded"
				? [[part.toolCallId, part.approval] as const]
				: [],
		),
	);
	return {
		...stored,
		parts: stored.parts.map((part) => {
			if (!isToolUIPart(part) || part.state !== "approval-requested")
				return part;
			const decision = decisions.get(part.toolCallId);
			if (!decision) return part;
			return {
				...part,
				state: "approval-responded",
				approval: {
					...part.approval,
					approved: decision.approved,
					reason: decision.reason,
				},
			};
		}),
	} as UIMessage;
}

// The client sends the chat id and one message; validateUIMessages checks the
// message's parts in full once the history is assembled.
const requestBody = z.object({
	id: z.string().regex(CHAT_ID),
	message: z.looseObject({
		id: z.string().regex(MESSAGE_ID),
		role: z.enum(["user", "assistant"]),
		parts: z.array(z.looseObject({ type: z.string() })),
	}),
});

const textOf = (message: UIMessage) =>
	message.parts
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("\n")
		.trim();

export const Route = createFileRoute("/api/chat")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				if (!process.env.AI_GATEWAY_API_KEY) {
					return new Response(
						"AI_GATEWAY_API_KEY is not set. Add it to .env.local.",
						{ status: 500 },
					);
				}

				const body = requestBody.safeParse(
					await request.json().catch(() => null),
				);
				if (!body.success) {
					return new Response("Invalid request.", { status: 400 });
				}
				const { id } = body.data;
				const message = body.data.message as UIMessage;

				// A chat belongs to the customer who started it.
				const owner = await chatOwner(id);
				const sessionCustomerId = currentCustomerId();
				if (owner !== undefined && owner !== sessionCustomerId) {
					return new Response("This chat belongs to another customer.", {
						status: 403,
					});
				}
				const customerId = owner === undefined ? sessionCustomerId : owner;

				// History comes from the database. The client sends either a new
				// user message, or the last assistant message with approvals answered.
				const previous = await loadMessages(id);
				const stored = previous.find((row) => row.id === message.id);
				if (stored && stored.id !== previous.at(-1)?.id) {
					return new Response("Only the latest message can be updated.", {
						status: 400,
					});
				}
				if (!stored && message.role !== "user") {
					return new Response("New messages must come from the user.", {
						status: 400,
					});
				}
				// A new user message is text only, and its metadata (trace ids,
				// feedback) is the server's to set.
				const latest =
					stored?.role === "assistant"
						? applyApprovals(stored, message)
						: {
								id: message.id,
								role: "user" as const,
								parts: message.parts.filter((part) => part.type === "text"),
							};
				const history = [
					...previous.filter((row) => row.id !== latest.id),
					latest,
				];

				const agent = await prepareAgent({
					customerId,
					chatId: id,
					history,
				});
				const messages = await validateUIMessages({
					messages: history,
					tools: agent.tools,
				});
				await saveMessages(id, [latest], customerId);
				const question = textOf(
					history.findLast((row) => row.role === "user") ?? latest,
				);

				// One trace per turn: a root span wraps everything the AI SDK emits,
				// and its trace id goes to the browser as message metadata, so
				// feedback on an answer lands on the exact trace that produced it.
				return propagateAttributes(
					{
						sessionId: id,
						userId: customerId ?? "guest",
						tags: ["chat"],
						metadata: {
							promptVersion: String(agent.prompt.langfusePrompt.version),
							model: agent.modelId,
						},
					},
					() =>
						startActiveObservation(
							"chat-turn",
							async (turn) => {
								turn.update({ input: question });
								const result = streamText({
									...agent.settings,
									messages: await convertToModelMessages(messages, {
										tools: agent.tools,
									}),
								});

								return createUIMessageStreamResponse({
									stream: toUIMessageStream({
										stream: result.stream,
										originalMessages: messages,
										generateMessageId: createIdGenerator({
											prefix: "msg",
											size: 16,
										}),
										messageMetadata: ({ part }) =>
											part.type === "start"
												? ({ traceId: turn.traceId } satisfies MessageMetadata)
												: undefined,
										onEnd: async ({ responseMessage }) => {
											await saveMessages(id, [responseMessage], customerId);
											turn.update({ output: textOf(responseMessage) });
											turn.end();
										},
									}),
								});
							},
							{ endOnExit: false },
						),
				);
			},
		},
	},
});
