import {
	type LanguageModel,
	stepCountIs,
	ToolLoopAgent,
	type ToolSet,
	type UIMessage,
} from "ai";

import { MODELS } from "#/lib/models";
import { SourceRegistry } from "#/lib/sources";
import {
	loadAgentPrompt,
	loadCustomer,
	type PromptSelector,
} from "#/server/agent/prompt";
import {
	AUTO_CREDIT_LIMIT,
	createTools,
	quoteCredit,
} from "#/server/agent/tools";

// Each step is one model call, which may ask for tools; the loop stops when
// the model answers without calling one, or after this many steps.
export const MAX_STEPS = 8;

// Credits need the customer's OK, and the policy is checked before asking:
// anything the policy forbids, including amounts over the cap, is refused
// outright with a reason the agent can relay. Same shape as the AI SDK's
// `toolApproval` functions, so the hand-written loop (src/lib/agent-loop.ts)
// can use it too.
export function creditApproval(customerId: string | null) {
	return async (input: unknown) => {
		const { orderId, recipeId } = input as {
			orderId: string;
			recipeId: string;
		};
		if (!customerId) {
			return { type: "denied" as const, reason: "No customer is signed in." };
		}
		const quote = await quoteCredit(customerId, orderId, recipeId);
		if (!quote.ok) return { type: "denied" as const, reason: quote.error };
		if (quote.overLimit) {
			const already = quote.alreadyCredited
				? ` on top of $${quote.alreadyCredited.toFixed(2)} already credited for this box`
				: "";
			return {
				type: "denied" as const,
				reason: `This credit would be $${quote.amount.toFixed(2)}${already}, above the $${AUTO_CREDIT_LIMIT} automatic limit per box. Offer to open a support review instead.`,
			};
		}
		return {
			type: "user-approval" as const,
			reason: `Credit $${quote.amount.toFixed(2)} for ${quote.recipeTitle} (order ${orderId}, delivered ${quote.deliveryDate}).`,
		};
	};
}

export type AgentOptions = {
	customerId: string | null;
	chatId: string;
	// Earlier messages, so citation numbers continue from them.
	history: UIMessage[];
	prompt?: PromptSelector;
	// Evals: tools that write report what they would do instead.
	dryRun?: boolean;
	// Evals: run another model than the prompt version's, for an experiment.
	modelOverride?: string;
	// Evals: wrap the model, e.g. to rate-limit it.
	wrapModel?: (modelId: string) => LanguageModel;
	functionId?: string;
};

// The agent for one request: a ToolLoopAgent bound to this customer's tools
// and this prompt version. Chat streams it (`agent.stream`), evals run it to
// the end (`agent.generate`), so both use exactly the same model, prompt,
// tools and approval policy. ToolLoopAgent runs the loop: call the model, run
// the tools it asks for, feed the results back, repeat until it answers.
// docs/07-agent-loop.md walks through a hand-written version of that loop.
export async function createAgent(options: AgentOptions) {
	const customer = await loadCustomer(options.customerId);
	const tools = createTools({
		customer,
		sources: new SourceRegistry(options.history),
		chatId: options.chatId,
		dryRun: options.dryRun,
	}) as ToolSet;
	const prompt = await loadAgentPrompt(customer, options.prompt);
	// The model is part of the prompt version; versions that don't pin one
	// use the default agent model.
	const modelId = options.modelOverride ?? prompt.model ?? MODELS.agent;
	const model = options.wrapModel ? options.wrapModel(modelId) : modelId;
	const agent = new ToolLoopAgent({
		id: "mise-agent",
		model,
		instructions: prompt.instructions,
		tools,
		stopWhen: stepCountIs(MAX_STEPS),
		// Each step is a model call; the free tier allows ~5 a minute, so
		// retry rate limits with backoff instead of failing the turn.
		maxRetries: 4,
		toolApproval: { issueCredit: creditApproval(options.customerId) },
		experimental_toolApprovalSecret: process.env.TOOL_APPROVAL_SECRET,
		runtimeContext: { langfusePrompt: prompt.langfusePrompt },
		telemetry: {
			functionId: options.functionId ?? "chat",
			includeRuntimeContext: { langfusePrompt: true },
		},
	});
	return { agent, model, customer, prompt, tools, modelId };
}
