import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

import { TooltipProvider } from "#/components/ui/tooltip";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
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
	notFoundComponent: NotFound,
});

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
