import { useChat } from "@ai-sdk/react";
import { useRouter } from "@tanstack/react-router";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ChefHatIcon } from "lucide-react";

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
import { InputGroupAddon } from "#/components/ui/input-group";

const SUGGESTIONS = [
	"Something cozy for a rainy night, under 40 minutes",
	"I'm allergic to peanuts. What Thai dishes can I make?",
	"My box was missing the salmon. Can I get a credit?",
];

export function Chat({
	id,
	initialMessages,
}: {
	id: string;
	initialMessages: UIMessage[];
}) {
	const router = useRouter();
	const { messages, sendMessage, status, stop, error } = useChat({
		id,
		messages: initialMessages,
		transport: new DefaultChatTransport({
			api: "/api/chat",
			// The server keeps the history, so only the new message is sent.
			prepareSendMessagesRequest: ({ id, messages }) => ({
				body: { id, message: messages.at(-1) },
			}),
		}),
		// Refresh the sidebar so a new chat shows up and moves to the top.
		onFinish: () =>
			void router.invalidate({
				filter: (match) => match.routeId === "__root__",
			}),
	});

	const submit = (text: string) => {
		if (!text.trim() || status === "submitted" || status === "streaming") {
			return;
		}
		void sendMessage({ text });
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
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
		</div>
	);
}
