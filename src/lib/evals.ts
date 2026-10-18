// The shape of eval cases, shared by the flywheel (phase 4), which turns bad
// answers into cases, and the eval runner (phase 5), which replays them.

export const EVAL_DATASET = "mise-agent-evals";

// What gets replayed: who is signed in, and the conversation up to the user
// message that got a bad answer. Text only: earlier tool results aren't
// replayed, so the agent has to look things up again, as it would live.
export type EvalInput = {
	customerId: string | null;
	transcript: { role: "user" | "assistant"; text: string }[];
};

// What a good answer must do, in plain words (a rubric for the judge),
// optionally an example of one, and checks code can verify without a judge.
export type EvalExpected = {
	criteria: string;
	reference?: string;
	checks?: EvalChecks;
};

export type EvalChecks = {
	// Tools the agent must call, and must not call.
	tools?: { required?: string[]; forbidden?: string[] };
	// Phrases the answer must contain (a nested array means any one of them),
	// and must not contain. Case-insensitive.
	text?: { include?: (string | string[])[]; exclude?: string[] };
	// Recipe or article ids retrieval should surface (recall).
	sources?: string[];
	// The credit the agent should attempt; policy may still refuse it.
	credit?: { orderId: string; recipeId: string };
	// Every recipe the answer names must satisfy these.
	recipes?: {
		cuisine?: string;
		maxMinutes?: number;
		dietTags?: string[];
		min?: number;
	};
	// Facts from tools must be cited as [n].
	requireCitations?: boolean;
};

export type EvalCategory =
	| "knowledge"
	| "policy"
	| "safety"
	| "account"
	| "actions"
	| "injection"
	| "scope";

// "train" cases are what the optimizer (phase 6) may look at; "test" cases are
// held out, so an improvement has to generalize, not just fit the examples.
export type EvalSplit = "train" | "test";

export type EvalItemMetadata = {
	source: "seed" | "user-feedback";
	category?: EvalCategory;
	split?: EvalSplit;
	[key: string]: unknown;
};

// When a case passes (computed in src/evals/scorers.ts).
export const PASS_RULE =
	"every code check passes, correctness ≥ 4/5, faithfulness ≥ 3/5 (recall is reported, not gated)";

// Per-message metadata stored with each assistant message.
export type MessageMetadata = {
	traceId?: string;
	feedback?: "up" | "down";
	feedbackComment?: string;
	feedbackAt?: string;
	datasetItemId?: string;
};
