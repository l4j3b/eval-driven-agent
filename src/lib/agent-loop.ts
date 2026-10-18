import {
	generateText,
	type JSONValue,
	type LanguageModel,
	type ModelMessage,
	type ToolResultPart,
	type ToolSet,
} from "ai";

// A hand-written agent loop, for study. The app runs its agent with the AI
// SDK's ToolLoopAgent (src/server/agent/agent.ts). This is the same loop with
// nothing hidden:
//
//   1. call the model with the conversation and the tools' descriptions
//   2. no tool calls? the model answered: stop
//   3. otherwise run each tool call (asking the approval policy first),
//      append the results to the conversation, and go back to 1
//   4. stop after `maxSteps` model calls, or when a call needs the user
//
// docs/07-agent-loop.md compares it with what ToolLoopAgent adds.

// What an approval policy can say about a tool call: the same shapes as the
// AI SDK's `toolApproval`, so one policy works with both loops.
export type ApprovalDecision = {
	type: "approved" | "denied" | "user-approval" | "not-applicable";
	reason?: string;
};

export type ApprovalPolicy = Record<
	string,
	(
		input: unknown,
	) => ApprovalDecision | undefined | Promise<ApprovalDecision | undefined>
>;

type ToolCall = { toolCallId: string; toolName: string; input: unknown };

export type LoopToolCall = ToolCall & {
	outcome: "executed" | "error" | "denied" | "awaiting-approval";
	output?: unknown;
	reason?: string;
};

export type LoopStep = { text: string; toolCalls: LoopToolCall[] };

export type LoopResult = {
	stopReason: "answered" | "awaiting-approval" | "max-steps";
	// The model's last words.
	text: string;
	steps: LoopStep[];
	// The whole conversation so far, to continue from (or resume, after an
	// approval).
	messages: ModelMessage[];
	// Calls waiting for the user's decision.
	pending: (ToolCall & { reason?: string })[];
};

export type LoopOptions = {
	model: LanguageModel;
	instructions: string;
	messages: ModelMessage[];
	tools: ToolSet;
	approval?: ApprovalPolicy;
	// The user's decisions on calls an earlier run left pending, by call id.
	approvals?: Record<string, boolean>;
	maxSteps?: number;
};

export async function runAgentLoop(options: LoopOptions): Promise<LoopResult> {
	const { model, instructions, tools, approval = {}, maxSteps = 8 } = options;
	const messages = [...options.messages];
	const steps: LoopStep[] = [];
	const done = (
		stopReason: LoopResult["stopReason"],
		pending: LoopResult["pending"] = [],
	): LoopResult => ({
		stopReason,
		text: steps.at(-1)?.text ?? "",
		steps,
		messages,
		pending,
	});

	// Resuming: an earlier run stopped on calls that needed the user. Their
	// decisions arrive now; run the approved calls, tell the model about the
	// declined ones, and carry on as if the step had just finished.
	const waiting = unansweredToolCalls(messages);
	if (waiting.length > 0) {
		const undecided = waiting.filter(
			(call) => options.approvals?.[call.toolCallId] === undefined,
		);
		if (undecided.length > 0) return done("awaiting-approval", undecided);
		const results: ToolResultPart[] = [];
		for (const call of waiting) {
			const result = options.approvals?.[call.toolCallId]
				? await execute(tools, call, messages)
				: denied(call, "The user declined.");
			results.push(result.part);
		}
		messages.push({ role: "tool", content: results });
	}

	for (let step = 0; step < maxSteps; step++) {
		// 1. One model call. The tools go in without their `execute` function,
		//    so the SDK only parses and validates the calls the model makes:
		//    running them is this loop's job.
		const response = await generateText({
			model,
			system: instructions,
			messages,
			tools: declarationsOf(tools),
		});
		messages.push(...response.response.messages);
		const record: LoopStep = { text: response.text, toolCalls: [] };
		steps.push(record);

		// 2. No tool calls: that's the answer.
		if (response.toolCalls.length === 0) return done("answered");

		// 3. Run the calls. Each result, error or refusal goes back to the
		//    model as a tool message, so it can use it, retry, or explain.
		const results: ToolResultPart[] = [];
		const pending: LoopResult["pending"] = [];
		for (const call of response.toolCalls) {
			if ("invalid" in call && call.invalid) {
				const result = failed(call, `Invalid input: ${String(call.error)}`);
				record.toolCalls.push(result.call);
				results.push(result.part);
				continue;
			}
			const decision = await approval[call.toolName]?.(call.input);
			if (decision?.type === "denied") {
				const result = denied(call, decision.reason);
				record.toolCalls.push(result.call);
				results.push(result.part);
			} else if (decision?.type === "user-approval") {
				record.toolCalls.push({
					...pick(call),
					outcome: "awaiting-approval",
					reason: decision.reason,
				});
				pending.push({ ...pick(call), reason: decision.reason });
			} else {
				const result = await execute(tools, call, messages);
				record.toolCalls.push(result.call);
				results.push(result.part);
			}
		}
		if (results.length > 0) messages.push({ role: "tool", content: results });

		// 4. A call needs the user. A server can't wait for a click inside a
		//    request, so the loop stops; calling it again with `approvals`
		//    resumes from here.
		if (pending.length > 0) return done("awaiting-approval", pending);
	}
	return done("max-steps");
}

