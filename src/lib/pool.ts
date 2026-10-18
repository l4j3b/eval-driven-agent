// Runs `run` over `items` with at most `size` calls in flight, keeping order.
// Model APIs rate-limit, so batch jobs never fire everything at once.
export async function pool<T, R>(
	items: T[],
	size: number,
	run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(size, items.length) }, async () => {
			while (next < items.length) {
				const index = next++;
				results[index] = await run(items[index] as T, index);
			}
		}),
	);
	return results;
}
