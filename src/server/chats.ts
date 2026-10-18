import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import * as store from "#/server/chat-store";
import { currentCustomerId } from "#/server/session.server";

const chatIdInput = z.object({ chatId: z.string().regex(store.CHAT_ID) });

export const listChats = createServerFn({ method: "GET" }).handler(() =>
	store.listChats(currentCustomerId()),
);

// UIMessage types metadata and tool inputs as `unknown`, which the serializer's
// type check rejects. The values come from jsonb, so they are plain JSON.
export const getChatMessages = createServerFn({
	method: "GET",
	strict: { output: false },
})
	.validator(chatIdInput)
	.handler(async ({ data }) => {
		// Another customer's chat looks empty rather than leaking its messages.
		const owner = await store.chatOwner(data.chatId);
		if (owner !== undefined && owner !== currentCustomerId()) return [];
		return store.loadMessages(data.chatId);
	});

export const deleteChat = createServerFn({ method: "POST" })
	.validator(chatIdInput)
	.handler(({ data }) => store.deleteChat(data.chatId, currentCustomerId()));
