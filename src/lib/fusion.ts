// Reciprocal Rank Fusion: each list votes 1 / (k + rank) for its hits. Ranks
// are comparable across lists even when scores aren't (cosine similarity and
// ts_rank live on different scales). k = 60 is the usual constant: it keeps a
// single #1 from drowning out a hit that both lists rank well.
export function reciprocalRankFusion<T extends { id: string; score: number }>(
	lists: T[][],
	k = 60,
): (T & { ranks: (number | null)[] })[] {
	const fused = new Map<string, T & { ranks: (number | null)[] }>();
	lists.forEach((list, listIndex) => {
		list.forEach((hit, index) => {
			const entry = fused.get(hit.id) ?? {
				...hit,
				score: 0,
				ranks: lists.map(() => null),
			};
			entry.score += 1 / (k + index + 1);
			entry.ranks[listIndex] = index + 1;
			fused.set(hit.id, entry);
		});
	});
	return [...fused.values()].sort((a, b) => b.score - a.score);
}
