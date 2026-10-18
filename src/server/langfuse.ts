import { createServerFn } from "@tanstack/react-start";

import { LANGFUSE_PROJECT_URL } from "#/server/langfuse.server";

export const getLangfuseUrl = createServerFn({ method: "GET" }).handler(
	() => LANGFUSE_PROJECT_URL,
);
