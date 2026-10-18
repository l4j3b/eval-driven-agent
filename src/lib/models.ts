// Every model goes through the Vercel AI Gateway (AI_GATEWAY_API_KEY), so a
// model is just a "provider/model" string and switching is a one-line change.
// Gemini models run on the gateway's free tier; Claude needs paid credits.
export const MODELS = {
	// Answers users, calls tools. A prompt version can pin its own model in its
	// Langfuse config ({ "model": "..." }); this is the model for versions that
	// don't, so it should stay fixed: changing it changes what they mean.
	agent: "google/gemini-2.5-flash",
	// Writes the dummy data.
	generator: "google/gemini-2.5-flash",
	// Cheap jobs: query rewriting, chunk context, titles.
	fast: "google/gemini-2.5-flash-lite",
	// Grades eval answers. A different, stronger model family than the agent,
	// so the judge doesn't favor its own style. Changing it means bumping
	// SCORER_VERSION: scores from different judges aren't comparable.
	judge: "anthropic/claude-sonnet-5.5",
	// Reads eval failures and rewrites the prompt (phase 6).
	optimizer: "anthropic/claude-sonnet-5.5",
	embedding: "google/gemini-embedding-001",
	rerank: "cohere/rerank-v4-fast",
} as const;

// gemini-embedding-001 defaults to 3072 dimensions; pgvector's HNSW index
// supports up to 2000 for `vector`, so we ask for 1536.
export const EMBEDDING_DIMENSIONS = 1536;

// "claude-sonnet-5.5" for "anthropic/claude-sonnet-5.5", for labels and files.
export const shortModel = (model: string) => model.split("/").at(-1) ?? model;
