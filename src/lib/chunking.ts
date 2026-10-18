// Turns recipes and articles into the chunks search runs over.
//
// Chunks should be small enough that a match is specific, and big enough to
// make sense alone. Both sources are short and structured, so structure does
// most of the work: articles split at their headings, recipes into an overview
// and a method. Only a section longer than MAX_CHARS is split further, by
// paragraph, with one paragraph of overlap so an idea cut in half still
// appears whole in one of the two chunks.

const MAX_CHARS = 1200;
const TARGET_CHARS = 900;
// Longer "headings" are really text that lost its line breaks; keep them as
// content rather than silently dropping a whole article into a title.
const MAX_HEADING_CHARS = 120;

export type ChunkDraft = {
	id: string;
	sourceType: "recipe" | "article";
	sourceId: string;
	position: number;
	title: string;
	heading: string | null;
	content: string;
};

type Article = { id: string; title: string; body: string };

type Recipe = {
	id: string;
	title: string;
	description: string;
	cuisine: string;
	course: string;
	difficulty: string;
	prepMinutes: number;
	cookMinutes: number;
	servings: number;
	dietTags: string[];
	allergens: string[];
	steps: string[];
	tips: string | null;
	ingredients: {
		name: string;
		quantity: number | null;
		unit: string | null;
		note: string | null;
	}[];
};

function sections(markdown: string, title: string) {
	const result: { heading: string | null; text: string }[] = [];
	let heading: string | null = null;
	let lines: string[] = [];
	const flush = () => {
		const text = lines.join("\n").trim();
		if (text) result.push({ heading, text });
		lines = [];
	};
	for (const line of markdown.split("\n")) {
		const match = line.match(/^#{1,4}\s+(.+?)\s*#*$/);
		if (match && (match[1]?.length ?? 0) <= MAX_HEADING_CHARS) {
			flush();
			// A top-level heading that repeats the title adds nothing.
			heading =
				match[1]?.trim().toLowerCase() === title.toLowerCase()
					? null
					: (match[1]?.trim() ?? null);
		} else {
			lines.push(line.replace(/^#{1,4}\s+/, ""));
		}
	}
	flush();
	return result;
}

// Paragraphs, with any paragraph that's too long on its own split by sentence.
function units(text: string) {
	return text
		.split(/\n\s*\n/)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean)
		.flatMap((paragraph) =>
			paragraph.length <= TARGET_CHARS
				? [paragraph]
				: paragraph.split(/(?<=[.!?])\s+/),
		);
}

function pack(text: string) {
	if (text.length <= MAX_CHARS) return [text];
	const groups: string[] = [];
	let current: string[] = [];
	for (const paragraph of units(text)) {
		const length = current.join("\n\n").length + paragraph.length;
		if (current.length > 0 && length > TARGET_CHARS) {
			groups.push(current.join("\n\n"));
			current = [current.at(-1) as string, paragraph];
		} else {
			current.push(paragraph);
		}
	}
	if (current.length > 0) groups.push(current.join("\n\n"));
	return groups;
}

export function chunkArticle(article: Article): ChunkDraft[] {
	return sections(article.body, article.title)
		.flatMap((section) =>
			pack(section.text).map((text) => ({ heading: section.heading, text })),
		)
		.map((piece, position) => ({
			id: `article:${article.id}#${position}`,
			sourceType: "article",
			sourceId: article.id,
			position,
			title: article.title,
			heading: piece.heading,
			content: piece.text,
		}));
}

function list(values: string[]) {
	return values.length > 0 ? values.join(", ") : "none";
}

export function chunkRecipe(recipe: Recipe): ChunkDraft[] {
	const ingredients = recipe.ingredients
		.map((ingredient) =>
			[
				[ingredient.quantity, ingredient.unit].filter(Boolean).join(" "),
				ingredient.name,
				ingredient.note ? `(${ingredient.note})` : "",
			]
				.filter(Boolean)
				.join(" "),
		)
		.join("; ");
	const overview = [
		recipe.description,
		`${recipe.cuisine} ${recipe.course}, ${recipe.difficulty}, ${recipe.prepMinutes + recipe.cookMinutes} minutes, serves ${recipe.servings}.`,
		`Diet: ${list(recipe.dietTags)}. Allergens: ${list(recipe.allergens)}.`,
		`Ingredients: ${ingredients}.`,
	].join("\n");
	const method = [
		recipe.steps.map((step, index) => `${index + 1}. ${step}`).join("\n"),
		recipe.tips ? `Tips: ${recipe.tips}` : "",
	]
		.filter(Boolean)
		.join("\n\n");

	return [
		{ heading: "Overview", content: overview },
		{ heading: "Method", content: method },
	].map((piece, position) => ({
		id: `recipe:${recipe.id}#${position}`,
		sourceType: "recipe",
		sourceId: recipe.id,
		position,
		title: recipe.title,
		...piece,
	}));
}

// The exact text that gets embedded: a header naming the source, the optional
// LLM-written context, then the chunk itself.
export function embeddingText(chunk: ChunkDraft, context: string | null) {
	return [
		`${chunk.sourceType === "recipe" ? "Recipe" : "Article"}: ${chunk.title}`,
		chunk.heading ? `Section: ${chunk.heading}` : null,
		context,
		chunk.content,
	]
		.filter(Boolean)
		.join("\n");
}
