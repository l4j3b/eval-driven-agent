import { isToolUIPart, type UIMessage } from "ai";

// What the agent can cite. Every citeable tool result carries `sources`, each
// with a number the model writes as [n] and the UI turns into a citation.
export type Source = {
	n: number;
	kind: "recipe" | "article";
	// The recipe or article id, for links.
	sourceId: string;
	title: string;
	section: string | null;
	text: string;
};

// Numbers are unique across the whole chat, so [3] in a later answer never
// points at a different source than [3] in an earlier one.
export class SourceRegistry {
	private next: number;
	private byKey = new Map<string, Source>();

	constructor(messages: UIMessage[]) {
		this.next = lastSourceNumber(messages) + 1;
	}

	add(key: string, source: Omit<Source, "n">): Source {
		const existing = this.byKey.get(key);
		if (existing) return existing;
		const numbered = { n: this.next++, ...source };
		this.byKey.set(key, numbered);
		return numbered;
	}
}

export function sourcesIn(messages: UIMessage[]): Source[] {
	return messages.flatMap((message) =>
		message.parts.flatMap((part) => {
			if (!isToolUIPart(part) || part.state !== "output-available") return [];
			const output = part.output as { sources?: Source[] } | undefined;
			return output?.sources ?? [];
		}),
	);
}

function lastSourceNumber(messages: UIMessage[]) {
	return Math.max(0, ...sourcesIn(messages).map((source) => source.n));
}
