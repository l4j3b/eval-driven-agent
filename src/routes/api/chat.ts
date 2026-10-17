import "#/server/telemetry";

import { propagateAttributes } from "@langfuse/tracing";
import { createFileRoute } from "@tanstack/react-router";
import {
	convertToModelMessages,
	createIdGenerator,
	createUIMessageStreamResponse,
	streamText,
	toUIMessageStream,
	type UIMessage,
	validateUIMessages,
} from "ai";

import { MODELS } from "#/lib/models";
import { AGENT_INSTRUCTIONS } from "#/lib/prompts";
import { CHAT_ID, loadMessages, saveMessages } from "#/server/chat-store";

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

				// The client sends only the new message; history comes from the database,
				// so a client can't rewrite earlier turns.
				const { id, message }: { id: string; message: UIMessage } =
					await request.json();
				if (!CHAT_ID.test(id)) {
					return new Response("Invalid chat id.", { status: 400 });
				}

				const messages = await validateUIMessages({
					messages: [...(await loadMessages(id)), message],
				});
				await saveMessages(id, [message]);

				// One Langfuse session per chat, so every turn of a conversation
				// is grouped together in the trace view.
				const result = await propagateAttributes(
					{ sessionId: id, tags: ["chat"] },
					async () =>
						streamText({
							model: MODELS.agent,
							instructions: AGENT_INSTRUCTIONS,
							messages: await convertToModelMessages(messages),
							telemetry: { functionId: "chat" },
						}),
				);

				return createUIMessageStreamResponse({
					stream: toUIMessageStream({
						stream: result.stream,
						originalMessages: messages,
						generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
						onEnd: ({ responseMessage }) => saveMessages(id, [responseMessage]),
					}),
				});
			},
		},
	},
});
