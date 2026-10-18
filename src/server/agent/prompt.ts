import { LangfuseClient } from "@langfuse/client";
import { eq } from "drizzle-orm";

import { db } from "#/db/client";
import { customers, subscriptions } from "#/db/schema";
import { TODAY } from "#/lib/clock";
import {
	AGENT_PROMPT,
	AGENT_PROMPT_NAME,
	type CustomerContext,
	describeCustomer,
} from "#/lib/prompts";

const langfuse = new LangfuseClient();

export async function loadCustomer(
	customerId: string | null,
): Promise<CustomerContext> {
	if (!customerId) return null;
	const [row] = await db
		.select({
			id: customers.id,
			name: customers.name,
			allergies: customers.allergies,
			dietaryPreferences: customers.dietaryPreferences,
			recipesPerWeek: subscriptions.recipesPerWeek,
			servingsPerRecipe: subscriptions.servingsPerRecipe,
			status: subscriptions.status,
		})
		.from(customers)
		.leftJoin(subscriptions, eq(subscriptions.customerId, customers.id))
		.where(eq(customers.id, customerId));
	if (!row) return null;
	return {
		id: row.id,
		name: row.name,
		allergies: row.allergies,
		dietaryPreferences: row.dietaryPreferences,
		plan: row.status
			? `${row.recipesPerWeek} recipes a week for ${row.servingsPerRecipe} people, ${row.status}`
			: null,
	};
}

// The live prompt comes from Langfuse: whichever version carries `label`
// ("production" by default; evals can pass a candidate label instead). The SDK
// caches it for a minute, and falls back to the copy in code if Langfuse is
// unreachable, so a Langfuse outage never takes the agent down.
export async function loadAgentPrompt(
	customer: CustomerContext,
	label = "production",
) {
	const prompt = await langfuse.prompt.get(AGENT_PROMPT_NAME, {
		type: "text",
		label,
		cacheTtlSeconds: 60,
		fetchTimeoutMs: 2000,
		maxRetries: 1,
		fallback: AGENT_PROMPT,
	});
	return {
		instructions: prompt.compile({
			today: TODAY,
			customer: describeCustomer(customer),
		}),
		// Links every generation in the trace to this prompt version.
		langfusePrompt: {
			name: prompt.name,
			version: prompt.version,
			isFallback: prompt.isFallback,
		},
	};
}
