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
import { langfuse } from "#/server/langfuse.server";

// "paused" alone made the agent tell a paused customer nothing was coming,
// without ever looking up when the plan resumes. So the dates are included.
function planStatus(row: {
	status: string | null;
	pausedUntil: string | null;
	cancelledOn: string | null;
}) {
	if (row.status === "paused" && row.pausedUntil)
		return `paused until ${row.pausedUntil}`;
	if (row.status === "cancelled" && row.cancelledOn)
		return `cancelled on ${row.cancelledOn}`;
	return row.status;
}

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
			pausedUntil: subscriptions.pausedUntil,
			cancelledOn: subscriptions.cancelledOn,
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
			? `${row.recipesPerWeek} recipes a week for ${row.servingsPerRecipe} people, ${planStatus(row)}`
			: null,
	};
}

// The live prompt comes from Langfuse: whichever version carries the label
// ("production" by default; evals can ask for "candidate" or a version). The SDK
// caches it for a minute, and falls back to the copy in code if Langfuse is
// unreachable, so a Langfuse outage never takes the agent down.
export type PromptSelector = { label?: string; version?: number };

export async function loadAgentPrompt(
	customer: CustomerContext,
	selector: PromptSelector = {},
) {
	const prompt = await langfuse.prompt.get(AGENT_PROMPT_NAME, {
		type: "text",
		...(selector.version
			? { version: selector.version }
			: { label: selector.label ?? "production" }),
		cacheTtlSeconds: 60,
		fetchTimeoutMs: 2000,
		maxRetries: 1,
		fallback: AGENT_PROMPT,
	});
	// A version can pin the model it was written and evaluated for.
	const { model } = (prompt.config ?? {}) as { model?: string };
	return {
		instructions: prompt.compile({
			today: TODAY,
			customer: describeCustomer(customer),
		}),
		model: typeof model === "string" ? model : undefined,
		// Links every generation in the trace to this prompt version.
		langfusePrompt: {
			name: prompt.name,
			version: prompt.version,
			isFallback: prompt.isFallback,
		},
	};
}
