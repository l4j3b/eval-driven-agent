import { useChat } from "@ai-sdk/react";
import { useRouter } from "@tanstack/react-router";
import {
	DefaultChatTransport,
	type InferUITools,
	isToolUIPart,
	lastAssistantMessageIsCompleteWithApprovalResponses,
	type UIDataTypes,
	type UIMessage,
} from "ai";
import { ChefHatIcon } from "lucide-react";
import { useMemo } from "react";

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
import { Shimmer } from "#/components/ai-elements/shimmer";
import { Suggestion } from "#/components/ai-elements/suggestion";
import {
	citationLinks,
	citedNumbers,
	linkCitations,
	SourceList,
} from "#/components/chat/sources";
import { ToolCall } from "#/components/chat/tool-call";
import { InputGroupAddon } from "#/components/ui/input-group";
import { sourcesIn } from "#/lib/sources";
import type { AgentTools } from "#/server/agent/tools";

export type MiseUIMessage = UIMessage<
	unknown,
	UIDataTypes,
	InferUITools<AgentTools>
>;

const SUGGESTIONS = [
	"Something cozy for a rainy night, under 40 minutes",
	"Any Thai dishes I can make with my allergies?",
	"My box this week was missing the salmon. Can I get a credit?",
	"What's in my next box?",
];

export function Chat({
	id,
	initialMessages,
}: {
	id: string;
	initialMessages: UIMessage[];
}) {
	const router = useRouter();
	const {
		messages,
		sendMessage,
		addToolApprovalResponse,
		status,
		stop,
		error,
	} = useChat<MiseUIMessage>({
		id,
		messages: initialMessages as MiseUIMessage[],
		transport: new DefaultChatTransport({
			api: "/api/chat",
			// The server keeps the history, so only the new (or just-approved)
			// message is sent.
			prepareSendMessagesRequest: ({ id, messages }) => ({
				body: { id, message: messages.at(-1) },
			}),
		}),
		// After the customer approves or declines a credit, continue the turn.
		sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
		// Refresh the sidebar so a new chat shows up and moves to the top.
		onFinish: () =>
			void router.invalidate({
				filter: (match) => match.routeId === "__root__",
			}),
	});

	// Citation numbers are unique across the chat, so one map serves every answer.
	const sources = useMemo(
		() => new Map(sourcesIn(messages).map((source) => [source.n, source])),
		[messages],
	);
	const components = useMemo(() => ({ a: citationLinks(sources) }), [sources]);

	const busy = status === "submitted" || status === "streaming";
	const submit = (text: string) => {
		if (!text.trim() || busy) return;
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
							<div className="mt-4 flex max-w-xl flex-wrap justify-center gap-2">
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
						messages.map((message) => {
							const text = message.parts
								.map((part) => (part.type === "text" ? part.text : ""))
								.join("\n");
							const cited = [...new Set(citedNumbers(text))]
								.sort((a, b) => a - b)
								.flatMap((n) => {
									const source = sources.get(n);
									return source ? [source] : [];
								});
							return (
								<Message from={message.role} key={message.id}>
									<MessageContent
										className={message.role === "assistant" ? "w-full" : ""}
									>
										{message.parts.map((part, index) => {
											const key = `${message.id}-${index}`;
											if (isToolUIPart(part)) {
												return (
													<ToolCall
														key={key}
														onApproval={(approvalId, approved) =>
															addToolApprovalResponse({
																id: approvalId,
																approved,
															})
														}
														part={part}
													/>
												);
											}
											if (part.type !== "text") return null;
											return message.role === "user" ? (
												<p className="whitespace-pre-wrap" key={key}>
													{part.text}
												</p>
											) : (
												<MessageResponse components={components} key={key}>
													{linkCitations(part.text)}
												</MessageResponse>
											);
										})}
										{message.role === "assistant" && (
											<SourceList sources={cited} />
										)}
									</MessageContent>
								</Message>
							);
						})
					)}
					{status === "submitted" && (
						<Shimmer className="text-sm">Thinking…</Shimmer>
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
