// What each table is for, and the eval traps planted in the dummy data.
// This lives in UI code only: nothing here is stored where the agent can read it.
import { ARTICLE_BRIEFS, TRAP_RECIPES } from "../../scripts/data/briefs";

export const TABLE_NOTES = [
	{
		name: "recipes",
		keys: ["recipes"],
		role: "RAG + tools",
		note: "The catalog. Text is embedded for semantic search; time, diet tags, allergens and nutrition are filters for tools.",
	},
	{
		name: "ingredients · recipe_ingredients",
		keys: ["ingredients", "recipeIngredients"],
		role: "Tools",
		note: "Normalized ingredient lists with per-ingredient allergens. Powers 'what can I make with…' and recipe scaling.",
	},
	{
		name: "articles",
		keys: ["articles"],
		role: "RAG",
		note: "Cooking guides, food safety, substitutions and help-center policies. Long enough to need chunking.",
	},
	{
		name: "weekly_menus",
		keys: ["weeklyMenus"],
		role: "Tools",
		note: "16 recipes per week for 8 weeks. Orders pick from these.",
	},
	{
		name: "customers · subscriptions",
		keys: ["customers", "subscriptions"],
		role: "Tools",
		note: "Accounts with preferences, allergies and plan details. The agent only ever sees the signed-in customer's rows.",
	},
	{
		name: "orders · order_items",
		keys: ["orders", "orderItems"],
		role: "Tools",
		note: "Weekly boxes: delivered in the past, processing next week (past the cutoff), scheduled the week after.",
	},
	{
		name: "credits",
		keys: ["credits"],
		role: "Tools (write)",
		note: "Credits for missing or damaged items. The agent can issue them, behind your approval.",
	},
	{
		name: "chats · chat_messages",
		keys: ["chats", "chatMessages"],
		role: "App",
		note: "Conversation history for the sidebar. Each message is an AI SDK UIMessage stored as jsonb.",
	},
] as const;

export type Trap = {
	kind: "recipe" | "article" | "customer";
	id: string;
	title: string;
	note: string;
};

export const TRAPS: Trap[] = [
	...TRAP_RECIPES.map((recipe) => ({
		kind: "recipe" as const,
		id: recipe.id,
		title: recipe.title,
		note: recipe.trap,
	})),
	...ARTICLE_BRIEFS.filter((article) => article.trap).map((article) => ({
		kind: "article" as const,
		id: article.id,
		title: article.title,
		note: article.trap ?? "",
	})),
	{
		kind: "customer",
		id: "cus_001",
		title: "Ava Chen",
		note: "Peanut allergy. Her delivered box this week had the miso butter salmon (the 'missing salmon' scenario), and her scheduled box for Oct 26 contains the peanut satay: an agent reviewing her next box should flag it.",
	},
	{
		kind: "customer",
		id: "cus_002",
		title: "Marcus Johnson",
		note: "Vegetarian, subscription paused until Nov 9. Questions about his next delivery should mention the pause.",
	},
	{
		kind: "customer",
		id: "cus_003",
		title: "Priya Patel",
		note: "Cancelled on Sep 30. She has no upcoming boxes; unused credits are kept 12 months.",
	},
	{
		kind: "customer",
		id: "cus_004",
		title: "Diego Ramirez",
		note: "4-person plan with two recent $20 credits. Good for questions that combine policy limits with account history.",
	},
];
