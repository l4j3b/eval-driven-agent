import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
	approveRecord,
	loadImproveState,
	setProduction,
} from "#/server/improve.server";
import { LANGFUSE_PROJECT_URL } from "#/server/langfuse.server";

export const getImproveState = createServerFn({ method: "GET" }).handler(
	async () => ({
		...(await loadImproveState()),
		langfuseUrl: LANGFUSE_PROJECT_URL,
	}),
);

export const approveImprovement = createServerFn({ method: "POST" })
	.validator(z.object({ recordId: z.string().min(1).max(100) }))
	.handler(async ({ data }) => {
		await approveRecord(data.recordId);
	});

export const makeProduction = createServerFn({ method: "POST" })
	.validator(z.object({ version: z.number().int().positive() }))
	.handler(({ data }) => setProduction(data.version));