const pick = ({ toolCallId, toolName, input }: ToolCall): ToolCall => ({
	toolCallId,
	toolName,
	input,
});

// The tools as the model sees them: name, description and input schema.
function declarationsOf(tools: ToolSet): ToolSet {
	return Object.fromEntries(
		Object.entries(tools).map(([name, tool]) => [
			name,
			{ ...tool, execute: undefined },
		]),
	);
}

async function execute(
	tools: ToolSet,
	call: ToolCall,
	messages: ModelMessage[],
) {
	try {
		const tool = tools[call.toolName];
		if (!tool?.execute)
			throw new Error(`There's no tool named ${call.toolName}.`);
		const output = await tool.execute(call.input, {
			toolCallId: call.toolCallId,
			messages,
			context: undefined as never,
		});
		// Tool outputs go to the model as JSON (dates become strings).
		const value = JSON.parse(JSON.stringify(output ?? null)) as JSONValue;
		return {
			call: { ...pick(call), outcome: "executed", output } as LoopToolCall,
			part: resultPart(call, { type: "json", value }),
		};
	} catch (error) {
		// "Error: No such order.", as the AI SDK sends it (the parity test
		// in agent-loop.test.ts checks the two loops send the same thing).
		return failed(call, String(error));
	}
}

function failed(call: ToolCall, message: string) {
	return {
		call: { ...pick(call), outcome: "error", reason: message } as LoopToolCall,
		part: resultPart(call, { type: "error-text", value: message }),
	};
}

function denied(call: ToolCall, reason?: string) {
	return {
		call: { ...pick(call), outcome: "denied", reason } as LoopToolCall,
		part: resultPart(call, { type: "execution-denied", reason }),
	};
}

const resultPart = (
	call: ToolCall,
	output: ToolResultPart["output"],
): ToolResultPart => ({
	type: "tool-result",
	toolCallId: call.toolCallId,
	toolName: call.toolName,
	output,
});

// Tool calls in the last assistant message that no tool message answered.
function unansweredToolCalls(messages: ModelMessage[]): ToolCall[] {
	const last = messages.findLastIndex(
		(message) => message.role === "assistant",
	);
	const assistant = messages[last];
	if (!assistant || typeof assistant.content === "string") return [];
	const answered = new Set(
		messages
			.slice(last + 1)
			.flatMap((message) =>
				message.role === "tool"
					? message.content.flatMap((part) =>
							part.type === "tool-result" ? [part.toolCallId] : [],
						)
					: [],
			),
	);
	return assistant.content.flatMap((part) =>
		part.type === "tool-call" && !answered.has(part.toolCallId)
			? [pick(part)]
			: [],
	);
}
