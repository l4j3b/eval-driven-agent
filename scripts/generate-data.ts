// Generates the dummy data as JSON files in ./data, which `npm run db:seed` loads.
//
//   npm run data:generate              # only what's missing
//   npm run data:generate -- --force   # regenerate everything
//
// Recipes and articles are written by Gemini 2.5 Flash with structured output
// (Zod schemas), then normalized in code: allergens are recomputed from the
// ingredients and diet tags that contradict them are dropped. Customers, orders
// and credits come from Faker with a fixed seed, so they're reproducible.
import "#/server/telemetry";

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { faker } from "@faker-js/faker";
import { generateText, Output } from "ai";
import { z } from "zod";

import { MODELS } from "#/lib/models";
import { slugify } from "#/lib/slug";
import { flushTelemetry } from "#/server/telemetry";

import {
	ALLERGENS,
	ARTICLE_BRIEFS,
	type ArticleBrief,
	CUISINES,
	DIET_TAGS,
	INGREDIENT_CATEGORIES,
	RECIPES_PER_CUISINE,
	TRAP_RECIPES,
	type TrapRecipe,
} from "./data/briefs";

const force = process.argv.includes("--force");
const DATA_DIR = "data";

// --- Schemas the model fills in ------------------------------------------------

const generatedIngredient = z.object({
	name: z
		.string()
		.describe(
			"Lowercase common name, e.g. 'garlic', 'chicken thigh', 'soy sauce'",
		),
	quantity: z.number().nullable(),
	unit: z
		.string()
		.nullable()
		.describe("e.g. 'cup', 'tbsp', 'g', 'clove'. Null for countable items."),
	note: z.string().nullable().describe("e.g. 'finely chopped'"),
	category: z.enum(INGREDIENT_CATEGORIES),
	allergens: z
		.array(z.enum(ALLERGENS))
		.describe(
			"Major allergens in this ingredient. Soy sauce has soy and gluten; butter has dairy; most curry pastes have shellfish or fish.",
		),
});

const generatedRecipe = z.object({
	title: z.string(),
	description: z
		.string()
		.describe("Two appetizing sentences. No allergen or health claims."),
	course: z.enum(["main", "side", "dessert", "breakfast"]),
	difficulty: z.enum(["easy", "medium", "hard"]),
	prepMinutes: z.number().int(),
	cookMinutes: z.number().int(),
	calories: z.number().int().describe("Per serving"),
	proteinG: z.number().int().describe("Per serving"),
	carbsG: z.number().int().describe("Per serving"),
	fatG: z.number().int().describe("Per serving"),
	dietTags: z.array(z.enum(DIET_TAGS)),
	ingredients: z.array(generatedIngredient),
	steps: z
		.array(z.string())
		.describe("4 to 8 imperative steps, with times and °F temperatures"),
	tips: z.string().describe("One or two practical tips"),
});

const generatedArticle = z.object({
	summary: z.string().describe("One sentence"),
	body: z.string().describe("Markdown, 300 to 550 words, with ## headings"),
});

type GeneratedRecipe = z.infer<typeof generatedRecipe>;

// --- Helpers -----------------------------------------------------------------

async function pool<T, R>(
	items: T[],
	size: number,
	run: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(size, items.length) }, async () => {
			while (next < items.length) {
				const index = next++;
				results[index] = await run(items[index] as T);
			}
		}),
	);
	return results;
}

function hash(text: string) {
	let h = 2166136261;
	for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
	return (h >>> 0) / 2 ** 32;
}

async function writeJson(name: string, value: unknown) {
	await mkdir(DATA_DIR, { recursive: true });
	await writeFile(
		`${DATA_DIR}/${name}`,
		`${JSON.stringify(value, null, "\t")}\n`,
	);
}

async function readJson<T>(name: string): Promise<T> {
	return JSON.parse(await readFile(`${DATA_DIR}/${name}`, "utf8")) as T;
}

// --- Recipes -----------------------------------------------------------------

