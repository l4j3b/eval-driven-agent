import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import * as store from "#/server/chat-store";

const chatIdInput = z.object({ chatId: z.string().regex(store.CHAT_ID) });

export const listChats = createServerFn({ method: "GET" }).handler(() =>
	store.listChats(),
);

// UIMessage types metadata and tool inputs as `unknown`, which the serializer's
// type check rejects. The values come from jsonb, so they are plain JSON.
export const getChatMessages = createServerFn({
	method: "GET",
	strict: { output: false },
})
	.validator(chatIdInput)
	.handler(({ data }) => store.loadMessages(data.chatId));

export const deleteChat = createServerFn({ method: "POST" })
	.validator(chatIdInput)
	.handler(({ data }) => store.deleteChat(data.chatId));
