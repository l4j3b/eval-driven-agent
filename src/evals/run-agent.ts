import type { ModelMessage } from "ai";
import { nanoid } from "nanoid";

import type { EvalInput } from "#/lib/evals";
import type { Source } from "#/lib/sources";
import { createAgent } from "#/server/agent/agent";
import type { PromptSelector } from "#/server/agent/prompt";
import { throttled } from "#/server/throttle";

export type ToolCallRecord = {
	name: string;
	input: Record<string, unknown>;
	// "approval-requested": waiting on the customer (never granted in evals).
	// "denied": refused by the approval policy, with a reason.
	outcome: "executed" | "error" | "approval-requested" | "denied";
	output?: unknown;
	reason?: string;
};

export type AgentOutput = {
	text: string;
	toolCalls: ToolCallRecord[];
	sources: Source[];
	steps: number;
	usage: { inputTokens?: number; outputTokens?: number };
	latencyMs: number;
	prompt: { name: string; version: number; isFallback: boolean };
	// The agent model that actually ran.
	model: string;
	// The compiled system prompt and the tools' descriptions, so the judge
	// knows what the agent was told.
	instructions: string;
	toolDescriptions: Record<string, string>;
};

// Runs one eval case through the same agent the chat uses (same prompt,
// tools and approval policy), without streaming and without side effects:
// approvals are never granted and tools that write run in dry-run mode.
export async function runAgent(
	input: EvalInput,
	prompt: PromptSelector,
	modelOverride?: string,
): Promise<AgentOutput> {
	const mise = await createAgent({
		customerId: input.customerId,
		chatId: `eval-${nanoid(8)}`,
		history: [],
		prompt,
		dryRun: true,
		modelOverride,
		wrapModel: (modelId) => throttled(modelId),
		functionId: "eval-agent",
	});
	const messages: ModelMessage[] = input.transcript.map((turn) => ({
		role: turn.role,
		content: turn.text,
	}));

	const started = performance.now();
	const result = await mise.agent.generate({ messages });
	const latencyMs = Math.round(performance.now() - started);

	const calls = new Map<string, ToolCallRecord>();
	for (const part of result.steps.flatMap((step) => step.content)) {
		if (part.type === "tool-call") {
			calls.set(part.toolCallId, {
				name: part.toolName,
				input: (part.input ?? {}) as Record<string, unknown>,
				outcome: "executed",
			});
		} else if (part.type === "tool-result") {
			const call = calls.get(part.toolCallId);
			if (call) call.output = part.output;
		} else if (part.type === "tool-error") {
			const call = calls.get(part.toolCallId);
			if (call) {
				call.outcome = "error";
				call.output = String(part.error);
			}
		} else if (part.type === "tool-approval-request") {
			const call = calls.get(part.toolCall.toolCallId);
			if (call) {
				call.outcome = "approval-requested";
				call.reason = part.reason;
			}
		} else if (part.type === "tool-approval-response") {
			const call = calls.get(part.toolCall.toolCallId);
			if (call && !part.approved) {
				call.outcome = "denied";
				call.reason = part.reason ?? call.reason;
			}
		}
	}
	const toolCalls = [...calls.values()];

	return {
		// Everything the customer would see, across steps.
		text: result.steps
			.map((step) => step.text)
			.filter(Boolean)
			.join("\n\n")
			.trim(),
		toolCalls,
		sources: toolCalls.flatMap(
			(call) =>
				(call.output as { sources?: Source[] } | undefined)?.sources ?? [],
		),
		steps: result.steps.length,
		usage: {
			inputTokens: result.totalUsage.inputTokens,
			outputTokens: result.totalUsage.outputTokens,
		},
		latencyMs,
		prompt: mise.prompt.langfusePrompt,
		model: mise.modelId,
		instructions: mise.prompt.instructions,
		toolDescriptions: Object.fromEntries(
			Object.entries(mise.tools).map(([name, tool]) => [
				name,
				typeof tool.description === "string" ? tool.description : "",
			]),
		),
	};
}
