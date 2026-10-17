import type { UIMessage } from "ai";
import { asc, desc, eq, sql } from "drizzle-orm";

import { db } from "#/db/client";
import { chatMessages, chats } from "#/db/schema";

// Chat ids come from the URL, so treat them as opaque tokens.
export const CHAT_ID = /^[A-Za-z0-9_-]{1,64}$/;

const TITLE_LENGTH = 60;

function titleFrom(messages: UIMessage[]) {
	const text = messages
		.find((message) => message.role === "user")
		?.parts.map((part) => (part.type === "text" ? part.text : ""))
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
	if (!text) return "New chat";
	return text.length > TITLE_LENGTH
		? `${text.slice(0, TITLE_LENGTH - 1).trimEnd()}…`
		: text;
}

// A reply whose model call failed still ends the stream, with no content.
// Saving it would leave an empty assistant turn in the history.
function hasContent(message: UIMessage) {
	return message.parts.some((part) => part.type !== "step-start");
}

export async function listChats() {
	return db
		.select({ id: chats.id, title: chats.title, updatedAt: chats.updatedAt })
		.from(chats)
		.orderBy(desc(chats.updatedAt))
		.limit(50);
}

export async function loadMessages(chatId: string): Promise<UIMessage[]> {
	const rows = await db
		.select()
		.from(chatMessages)
		.where(eq(chatMessages.chatId, chatId))
		.orderBy(asc(chatMessages.createdAt));
	return rows
		.map((row) => ({
			id: row.id,
			role: row.role as UIMessage["role"],
			parts: row.parts as UIMessage["parts"],
			...(row.metadata ? { metadata: row.metadata } : {}),
		}))
		.filter(hasContent);
}

// Creates the chat on its first message (titled after it) and upserts messages,
// so a reply that grows across steps overwrites its earlier version.
export async function saveMessages(chatId: string, all: UIMessage[]) {
	const messages = all.filter(hasContent);
	if (messages.length === 0) return;
	await db.transaction(async (tx) => {
		await tx
			.insert(chats)
			.values({ id: chatId, title: titleFrom(messages) })
			.onConflictDoUpdate({
				target: chats.id,
				set: { updatedAt: sql`now()` },
			});
		await tx
			.insert(chatMessages)
			.values(
				messages.map((message) => ({
					id: message.id,
					chatId,
					role: message.role,
					parts: message.parts,
					metadata: message.metadata ?? null,
				})),
			)
			.onConflictDoUpdate({
				target: chatMessages.id,
				set: {
					parts: sql`excluded.parts`,
					metadata: sql`excluded.metadata`,
				},
			});
	});
}

export async function deleteChat(chatId: string) {
	await db.delete(chats).where(eq(chats.id, chatId));
}
