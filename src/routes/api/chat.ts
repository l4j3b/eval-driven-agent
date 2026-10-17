import "#/server/telemetry";

import { propagateAttributes } from "@langfuse/tracing";
import { createFileRoute } from "@tanstack/react-router";
import {
	convertToModelMessages,
	createUIMessageStreamResponse,
	streamText,
	toUIMessageStream,
	type UIMessage,
} from "ai";

import { MODELS } from "#/lib/models";
import { AGENT_INSTRUCTIONS } from "#/lib/prompts";

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

				const { id, messages }: { id: string; messages: UIMessage[] } =
					await request.json();

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
					stream: toUIMessageStream({ stream: result.stream }),
				});
			},
		},
	},
});
