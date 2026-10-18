import { createServerFn } from "@tanstack/react-start";

import { readReports } from "#/server/evals.server";
import { LANGFUSE_PROJECT_URL } from "#/server/langfuse.server";

// Tool inputs in the reports are typed as `unknown`, which the serializer's
// type check rejects. They come from JSON files, so they are plain JSON.
export const getEvalReports = createServerFn({
	method: "GET",
	strict: { output: false },
}).handler(async () => ({
	reports: await readReports(),
	langfuseUrl: LANGFUSE_PROJECT_URL,
}));
