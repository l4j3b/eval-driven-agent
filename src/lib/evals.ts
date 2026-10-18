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

// What a good answer must do, in plain words (a rubric for the judge), and
// optionally an example of one.
export type EvalExpected = {
	criteria: string;
	reference?: string;
};

// Per-message metadata stored with each assistant message.
export type MessageMetadata = {
	traceId?: string;
	feedback?: "up" | "down";
	feedbackComment?: string;
	feedbackAt?: string;
	datasetItemId?: string;
};
