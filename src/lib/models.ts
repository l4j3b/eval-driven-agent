// Every model goes through the Vercel AI Gateway (AI_GATEWAY_API_KEY), so a
// model is just a "provider/model" string and switching is a one-line change.
// These are the gateway's free-tier models; with paid credits, Claude
// (anthropic/claude-sonnet-5.5, ...) and OpenAI embeddings are drop-in swaps.
export const MODELS = {
	// Answers users, calls tools.
	agent: "google/gemini-2.5-flash",
	// Writes the dummy data.
	generator: "google/gemini-2.5-flash",
	// Cheap jobs: query rewriting, chunk context, titles.
	fast: "google/gemini-2.5-flash-lite",
	// Grades answers and rewrites prompts. Ideally a different, stronger model
	// than the agent, so the judge doesn't favor its own style; the free tier
	// has no Gemini Pro, so this is the same model for now.
	judge: "google/gemini-2.5-flash",
	embedding: "google/gemini-embedding-001",
	rerank: "cohere/rerank-v4-fast",
} as const;

// gemini-embedding-001 defaults to 3072 dimensions; pgvector's HNSW index
// supports up to 2000 for `vector`, so we ask for 1536.
export const EMBEDDING_DIMENSIONS = 1536;
