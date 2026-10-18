export type DiffLine = { type: "same" | "add" | "remove"; text: string };

// A line diff via longest common subsequence. Prompts are a few dozen lines,
// so the quadratic table is fine.
export function lineDiff(before: string, after: string): DiffLine[] {
	const a = before.split("\n");
	const b = after.split("\n");
	const table = Array.from({ length: a.length + 1 }, () =>
		new Array<number>(b.length + 1).fill(0),
	);
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			table[i][j] =
				a[i] === b[j]
					? (table[i + 1]?.[j + 1] ?? 0) + 1
					: Math.max(table[i + 1]?.[j] ?? 0, table[i]?.[j + 1] ?? 0);
		}
	}
	const lines: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			lines.push({ type: "same", text: a[i] ?? "" });
			i++;
			j++;
		} else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
			lines.push({ type: "remove", text: a[i++] ?? "" });
		} else {
			lines.push({ type: "add", text: b[j++] ?? "" });
		}
	}
	while (i < a.length) lines.push({ type: "remove", text: a[i++] ?? "" });
	while (j < b.length) lines.push({ type: "add", text: b[j++] ?? "" });
	return lines;
}