const MEAT =
	/\b(chicken|beef|pork|lamb|bacon|turkey|sausage|prosciutto|pancetta|chorizo|ham|duck|veal|steak|short ribs?|guanciale)\b/;
const PREMIUM =
	/\b(salmon|scallops?|ribeye|filet|steak|lamb|lobster|duck|short ribs?)\b/i;

function finalizeRecipe(
	recipe: GeneratedRecipe,
	cuisine: string,
	trap?: TrapRecipe,
) {
	const ingredients = recipe.ingredients.map((ingredient) => ({
		...ingredient,
		name: ingredient.name.trim().toLowerCase(),
		allergens: [...new Set(ingredient.allergens)].sort(),
	}));
	const allergens = [
		...new Set(ingredients.flatMap((ingredient) => ingredient.allergens)),
	].sort();
	const hasMeat = ingredients.some((ingredient) => MEAT.test(ingredient.name));
	const hasSeafood =
		ingredients.some((ingredient) => ingredient.category === "seafood") ||
		allergens.includes("fish") ||
		allergens.includes("shellfish");

	// The model is good at tagging but not perfectly consistent, and allergen
	// mistakes are the kind an eval should never blame on the agent.
	const drop = new Set<string>();
	if (hasMeat)
		for (const tag of ["vegetarian", "vegan", "pescatarian"]) drop.add(tag);
	if (hasSeafood) for (const tag of ["vegetarian", "vegan"]) drop.add(tag);
	if (allergens.includes("dairy") || allergens.includes("eggs"))
		drop.add("vegan");
	if (allergens.includes("gluten")) drop.add("gluten-free");
	if (allergens.includes("dairy")) drop.add("dairy-free");
	const dietTags: string[] = [...new Set(recipe.dietTags)]
		.filter((tag) => !drop.has(tag))
		.sort();

	const id = trap?.id ?? slugify(recipe.title);
	const roll = hash(id);
	return {
		id,
		title: trap?.title ?? recipe.title,
		description: recipe.description,
		cuisine,
		course: recipe.course,
		difficulty: recipe.difficulty,
		prepMinutes: recipe.prepMinutes,
		cookMinutes: recipe.cookMinutes,
		servings: 2,
		calories: recipe.calories,
		proteinG: recipe.proteinG,
		carbsG: recipe.carbsG,
		fatG: recipe.fatG,
		dietTags,
		allergens,
		steps: recipe.steps,
		tips: trap?.appendToTips
			? `${recipe.tips} ${trap.appendToTips}`
			: recipe.tips,
		isPremium: PREMIUM.test(trap?.title ?? recipe.title),
		rating: Math.round((3.7 + roll * 1.2) * 10) / 10,
		ratingCount: 20 + Math.floor(hash(`${id}:count`) * 1400),
		ingredients,
	};
}

export type Recipe = ReturnType<typeof finalizeRecipe>;

const RECIPE_RULES = `Every recipe serves 2; ingredient quantities are for 2 servings and nutrition is per serving.
Tag allergens on every ingredient carefully, using only the allowed values.
Steps are imperative sentences, with times and temperatures in °F where relevant.`;

