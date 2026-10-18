import "#/server/telemetry";

import { propagateAttributes, startActiveObservation } from "@langfuse/tracing";
import { createFileRoute } from "@tanstack/react-router";
import {
	convertToModelMessages,
	createIdGenerator,
	createUIMessageStreamResponse,
	isToolUIPart,
	stepCountIs,
	streamText,
	type ToolSet,
	toUIMessageStream,
	type UIMessage,
	validateUIMessages,
} from "ai";

import type { MessageMetadata } from "#/lib/evals";
import { MODELS } from "#/lib/models";
import { SourceRegistry } from "#/lib/sources";
import { loadAgentPrompt, loadCustomer } from "#/server/agent/prompt";
import {
	AUTO_CREDIT_LIMIT,
	createTools,
	quoteCredit,
} from "#/server/agent/tools";
import {
	CHAT_ID,
	chatOwner,
	loadMessages,
	saveMessages,
} from "#/server/chat-store";
import { currentCustomerId } from "#/server/session.server";

const MAX_STEPS = 8;

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

// Credits need the customer's OK, and the policy is checked before asking:
// anything the policy forbids, including amounts over the cap, is refused
// outright with a reason the agent can relay.
function creditApproval(customerId: string | null) {
	return async (input: unknown) => {
		const { orderId, recipeId } = input as {
			orderId: string;
			recipeId: string;
		};
		if (!customerId) {
			return { type: "denied" as const, reason: "No customer is signed in." };
		}
		const quote = await quoteCredit(customerId, orderId, recipeId);
		if (!quote.ok) return { type: "denied" as const, reason: quote.error };
		if (quote.overLimit) {
			const already = quote.alreadyCredited
				? ` on top of $${quote.alreadyCredited.toFixed(2)} already credited for this box`
				: "";
			return {
				type: "denied" as const,
				reason: `This credit would be $${quote.amount.toFixed(2)}${already}, above the $${AUTO_CREDIT_LIMIT} automatic limit per box. Offer to open a support review instead.`,
			};
		}
		return {
			type: "user-approval" as const,
			reason: `Credit $${quote.amount.toFixed(2)} for ${quote.recipeTitle} (order ${orderId}, delivered ${quote.deliveryDate}).`,
		};
	};
}

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

				const { id, message }: { id: string; message: UIMessage } =
					await request.json();
				if (!CHAT_ID.test(id)) {
					return new Response("Invalid chat id.", { status: 400 });
				}

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
				const latest =
					stored?.role === "assistant"
						? applyApprovals(stored, message)
						: message;
				const history = [
					...previous.filter((row) => row.id !== latest.id),
					latest,
				];

				const customer = await loadCustomer(customerId);
				const tools = createTools({
					customer,
					sources: new SourceRegistry(history),
					chatId: id,
				}) as ToolSet;
				const messages = await validateUIMessages({ messages: history, tools });
				await saveMessages(id, [latest], customerId);
				const prompt = await loadAgentPrompt(customer);
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
							promptVersion: String(prompt.langfusePrompt.version),
						},
					},
					() =>
						startActiveObservation(
							"chat-turn",
							async (turn) => {
								turn.update({ input: question });
								const result = streamText({
									model: MODELS.agent,
									instructions: prompt.instructions,
									messages: await convertToModelMessages(messages, { tools }),
									tools,
									stopWhen: stepCountIs(MAX_STEPS),
									// Each step is a model call; the free tier allows ~5 a
									// minute, so retry rate limits with backoff instead of
									// failing the turn.
									maxRetries: 4,
									toolApproval: { issueCredit: creditApproval(customerId) },
									experimental_toolApprovalSecret:
										process.env.TOOL_APPROVAL_SECRET,
									runtimeContext: { langfusePrompt: prompt.langfusePrompt },
									telemetry: {
										functionId: "chat",
										includeRuntimeContext: { langfusePrompt: true },
									},
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
