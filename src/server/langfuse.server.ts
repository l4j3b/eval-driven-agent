import { LangfuseClient } from "@langfuse/client";

import { EVAL_DATASET } from "#/lib/evals";

// One client per process, configured from LANGFUSE_BASE_URL,
// LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY. Server-only: the secret key
// must never reach the browser bundle.
export const langfuse = new LangfuseClient();

// The project the self-hosted stack provisions on first start
// (LANGFUSE_INIT_PROJECT_ID in langfuse/.env), for links into the Langfuse UI.
export const LANGFUSE_PROJECT_URL = `${process.env.LANGFUSE_BASE_URL ?? "http://localhost:3000"}/project/agent-lab`;

// Creates the eval dataset on first use. Langfuse has no "create if missing",
// so a failed create usually means it already exists.
let datasetReady: Promise<unknown> | null = null;
export function ensureEvalDataset() {
	datasetReady ??= langfuse.api.datasets
		.create({
			name: EVAL_DATASET,
			description:
				"Eval cases for the Mise agent: hand-written cases and answers users flagged, each with criteria for a good answer.",
		})
		.catch(() => {
			// Already exists.
		});
	return datasetReady;
}
