import type { UIMessage } from "ai";
import { and, asc, desc, eq, isNull, type SQL, sql } from "drizzle-orm";

import { db } from "#/db/client";
import { chatMessages, chats } from "#/db/schema";

// Chat ids come from the URL and user message ids from the browser, so both
// are treated as opaque tokens.
export const CHAT_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const MESSAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

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

// Chats belong to the customer who started them (or to guests, when null).
const ownedBy = (customerId: string | null): SQL =>
	customerId ? eq(chats.customerId, customerId) : isNull(chats.customerId);

export async function listChats(customerId: string | null) {
	return db
		.select({ id: chats.id, title: chats.title, updatedAt: chats.updatedAt })
		.from(chats)
		.where(ownedBy(customerId))
		.orderBy(desc(chats.updatedAt))
		.limit(50);
}

// undefined when the chat doesn't exist yet.
export async function chatOwner(chatId: string) {
	const [row] = await db
		.select({ customerId: chats.customerId })
		.from(chats)
		.where(eq(chats.id, chatId));
	return row ? row.customerId : undefined;
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
export async function saveMessages(
	chatId: string,
	all: UIMessage[],
	customerId: string | null,
) {
	const messages = all.filter(hasContent);
	if (messages.length === 0) return;
	await db.transaction(async (tx) => {
		await tx
			.insert(chats)
			.values({ id: chatId, title: titleFrom(messages), customerId })
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
				// Message ids come partly from the browser: never let one chat
				// overwrite a message that belongs to another.
				setWhere: sql`${chatMessages.chatId} = excluded.chat_id`,
				set: {
					parts: sql`excluded.parts`,
					// Merge, so feedback saved on a message survives the message
					// being updated later (e.g. an approval continuing the turn).
					metadata: sql`coalesce(${chatMessages.metadata}, '{}'::jsonb) || coalesce(excluded.metadata, '{}'::jsonb)`,
				},
			});
	});
}

export async function deleteChat(chatId: string, customerId: string | null) {
	await db.delete(chats).where(and(eq(chats.id, chatId), ownedBy(customerId)));
}
