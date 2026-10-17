import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { registerTelemetry } from "ai";

// Import this module once from any server entry that calls a model.
// The AI SDK emits OpenTelemetry spans for every model, tool and embedding call;
// the span processor batches them and ships them to Langfuse
// (LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY).
const globalForTelemetry = globalThis as unknown as {
	langfuseSpans?: LangfuseSpanProcessor;
};

if (!globalForTelemetry.langfuseSpans) {
	const spans = new LangfuseSpanProcessor();
	new NodeTracerProvider({ spanProcessors: [spans] }).register();
	registerTelemetry(new LangfuseVercelAiSdkIntegration());
	globalForTelemetry.langfuseSpans = spans;
}

// Scripts exit right after their last call, so they flush before quitting.
export function flushTelemetry() {
	return globalForTelemetry.langfuseSpans?.forceFlush();
}
