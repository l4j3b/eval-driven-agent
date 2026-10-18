import { embed, embedMany } from "ai";

import { EMBEDDING_DIMENSIONS, MODELS } from "#/lib/models";

// Gemini embeddings take a task type: documents and queries are embedded
// slightly differently, which measurably helps retrieval. Both sides must use
// the same model and dimensions, or the vectors aren't comparable.
const options = (taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY") => ({
	google: { outputDimensionality: EMBEDDING_DIMENSIONS, taskType },
});

export async function embedDocuments(values: string[]) {
	const { embeddings } = await embedMany({
		model: MODELS.embedding,
		values,
		maxParallelCalls: 2,
		maxRetries: 4,
		providerOptions: options("RETRIEVAL_DOCUMENT"),
		telemetry: { functionId: "embed-documents" },
	});
	return embeddings;
}

export async function embedQuery(value: string) {
	const { embedding } = await embed({
		model: MODELS.embedding,
		value,
		maxRetries: 2,
		providerOptions: options("RETRIEVAL_QUERY"),
		telemetry: { functionId: "embed-query" },
	});
	return embedding;
}
