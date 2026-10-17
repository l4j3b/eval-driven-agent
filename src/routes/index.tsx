import { useChat } from "@ai-sdk/react";
import { createFileRoute } from "@tanstack/react-router";
import { DefaultChatTransport } from "ai";
import { ChefHatIcon, SquarePenIcon } from "lucide-react";
import { nanoid } from "nanoid";
import { useState } from "react";

import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
	ConversationScrollButton,
} from "#/components/ai-elements/conversation";
import {
	Message,
	MessageContent,
	MessageResponse,
} from "#/components/ai-elements/message";
import {
	PromptInput,
	PromptInputBody,
	type PromptInputMessage,
	PromptInputSubmit,
	PromptInputTextarea,
} from "#/components/ai-elements/prompt-input";
import { Suggestion } from "#/components/ai-elements/suggestion";
import { Button } from "#/components/ui/button";
import { InputGroupAddon } from "#/components/ui/input-group";

export const Route = createFileRoute("/")({ component: Home });

const SUGGESTIONS = [
	"Something cozy for a rainy night, under 40 minutes",
	"I'm allergic to peanuts. What Thai dishes can I make?",
	"My box was missing the salmon. Can I get a credit?",
];

function Home() {
	const [chatId, setChatId] = useState(() => nanoid());
	const { messages, sendMessage, status, stop, error } = useChat({
		id: chatId,
		transport: new DefaultChatTransport({ api: "/api/chat" }),
	});

	const submit = (text: string) => {
		if (!text.trim() || status === "submitted" || status === "streaming") {
			return;
		}
		void sendMessage({ text });
	};

	return (
		<main className="flex h-dvh flex-col">
			<header className="flex items-center justify-between border-b px-4 py-3">
				<div className="flex items-center gap-2 font-semibold text-lg tracking-tight">
					<ChefHatIcon className="size-5" />
					Mise
				</div>
				{messages.length > 0 && (
					<Button onClick={() => setChatId(nanoid())} size="sm" variant="ghost">
						<SquarePenIcon className="size-4" />
						New chat
					</Button>
				)}
			</header>

			<Conversation className="min-h-0 flex-1">
				<ConversationContent className="mx-auto w-full max-w-3xl py-8">
					{messages.length === 0 ? (
						<ConversationEmptyState>
							<ChefHatIcon className="size-8 text-muted-foreground" />
							<h1 className="font-semibold text-2xl tracking-tight">
								What are we cooking?
							</h1>
							<p className="text-muted-foreground">
								Ask about recipes, cooking, or your Mise account.
							</p>
							<div className="mt-4 flex flex-wrap justify-center gap-2">
								{SUGGESTIONS.map((suggestion) => (
									<Suggestion
										className="font-normal text-muted-foreground"
										key={suggestion}
										onClick={submit}
										suggestion={suggestion}
									/>
								))}
							</div>
						</ConversationEmptyState>
					) : (
						messages.map((message) => (
							<Message from={message.role} key={message.id}>
								<MessageContent>
									{message.parts.map((part, index) => {
										if (part.type !== "text") return null;
										const key = `${message.id}-${index}`;
										return message.role === "user" ? (
											<p className="whitespace-pre-wrap" key={key}>
												{part.text}
											</p>
										) : (
											<MessageResponse key={key}>{part.text}</MessageResponse>
										);
									})}
								</MessageContent>
							</Message>
						))
					)}
					{error && <p className="text-destructive text-sm">{error.message}</p>}
				</ConversationContent>
				<ConversationScrollButton />
			</Conversation>

			<div className="mx-auto w-full max-w-3xl px-4 pb-4">
				<PromptInput
					className="[&_[data-slot=input-group]]:h-auto [&_[data-slot=input-group]]:items-end [&_[data-slot=input-group]]:rounded-xl [&_[data-slot=input-group]]:bg-card"
					onSubmit={(message: PromptInputMessage) => submit(message.text)}
				>
					<PromptInputBody>
						<PromptInputTextarea
							className="min-h-0 py-3.5 pl-5 text-base leading-6 md:text-base"
							placeholder="Ask Mise…"
							rows={1}
						/>
					</PromptInputBody>
					<InputGroupAddon
						align="inline-end"
						className="py-2 pr-2.5 has-[>button]:mr-0"
					>
						<PromptInputSubmit
							className="size-9 rounded-full"
							onStop={stop}
							status={status}
						/>
					</InputGroupAddon>
				</PromptInput>
			</div>
		</main>
	);
}
