import { createFileRoute, redirect } from "@tanstack/react-router";
import { nanoid } from "nanoid";

// "/" always starts a fresh chat. The chat row is only created when its first
// message is saved, so abandoned chats never reach the history.
export const Route = createFileRoute("/")({
	beforeLoad: () => {
		throw redirect({ to: "/chat/$chatId", params: { chatId: nanoid() } });
	},
});