async function generateRecipes(): Promise<Recipe[]> {
	const trapTitles = TRAP_RECIPES.map((trap) => trap.title).join("; ");

	const batches = await pool(CUISINES, 4, async ({ cuisine, hint }) => {
		const { output } = await generateText({
			model: MODELS.generator,
			maxRetries: 4,
			maxOutputTokens: 24000,
			output: Output.object({
				schema: z.object({ recipes: z.array(generatedRecipe) }),
			}),
			prompt: `Write ${RECIPES_PER_CUISINE} distinct ${cuisine} recipes for Mise, a meal-kit company.
Mostly mains, plus exactly one side and one dessert. Ideas: ${hint}.
Vary the difficulty, the protein (chicken, beef, pork, fish, shellfish, tofu, legumes, eggs) and the total time (15 to 90 minutes). Include at least two vegetarian recipes and one vegan recipe.
Don't write any of these, which already exist: ${trapTitles}.
${RECIPE_RULES}`,
			telemetry: { functionId: "generate-recipes" },
		});
		console.log(`recipes: ${cuisine} (${output.recipes.length})`);
		return output.recipes.map((recipe) => finalizeRecipe(recipe, cuisine));
	});

	const traps = await pool(TRAP_RECIPES, 4, async (trap) => {
		const { output } = await generateText({
			model: MODELS.generator,
			maxRetries: 4,
			maxOutputTokens: 6000,
			output: Output.object({ schema: generatedRecipe }),
			prompt: `Write one ${trap.cuisine} recipe for Mise, a meal-kit company, titled "${trap.title}".
${trap.instructions}
${RECIPE_RULES}`,
			telemetry: { functionId: "generate-recipes" },
		});
		console.log(`recipes: trap ${trap.id}`);
		return finalizeRecipe(output, trap.cuisine, trap);
	});

	// Traps win on id collisions; generated duplicates are dropped.
	const byId = new Map<string, Recipe>();
	for (const recipe of [...traps, ...batches.flat()]) {
		if (!byId.has(recipe.id)) byId.set(recipe.id, recipe);
	}
	return [...byId.values()];
}

// --- Articles ----------------------------------------------------------------

async function generateArticles() {
	return pool(ARTICLE_BRIEFS, 4, async (brief: ArticleBrief) => {
		const { output } = await generateText({
			model: MODELS.generator,
			maxRetries: 4,
			maxOutputTokens: 4000,
			output: Output.object({ schema: generatedArticle }),
			prompt: `Write a ${brief.category} article for Mise, a meal-kit company, titled "${brief.title}".
Include every one of these facts, keeping each number exactly as written:
${brief.facts.map((fact) => `- ${fact}`).join("\n")}
Don't add any other prices, time limits, amounts or temperatures. Write in a friendly, plain voice for home cooks and customers.`,
			telemetry: { functionId: "generate-articles" },
		});

		// Every number in the facts should survive into the article.
		const numbers = brief.facts.join(" ").match(/\$?\d+(?:[./]\d+)?/g) ?? [];
		const missing = [...new Set(numbers)].filter(
			(number) => !output.body.includes(number),
		);
		if (missing.length) {
			console.warn(`articles: ${brief.id} is missing ${missing.join(", ")}`);
		}
		console.log(`articles: ${brief.id}`);
		return {
			id: brief.id,
			title: brief.title,
			category: brief.category,
			status: brief.status ?? "published",
			summary: output.summary,
			body: output.body,
			publishedOn: brief.publishedOn,
			supersededBy: brief.supersededBy ?? null,
		};
	});
}

// --- Accounts ----------------------------------------------------------------

// Mondays. Deliveries before 2026-10-17 are done; next week's box is past the
// cutoff (processing); the week after can still be changed (scheduled).
const WEEKS = [
	"2026-09-07",
	"2026-09-14",
	"2026-09-21",
	"2026-09-28",
	"2026-10-05",
	"2026-10-12",
	"2026-10-19",
	"2026-10-26",
];
const MENU_SIZE = 16;
const DAYS = ["monday", "tuesday", "wednesday", "thursday"];
const PRICE = { 2: 11.49, 4: 9.49 } as const;
const PREMIUM_UPCHARGE = 4.99;
const SHIPPING = 10.99;

