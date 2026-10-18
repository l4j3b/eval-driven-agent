import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";

import { AppSidebar } from "#/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "#/components/ui/sidebar";
import { TooltipProvider } from "#/components/ui/tooltip";
import { listChats } from "#/server/chats";
import { getLangfuseUrl } from "#/server/langfuse";
import { getSession } from "#/server/session";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
	// The sidebar: who's signed in, and their chat history. Chats call
	// router.invalidate() to refresh it.
	loader: async () => {
		const [chats, session, langfuseUrl] = await Promise.all([
			listChats(),
			getSession(),
			getLangfuseUrl(),
		]);
		return { chats, session, langfuseUrl };
	},
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "Mise · Agent Lab",
			},
			{
				name: "description",
				content:
					"A meal-kit assistant that demos RAG, tools, tracing, evals, and self-improvement.",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
			{
				rel: "icon",
				href: "/favicon.ico",
			},
		],
	}),
	shellComponent: RootDocument,
	component: RootLayout,
	notFoundComponent: NotFound,
});

function RootLayout() {
	const { chats, session, langfuseUrl } = Route.useLoaderData();
	return (
		<SidebarProvider>
			<AppSidebar chats={chats} langfuseUrl={langfuseUrl} session={session} />
			<SidebarInset className="h-dvh overflow-hidden">
				<Outlet />
			</SidebarInset>
		</SidebarProvider>
	);
}

function NotFound() {
	return (
		<main className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
			<p className="text-lg">This page doesn't exist.</p>
			<a
				className="text-sm text-muted-foreground underline underline-offset-4"
				href="/"
			>
				Back to Mise
			</a>
		</main>
	);
}

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html className="dark" lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				<TooltipProvider>{children}</TooltipProvider>
				<Scripts />
			</body>
		</html>
	);
}
