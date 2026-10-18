import { setTimeout as wait } from "node:timers/promises";

import { gateway, type LanguageModelMiddleware, wrapLanguageModel } from "ai";

// Batch jobs (evals, the judge, the optimizer) space out their calls per
// model instead of firing them all and retrying the 429s. The gateway's free
// tier allows about 5 requests a minute per model; with paid credits, set
// EVAL_RPM=60.
const nextSlot = new Map<string, number>();

export function throttled(
	modelId: string,
	rpm = Number(process.env.EVAL_RPM ?? 5),
) {
	const interval = 60_000 / rpm;
	const reserve = async () => {
		const now = Date.now();
		const slot = Math.max(now, nextSlot.get(modelId) ?? 0);
		nextSlot.set(modelId, slot + interval);
		await wait(slot - now);
	};
	const middleware: LanguageModelMiddleware = {
		wrapGenerate: async ({ doGenerate }) => {
			await reserve();
			return doGenerate();
		},
		wrapStream: async ({ doStream }) => {
			await reserve();
			return doStream();
		},
	};
	return wrapLanguageModel({ model: gateway(modelId), middleware });
}
