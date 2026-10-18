import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { CHAT_ID } from "#/server/chat-store";
import {
	addToDataset,
	listFeedback,
	recordFeedback,
} from "#/server/feedback.server";
import { currentCustomerId } from "#/server/session.server";

const answer = {
	chatId: z.string().regex(CHAT_ID),
	messageId: z.string().min(1).max(64),
};

export const submitFeedback = createServerFn({ method: "POST" })
	.validator(
		z.object({
			...answer,
			value: z.enum(["up", "down"]),
			comment: z.string().max(1000).optional(),
		}),
	)
	.handler(({ data }) =>
		recordFeedback({ ...data, customerId: currentCustomerId() }),
	);

export const getFeedback = createServerFn({ method: "GET" }).handler(
	async () => ({
		items: await listFeedback(),
		langfuseUrl: `${process.env.LANGFUSE_BASE_URL ?? "http://localhost:3000"}/project/agent-lab`,
	}),
);

export const createDatasetItem = createServerFn({ method: "POST" })
	.validator(
		z.object({
			...answer,
			criteria: z.string().trim().min(10).max(2000),
			reference: z.string().trim().max(4000).optional(),
		}),
	)
	.handler(({ data }) => addToDataset(data));
