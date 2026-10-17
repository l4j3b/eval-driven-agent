import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { Chat } from "#/components/chat";
import { PageHeader } from "#/components/page-header";
import { getChatMessages } from "#/server/chats";

const rootRoute = getRouteApi("__root__");

export const Route = createFileRoute("/chat/$chatId")({
	loader: ({ params }) => getChatMessages({ data: { chatId: params.chatId } }),
	component: ChatPage,
});

function ChatPage() {
	const { chatId } = Route.useParams();
	const messages = Route.useLoaderData();
	const title = rootRoute.useLoaderData({
		select: (chats) => chats.find((chat) => chat.id === chatId)?.title,
	});

	return (
		<>
			<PageHeader>{title ?? "New chat"}</PageHeader>
			<Chat id={chatId} initialMessages={messages} key={chatId} />
		</>
	);
}
