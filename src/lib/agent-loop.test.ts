import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stepCountIs, ToolLoopAgent, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";

import { type ApprovalPolicy, runAgentLoop } from "#/lib/agent-loop";

// A fake model that replays a script: each call returns the next response.
// No network, no API key; the tests check what the loop does with them.
type Reply =
	| { text: string }
	| { calls: { id: string; tool: string; input: unknown }[] };

const usage = {
	inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 5, text: 5, reasoning: 0 },
};

function scripted(...replies: Reply[]) {
	return new MockLanguageModelV4({
		doGenerate: replies.map((reply) =>
			"text" in reply
				? {
						content: [{ type: "text" as const, text: reply.text }],
						finishReason: { unified: "stop" as const, raw: undefined },
						usage,
						warnings: [],
					}
				: {
						content: reply.calls.map((call) => ({
							type: "tool-call" as const,
							toolCallId: call.id,
							toolName: call.tool,
							input: JSON.stringify(call.input),
						})),
						finishReason: { unified: "tool-calls" as const, raw: undefined },
						usage,
						warnings: [],
					},
		),
	});
}

// What the model was sent on its nth call, as role: summary lines.
function transcript(model: MockLanguageModelV4, call: number) {
	return (model.doGenerateCalls[call]?.prompt ?? []).map((message) => {
		if (typeof message.content === "string")
			return `${message.role}: ${message.content}`;
		return `${message.role}: ${message.content
			.map((part) =>
				part.type === "text"
					? part.text
					: part.type === "tool-call"
						? `call ${part.toolName}`
						: part.type === "tool-result"
							? `result ${JSON.stringify(part.output)}`
							: part.type,
			)
			.join(" | ")}`;
	});
}

const lookups: string[] = [];
const tools = {
	getOrder: tool({
		description: "Look up an order",
		inputSchema: z.object({ orderId: z.string() }),
		execute: async ({ orderId }) => {
			lookups.push(orderId);
			if (orderId === "missing") throw new Error("No such order.");
			return { orderId, status: "delivered" };
		},
	}),
	issueCredit: tool({
		description: "Credit an order",
		inputSchema: z.object({ orderId: z.string() }),
		execute: async ({ orderId }) => ({ issued: true, orderId }),
	}),
};

const ask = (text: string) => [{ role: "user" as const, content: text }];

describe("runAgentLoop", () => {
	test("stops when the model answers without calling a tool", async () => {
		const model = scripted({ text: "Hello!" });
		const result = await runAgentLoop({
			model,
			instructions: "Be brief.",
			messages: ask("Hi"),
			tools,
		});
		assert.equal(result.stopReason, "answered");
		assert.equal(result.text, "Hello!");
		assert.equal(model.doGenerateCalls.length, 1);
		assert.deepEqual(transcript(model, 0), ["system: Be brief.", "user: Hi"]);
	});

	test("runs a tool and feeds its result back to the model", async () => {
		const model = scripted(
			{ calls: [{ id: "c1", tool: "getOrder", input: { orderId: "o1" } }] },
			{ text: "Your order was delivered." },
		);
		const result = await runAgentLoop({
			model,
			instructions: "",
			messages: ask("Where's o1?"),
			tools,
		});
		assert.equal(result.stopReason, "answered");
		assert.equal(result.steps.length, 2);
		assert.equal(result.steps[0]?.toolCalls[0]?.outcome, "executed");
		// The second call sees the first call's tool call and its result.
		assert.deepEqual(transcript(model, 1).slice(-2), [
			"assistant: call getOrder",
			'tool: result {"type":"json","value":{"orderId":"o1","status":"delivered"}}',
		]);
	});

	test("hands a tool's error to the model instead of crashing", async () => {
		const model = scripted(
			{
				calls: [{ id: "c1", tool: "getOrder", input: { orderId: "missing" } }],
			},
			{ text: "I couldn't find that order." },
		);
		const result = await runAgentLoop({
			model,
			instructions: "",
			messages: ask("Where's my order?"),
			tools,
		});
		assert.equal(result.stopReason, "answered");
		assert.equal(result.steps[0]?.toolCalls[0]?.outcome, "error");
		assert.match(
			transcript(model, 1).at(-1) ?? "",
			/error-text.*No such order/,
		);
	});

	test("stops after maxSteps model calls", async () => {
		const forever = {
			calls: [{ id: "c", tool: "getOrder", input: { orderId: "o1" } }],
		};
		const model = scripted(forever, forever, forever, forever);
		const result = await runAgentLoop({
			model,
			instructions: "",
			messages: ask("Loop"),
			tools,
			maxSteps: 3,
		});
		assert.equal(result.stopReason, "max-steps");
		assert.equal(model.doGenerateCalls.length, 3);
	});

	test("a denied call goes back to the model with the policy's reason", async () => {
		const model = scripted(
			{ calls: [{ id: "c1", tool: "issueCredit", input: { orderId: "o1" } }] },
			{ text: "That's above the limit; I can open a review." },
		);
		const approval: ApprovalPolicy = {
			issueCredit: () => ({ type: "denied", reason: "Above the $25 limit." }),
		};
		const result = await runAgentLoop({
			model,
			instructions: "",
			messages: ask("Credit o1"),
			tools,
			approval,
		});
		assert.equal(result.stopReason, "answered");
		assert.equal(result.steps[0]?.toolCalls[0]?.outcome, "denied");
		assert.match(
			transcript(model, 1).at(-1) ?? "",
			/execution-denied.*\$25 limit/,
		);
	});

	test("a call that needs the user stops the loop, and approving resumes it", async () => {
		const model = scripted(
			{ calls: [{ id: "c1", tool: "issueCredit", input: { orderId: "o1" } }] },
			{ text: "Done: $12 will come off your next box." },
		);
		const approval: ApprovalPolicy = {
			issueCredit: () => ({ type: "user-approval", reason: "Credit $12?" }),
		};
		const first = await runAgentLoop({
			model,
			instructions: "",
			messages: ask("Credit o1"),
			tools,
			approval,
		});
		assert.equal(first.stopReason, "awaiting-approval");
		assert.deepEqual(first.pending, [
			{
				toolCallId: "c1",
				toolName: "issueCredit",
				input: { orderId: "o1" },
				reason: "Credit $12?",
			},
		]);
		assert.equal(model.doGenerateCalls.length, 1);

		// Without a decision it's still waiting, and the model isn't called.
		const stillWaiting = await runAgentLoop({
			model,
			instructions: "",
			messages: first.messages,
			tools,
			approval,
		});
		assert.equal(stillWaiting.stopReason, "awaiting-approval");
		assert.equal(model.doGenerateCalls.length, 1);

		const resumed = await runAgentLoop({
			model,
			instructions: "",
			messages: first.messages,
			tools,
			approval,
			approvals: { c1: true },
		});
		assert.equal(resumed.stopReason, "answered");
		assert.match(transcript(model, 1).at(-1) ?? "", /"issued":true/);
	});
});