function addDays(isoDate: string, days: number) {
	const date = new Date(`${isoDate}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

type Order = {
	id: string;
	customerId: string;
	weekStart: string;
	status: "scheduled" | "processing" | "delivered" | "skipped";
	deliveryDate: string;
	subtotal: number;
	shipping: number;
};

type Credit = {
	id: string;
	customerId: string;
	orderId: string;
	amount: number;
	reason: string;
	issuedBy: string;
	issuedAt: string;
};

function weekStatus(week: string) {
	if (week === "2026-10-26") return "scheduled" as const;
	if (week === "2026-10-19") return "processing" as const;
	return "delivered" as const;
}

type Profile = {
	name: string;
	city: string;
	householdSize: number;
	dietaryPreferences: string[];
	allergies: string[];
	servingsPerRecipe: 2 | 4;
	recipesPerWeek: number;
	status: "active" | "paused" | "cancelled";
	deliveryDay: string;
	startedOn: string;
	pausedUntil?: string;
	pausedFrom?: string;
	cancelledOn?: string;
};

// Customers the evals talk about by name.
const SCRIPTED: Profile[] = [
	{
		name: "Ava Chen",
		city: "Seattle",
		householdSize: 2,
		dietaryPreferences: [],
		allergies: ["peanuts"],
		servingsPerRecipe: 2,
		recipesPerWeek: 3,
		status: "active",
		deliveryDay: "tuesday",
		startedOn: "2025-11-03",
	},
	{
		name: "Marcus Johnson",
		city: "Chicago",
		householdSize: 1,
		dietaryPreferences: ["vegetarian"],
		allergies: [],
		servingsPerRecipe: 2,
		recipesPerWeek: 2,
		status: "paused",
		deliveryDay: "monday",
		startedOn: "2026-02-16",
		pausedFrom: "2026-10-12",
		pausedUntil: "2026-11-09",
	},
	{
		name: "Priya Patel",
		city: "Austin",
		householdSize: 2,
		dietaryPreferences: ["vegetarian"],
		allergies: ["tree-nuts"],
		servingsPerRecipe: 2,
		recipesPerWeek: 3,
		status: "cancelled",
		deliveryDay: "wednesday",
		startedOn: "2025-06-09",
		cancelledOn: "2026-09-30",
	},
	{
		name: "Diego Ramirez",
		city: "Denver",
		householdSize: 4,
		dietaryPreferences: ["high-protein"],
		allergies: [],
		servingsPerRecipe: 4,
		recipesPerWeek: 4,
		status: "active",
		deliveryDay: "thursday",
		startedOn: "2025-09-15",
	},
];

function randomProfile(): Profile {
	const householdSize = faker.helpers.weightedArrayElement([
		{ value: 1, weight: 2 },
		{ value: 2, weight: 5 },
		{ value: 3, weight: 2 },
		{ value: 4, weight: 3 },
		{ value: 5, weight: 1 },
	]);
	const status = faker.helpers.weightedArrayElement([
		{ value: "active" as const, weight: 8 },
		{ value: "paused" as const, weight: 1 },
		{ value: "cancelled" as const, weight: 1 },
	]);
	const pausedFrom = faker.helpers.arrayElement(WEEKS.slice(3, 6));
	return {
		name: faker.person.fullName(),
		city: faker.location.city(),
		householdSize,
		dietaryPreferences: faker.helpers.weightedArrayElement([
			{ value: [], weight: 10 },
			{ value: ["vegetarian"], weight: 3 },
			{ value: ["pescatarian"], weight: 2 },
			{ value: ["vegan"], weight: 1 },
			{ value: ["gluten-free"], weight: 2 },
			{ value: ["high-protein"], weight: 2 },
			{ value: ["low-carb"], weight: 1 },
		]),
		allergies: faker.helpers.weightedArrayElement([
			{ value: [], weight: 14 },
			{ value: [faker.helpers.arrayElement(ALLERGENS)], weight: 5 },
			{ value: faker.helpers.arrayElements(ALLERGENS, 2), weight: 1 },
		]),
		servingsPerRecipe: householdSize >= 3 ? 4 : 2,
		recipesPerWeek: faker.number.int({ min: 2, max: 5 }),
		status,
		deliveryDay: faker.helpers.arrayElement(DAYS),
		startedOn: faker.date
			.between({ from: "2025-01-01", to: "2026-08-31" })
			.toISOString()
			.slice(0, 10),
		...(status === "paused" && {
			pausedFrom,
			pausedUntil: addDays(
				pausedFrom,
				7 * faker.number.int({ min: 3, max: 6 }),
			),
		}),
		...(status === "cancelled" && {
			cancelledOn: addDays(faker.helpers.arrayElement(WEEKS.slice(1, 6)), 2),
		}),
	};
}

function fits(recipe: Recipe, profile: Profile) {
	if (
		recipe.allergens.some((allergen) => profile.allergies.includes(allergen))
	) {
		return false;
	}
	return profile.dietaryPreferences.every((preference) =>
		["vegetarian", "vegan", "pescatarian", "gluten-free"].includes(preference)
			? recipe.dietTags.includes(preference) ||
				(preference === "pescatarian" && recipe.dietTags.includes("vegetarian"))
			: true,
	);
}

function generateAccounts(recipes: Recipe[]) {
	faker.seed(7);
	const mains = recipes.filter((recipe) => recipe.course === "main");
	const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));

	// Each week's menu: 16 mains, with the trap recipes placed where the
	// scripted scenarios need them.
	const pinned: Record<string, string[]> = {
		"2026-10-12": ["miso-butter-salmon"],
		"2026-10-26": [
			"chicken-satay-with-peanut-sauce",
			"peanut-free-chicken-satay",
		],
	};
	const weeklyMenus = WEEKS.flatMap((weekStart) => {
		const pins = (pinned[weekStart] ?? []).filter((id) => byId.has(id));
		const rest = faker.helpers.arrayElements(
			mains.filter((recipe) => !pins.includes(recipe.id)),
			MENU_SIZE - pins.length,
		);
		return [...pins, ...rest.map((recipe) => recipe.id)].map((recipeId) => ({
			weekStart,
			recipeId,
		}));
	});
	const menuFor = (week: string) =>
		weeklyMenus
			.filter((row) => row.weekStart === week)
			.map((row) => byId.get(row.recipeId) as Recipe);

	const profiles = [...SCRIPTED, ...Array.from({ length: 36 }, randomProfile)];
	const customers = [];
	const subscriptions = [];
	const orders: Order[] = [];
	const orderItems = [];
	let orderNumber = 0;

	for (const [index, profile] of profiles.entries()) {
		const customerId = `cus_${String(index + 1).padStart(3, "0")}`;
		const [first, ...last] = profile.name.split(" ");
		customers.push({
			id: customerId,
			name: profile.name,
			email: `${slugify(first ?? "")}.${slugify(last.join(" "))}${index + 1}@example.com`,
			city: profile.city,
			householdSize: profile.householdSize,
			dietaryPreferences: profile.dietaryPreferences,
			allergies: profile.allergies,
			joinedOn: profile.startedOn,
		});
		const pricePerServing = PRICE[profile.servingsPerRecipe];
		subscriptions.push({
			id: `sub_${String(index + 1).padStart(3, "0")}`,
			customerId,
			servingsPerRecipe: profile.servingsPerRecipe,
			recipesPerWeek: profile.recipesPerWeek,
			status: profile.status,
			deliveryDay: profile.deliveryDay,
			pricePerServing,
			startedOn: profile.startedOn,
			pausedUntil: profile.pausedUntil ?? null,
			cancelledOn: profile.cancelledOn ?? null,
		});

		for (const weekStart of WEEKS) {
			if (weekStart < profile.startedOn) continue;
			if (profile.cancelledOn && weekStart > profile.cancelledOn) continue;
			const paused =
				profile.pausedFrom &&
				profile.pausedUntil &&
				weekStart >= profile.pausedFrom &&
				weekStart < profile.pausedUntil;
			const skipped = paused || faker.number.float() < 0.08;
			const orderId = `ord_${String(++orderNumber).padStart(4, "0")}`;

			let picks: Recipe[] = [];
			if (!skipped) {
				const scripted =
					customerId === "cus_001" && weekStart === "2026-10-12"
						? ["miso-butter-salmon"]
						: customerId === "cus_001" && weekStart === "2026-10-26"
							? ["chicken-satay-with-peanut-sauce"]
							: [];
				const forced = scripted
					.map((id) => byId.get(id))
					.filter((recipe): recipe is Recipe => Boolean(recipe));
				const options = menuFor(weekStart).filter(
					(recipe) => fits(recipe, profile) && !scripted.includes(recipe.id),
				);
				picks = [
					...forced,
					...faker.helpers.arrayElements(
						options,
						Math.max(0, profile.recipesPerWeek - forced.length),
					),
				];
			}

			const items = picks.map((recipe) => ({
				orderId,
				recipeId: recipe.id,
				servings: profile.servingsPerRecipe,
				unitPrice:
					Math.round(
						(pricePerServing + (recipe.isPremium ? PREMIUM_UPCHARGE : 0)) * 100,
					) / 100,
			}));
			orderItems.push(...items);
			orders.push({
				id: orderId,
				customerId,
				weekStart,
				status: skipped ? ("skipped" as const) : weekStatus(weekStart),
				deliveryDate: addDays(weekStart, DAYS.indexOf(profile.deliveryDay)),
				subtotal:
					Math.round(
						items.reduce(
							(sum, item) => sum + item.servings * item.unitPrice,
							0,
						) * 100,
					) / 100,
				shipping: skipped ? 0 : SHIPPING,
			});
		}
	}

	// Credits: a handful of past problems, plus Diego's two recent ones.
	const delivered = orders.filter((order) => order.status === "delivered");
	const credits: Credit[] = [];
	const creditFor = (order: Order, amount: number, reason: string) => {
		credits.push({
			id: `crd_${String(credits.length + 1).padStart(3, "0")}`,
			customerId: order.customerId,
			orderId: order.id,
			amount,
			reason,
			issuedBy: "support",
			issuedAt: `${addDays(order.deliveryDate, 1)}T17:00:00Z`,
		});
	};
	const diego = delivered.filter((order) => order.customerId === "cus_004");
	const [secondLast, last] = diego.slice(-2);
	if (secondLast) creditFor(secondLast, 20, "Damaged box: crushed produce");
	if (last) creditFor(last, 20, "Missing ingredient: limes");
	for (const order of faker.helpers.arrayElements(
		delivered.filter(
			(order) => !["cus_001", "cus_004"].includes(order.customerId),
		),
		12,
	)) {
		const item = faker.helpers.arrayElement(
			orderItems.filter((row) => row.orderId === order.id),
		);
		const recipe = item ? byId.get(item.recipeId) : undefined;
		const ingredient = recipe
			? faker.helpers.arrayElement(recipe.ingredients).name
			: "an ingredient";
		const kind = faker.helpers.weightedArrayElement([
			{ value: "missing", weight: 6 },
			{ value: "damaged", weight: 3 },
			{ value: "late", weight: 1 },
		]);
		if (kind === "missing" && item) {
			creditFor(
				order,
				Math.min(25, Math.round(item.unitPrice * item.servings * 100) / 100),
				`Missing ingredient: ${ingredient}`,
			);
		} else if (kind === "damaged") {
			creditFor(order, 10, `Damaged packaging: ${ingredient}`);
		} else {
			creditFor(
				order,
				Math.round((order.subtotal + order.shipping) * 100) / 100,
				"Box arrived more than one day late",
			);
		}
	}

	return { customers, subscriptions, weeklyMenus, orders, orderItems, credits };
}

// --- Main --------------------------------------------------------------------

async function main() {
	const want = (file: string) => force || !existsSync(`${DATA_DIR}/${file}`);

	const [recipes, articles] = await Promise.all([
		want("recipes.json")
			? generateRecipes().then(async (recipes) => {
					await writeJson("recipes.json", recipes);
					return recipes;
				})
			: readJson<Recipe[]>("recipes.json"),
		want("articles.json")
			? generateArticles().then((articles) =>
					writeJson("articles.json", articles),
				)
			: Promise.resolve(),
	]);
	void articles;

	await writeJson("accounts.json", generateAccounts(recipes));

	const counts = await Promise.all(
		["recipes.json", "articles.json", "accounts.json"].map(async (file) => {
			const data = await readJson<unknown>(file);
			return Array.isArray(data)
				? `${file}: ${data.length}`
				: `${file}: ${Object.entries(data as Record<string, unknown[]>)
						.map(([key, rows]) => `${key} ${rows.length}`)
						.join(", ")}`;
		}),
	);
	console.log(counts.join("\n"));
	await flushTelemetry();
}

await main();