// The same script through ToolLoopAgent and the hand-written loop: the model
// should see the same conversation at every step, and both should end the
// same way.
test("matches ToolLoopAgent step for step", async () => {
	const script: Reply[] = [
		{
			calls: [
				{ id: "c1", tool: "getOrder", input: { orderId: "o1" } },
				{ id: "c2", tool: "getOrder", input: { orderId: "missing" } },
			],
		},
		{ text: "o1 was delivered; I couldn't find the other one." },
	];
	const viaAgent = scripted(...script);
	const viaLoop = scripted(...script);

	const agent = new ToolLoopAgent({
		model: viaAgent,
		instructions: "Be brief.",
		tools,
		stopWhen: stepCountIs(8),
	});
	const sdk = await agent.generate({ messages: ask("Check my orders") });
	const ours = await runAgentLoop({
		model: viaLoop,
		instructions: "Be brief.",
		messages: ask("Check my orders"),
		tools,
	});

	assert.equal(ours.text, sdk.text);
	assert.equal(ours.steps.length, sdk.steps.length);
	assert.equal(viaLoop.doGenerateCalls.length, viaAgent.doGenerateCalls.length);
	for (let call = 0; call < viaAgent.doGenerateCalls.length; call++) {
		assert.deepEqual(transcript(viaLoop, call), transcript(viaAgent, call));
	}
});

test("matches ToolLoopAgent when the approval policy refuses a call", async () => {
	const script: Reply[] = [
		{ calls: [{ id: "c1", tool: "issueCredit", input: { orderId: "o1" } }] },
		{ text: "That's over the limit, so I can open a review instead." },
	];
	const refuse = () => ({
		type: "denied" as const,
		reason: "Above the $25 limit.",
	});
	const viaAgent = scripted(...script);
	const viaLoop = scripted(...script);

	const agent = new ToolLoopAgent({
		model: viaAgent,
		instructions: "",
		tools,
		toolApproval: { issueCredit: refuse },
		stopWhen: stepCountIs(8),
	});
	const sdk = await agent.generate({ messages: ask("Credit o1") });
	const ours = await runAgentLoop({
		model: viaLoop,
		instructions: "",
		messages: ask("Credit o1"),
		tools,
		approval: { issueCredit: refuse },
	});

	assert.equal(ours.text, sdk.text);
	for (let call = 0; call < viaAgent.doGenerateCalls.length; call++) {
		assert.deepEqual(transcript(viaLoop, call), transcript(viaAgent, call));
	}
});
