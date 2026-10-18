import { tool } from "ai";
import {
	and,
	arrayContains,
	arrayOverlaps,
	asc,
	desc,
	eq,
	exists,
	ilike,
	inArray,
	not,
	type SQL,
	sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { db } from "#/db/client";
import {
	credits,
	customers,
	ingredients,
	orderItems,
	orders,
	recipeIngredients,
	recipes,
	subscriptions,
	supportTickets,
	weeklyMenus,
} from "#/db/schema";
import { ALLERGENS, COURSES, DIET_TAGS } from "#/lib/catalog";
import { daysBetween, TODAY } from "#/lib/clock";
import type { CustomerContext } from "#/lib/prompts";
import type { SourceRegistry } from "#/lib/sources";
import { search } from "#/server/retrieval";

// Policy numbers from the "Missing or Damaged Ingredients" article. The agent
// reads the article to explain the policy; the code enforces it.
export const AUTO_CREDIT_LIMIT = 25;
const REPORT_WINDOW_DAYS = 7;

const round = (amount: number) => Math.round(amount * 100) / 100;
const money = (amount: number) => `$${amount.toFixed(2)}`;

function conflicts(allergens: string[], customer: CustomerContext) {
	return allergens.filter((allergen) => customer?.allergies.includes(allergen));
}

// Works out what a credit would be, or why there can't be one. Used twice:
// by the approval policy before asking the customer, and again at execution,
// in case anything changed in between.
export async function quoteCredit(
	customerId: string,
	orderId: string,
	recipeId: string,
) {
	const [order] = await db
		.select()
		.from(orders)
		.where(and(eq(orders.id, orderId), eq(orders.customerId, customerId)));
	if (!order) {
		return {
			ok: false as const,
			error: `Order ${orderId} isn't one of this customer's orders.`,
		};
	}
	if (order.status !== "delivered") {
		return {
			ok: false as const,
			error: `Order ${orderId} hasn't been delivered yet (it's ${order.status}).`,
		};
	}
	const age = daysBetween(order.deliveryDate, TODAY);
	if (age > REPORT_WINDOW_DAYS) {
		return {
			ok: false as const,
			error: `Order ${orderId} was delivered ${age} days ago. Problems must be reported within ${REPORT_WINDOW_DAYS} days of delivery.`,
		};
	}
	const [item] = await db
		.select({
			servings: orderItems.servings,
			unitPrice: orderItems.unitPrice,
			title: recipes.title,
		})
		.from(orderItems)
		.innerJoin(recipes, eq(recipes.id, orderItems.recipeId))
		.where(
			and(eq(orderItems.orderId, orderId), eq(orderItems.recipeId, recipeId)),
		);
	if (!item) {
		return {
			ok: false as const,
			error: `Recipe ${recipeId} isn't in order ${orderId}.`,
		};
	}
	const previous = await db
		.select({ recipeId: credits.recipeId, amount: credits.amount })
		.from(credits)
		.where(eq(credits.orderId, orderId));
	if (previous.some((credit) => credit.recipeId === recipeId)) {
		return {
			ok: false as const,
			error: `${item.title} in order ${orderId} has already been credited.`,
		};
	}
	const amount = round(item.unitPrice * item.servings);
	const alreadyCredited = round(
		previous.reduce((total, credit) => total + credit.amount, 0),
	);
	return {
		ok: true as const,
		amount,
		alreadyCredited,
		overLimit: alreadyCredited + amount > AUTO_CREDIT_LIMIT,
		recipeTitle: item.title,
		deliveryDate: order.deliveryDate,
	};
}

type ToolsOptions = {
	customer: CustomerContext;
	sources: SourceRegistry;
	chatId: string;
	// Evals replay real conversations against real accounts; in dry-run mode
	// tools that write (credits, tickets) report what they would do instead.
	dryRun?: boolean;
};

// Recipes and articles: available to everyone.
function knowledgeTools({ customer, sources }: ToolsOptions) {
	return {
		searchKnowledge: tool({
			description:
				"Search Mise's recipes and help articles: cooking techniques, food safety, substitutions, storage, and policies on credits, delivery, plans, skipping and cancelling. Returns numbered sources to cite as [n]. Archived (outdated) articles are excluded.",
			inputSchema: z.object({
				query: z
					.string()
					.describe(
						"A focused search query, rephrased from the customer's question",
					),
				sources: z
					.array(z.enum(["recipe", "article"]))
					.optional()
					.describe("Limit to recipes or to articles"),
				maxMinutes: z.number().int().positive().optional(),
				excludeAllergens: z.array(z.enum(ALLERGENS)).optional(),
				dietTags: z.array(z.enum(DIET_TAGS)).optional(),
			}),
			execute: async ({ query, ...filters }) => {
				const { reranked } = await search(query, { filters, limit: 6 });
				const recipeIds = reranked
					.filter((hit) => hit.sourceType === "recipe")
					.map((hit) => hit.sourceId);
				const allergenRows = recipeIds.length
					? await db
							.select({ id: recipes.id, allergens: recipes.allergens })
							.from(recipes)
							.where(inArray(recipes.id, recipeIds))
					: [];
				const allergensById = new Map(
					allergenRows.map((row) => [row.id, row.allergens]),
				);
				const found = reranked.map((hit) =>
					sources.add(hit.id, {
						kind: hit.sourceType,
						sourceId: hit.sourceId,
						title: hit.title,
						section: hit.heading,
						text: hit.content,
					}),
				);
				const allergyConflicts = found.flatMap((source) => {
					const clash = conflicts(
						allergensById.get(source.sourceId) ?? [],
						customer,
					);
					return clash.length
						? [{ n: source.n, recipe: source.title, allergens: clash }]
						: [];
				});
				return {
					sources: found,
					...(allergyConflicts.length ? { allergyConflicts } : {}),
				};
			},
		}),

		findRecipes: tool({
			description:
				"Find recipes with exact filters. The signed-in customer's allergens are always excluded. Use searchKnowledge instead for vague or descriptive requests.",
			inputSchema: z.object({
				cuisine: z
					.string()
					.optional()
					.describe("e.g. Thai, Italian, Middle Eastern"),
				course: z.enum(COURSES).optional(),
				maxMinutes: z
					.number()
					.int()
					.positive()
					.optional()
					.describe("Total prep + cook time"),
				dietTags: z
					.array(z.enum(DIET_TAGS))
					.optional()
					.describe("All of these must apply"),
				excludeAllergens: z.array(z.enum(ALLERGENS)).optional(),
				ingredient: z
					.string()
					.optional()
					.describe("An ingredient the recipe must contain, e.g. 'salmon'"),
				menuWeek: z
					.string()
					.regex(/^\d{4}-\d{2}-\d{2}$/)
					.optional()
					.describe(
						"Only recipes on the menu for the week starting this Monday (YYYY-MM-DD)",
					),
				limit: z.number().int().min(1).max(20).default(8),
			}),
			execute: async (input) => {
				const excluded = [
					...new Set([
						...(input.excludeAllergens ?? []),
						...(customer?.allergies ?? []),
					]),
				];
				const where: SQL[] = [];
				if (input.cuisine) where.push(ilike(recipes.cuisine, input.cuisine));
				if (input.course) where.push(eq(recipes.course, input.course));
				if (input.maxMinutes) {
					where.push(
						sql`${recipes.prepMinutes} + ${recipes.cookMinutes} <= ${input.maxMinutes}`,
					);
				}
				if (input.dietTags?.length)
					where.push(arrayContains(recipes.dietTags, input.dietTags));
				if (excluded.length)
					where.push(not(arrayOverlaps(recipes.allergens, excluded)));
				if (input.ingredient) {
					where.push(
						exists(
							db
								.select({ one: sql`1` })
								.from(recipeIngredients)
								.innerJoin(
									ingredients,
									eq(ingredients.id, recipeIngredients.ingredientId),
								)
								.where(
									and(
										eq(recipeIngredients.recipeId, recipes.id),
										ilike(ingredients.name, `%${input.ingredient}%`),
									),
								),
						),
					);
				}
				if (input.menuWeek) {
					where.push(
						exists(
							db
								.select({ one: sql`1` })
								.from(weeklyMenus)
								.where(
									and(
										eq(weeklyMenus.recipeId, recipes.id),
										eq(weeklyMenus.weekStart, input.menuWeek),
									),
								),
						),
					);
				}
				const rows = await db
					.select({
						id: recipes.id,
						title: recipes.title,
						cuisine: recipes.cuisine,
						course: recipes.course,
						prepMinutes: recipes.prepMinutes,
						cookMinutes: recipes.cookMinutes,
						dietTags: recipes.dietTags,
						allergens: recipes.allergens,
						rating: recipes.rating,
						isPremium: recipes.isPremium,
					})
					.from(recipes)
					.where(and(...where))
					.orderBy(desc(recipes.rating))
					.limit(input.limit);
				return {
					recipes: rows.map(({ prepMinutes, cookMinutes, ...row }) => ({
						...row,
						totalMinutes: prepMinutes + cookMinutes,
					})),
					excludedAllergens: excluded,
				};
			},
		}),

		getRecipe: tool({
			description:
				"Get one recipe's full ingredients, steps, nutrition and allergens. Returns a numbered source to cite as [n].",
			inputSchema: z.object({
				recipeId: z
					.string()
					.describe("The recipe id, e.g. 'miso-butter-salmon'"),
			}),
			execute: async ({ recipeId }) => {
				const [recipe] = await db
					.select()
					.from(recipes)
					.where(eq(recipes.id, recipeId));
				if (!recipe) return { error: `No recipe with id ${recipeId}.` };
				const items = await db
					.select({
						name: ingredients.name,
						quantity: recipeIngredients.quantity,
						unit: recipeIngredients.unit,
						note: recipeIngredients.note,
						allergens: recipeIngredients.allergens,
					})
					.from(recipeIngredients)
					.innerJoin(
						ingredients,
						eq(ingredients.id, recipeIngredients.ingredientId),
					)
					.where(eq(recipeIngredients.recipeId, recipeId))
					.orderBy(asc(recipeIngredients.position));
				const source = sources.add(`recipe:${recipeId}`, {
					kind: "recipe",
					sourceId: recipeId,
					title: recipe.title,
					section: "Full recipe",
					text: `${recipe.description}\nAllergens: ${recipe.allergens.join(", ") || "none"}.`,
				});
				const clash = conflicts(recipe.allergens, customer);
				return {
					sources: [source],
					recipe: {
						id: recipe.id,
						title: recipe.title,
						description: recipe.description,
						cuisine: recipe.cuisine,
						course: recipe.course,
						difficulty: recipe.difficulty,
						totalMinutes: recipe.prepMinutes + recipe.cookMinutes,
						servings: recipe.servings,
						perServing: {
							calories: recipe.calories,
							proteinG: recipe.proteinG,
							carbsG: recipe.carbsG,
							fatG: recipe.fatG,
						},
						dietTags: recipe.dietTags,
						allergens: recipe.allergens,
						isPremium: recipe.isPremium,
						ingredients: items,
						steps: recipe.steps,
						tips: recipe.tips,
					},
					...(clash.length ? { allergyConflicts: clash } : {}),
				};
			},
		}),
	};
}

// The signed-in customer's own data. `customerId` comes from the session,
// so no tool input can point at another customer.
function accountTools({
	customer,
	chatId,
	dryRun,
}: ToolsOptions & { customer: NonNullable<CustomerContext> }) {
	const customerId = customer.id;
	return {
		getMyAccount: tool({
			description:
				"The signed-in customer's profile, preferences, allergies, subscription and credit history.",
			inputSchema: z.object({}),
			execute: async () => {
				const [profile] = await db
					.select()
					.from(customers)
					.where(eq(customers.id, customerId));
				const [subscription] = await db
					.select()
					.from(subscriptions)
					.where(eq(subscriptions.customerId, customerId));
				const history = await db
					.select({
						amount: credits.amount,
						reason: credits.reason,
						orderId: credits.orderId,
						issuedAt: credits.issuedAt,
					})
					.from(credits)
					.where(eq(credits.customerId, customerId))
					.orderBy(desc(credits.issuedAt));
				return {
					profile,
					subscription,
					credits: history,
					totalCredited: round(
						history.reduce((total, credit) => total + credit.amount, 0),
					),
				};
			},
		}),

		getMyOrders: tool({
			description: `The signed-in customer's boxes with their recipes, split into the next box, upcoming boxes (soonest first) and recent ones (newest first). Today is ${TODAY}. "changeable" means it's before the cutoff, so recipes can still be swapped or the box skipped. "creditable" means a problem can still be reported (delivered within ${REPORT_WINDOW_DAYS} days).`,
			inputSchema: z.object({
				recentLimit: z
					.number()
					.int()
					.min(1)
					.max(12)
					.default(4)
					.describe(
						"How many past boxes to include. Raise it (up to 12) when the customer mentions an older delivery.",
					),
			}),
			execute: async ({ recentLimit }) => {
				const rows = await db
					.select()
					.from(orders)
					.where(eq(orders.customerId, customerId))
					.orderBy(desc(orders.weekStart));
				const items = rows.length
					? await db
							.select({
								orderId: orderItems.orderId,
								recipeId: orderItems.recipeId,
								title: recipes.title,
								servings: orderItems.servings,
								unitPrice: orderItems.unitPrice,
								allergens: recipes.allergens,
							})
							.from(orderItems)
							.innerJoin(recipes, eq(recipes.id, orderItems.recipeId))
							.where(
								inArray(
									orderItems.orderId,
									rows.map((row) => row.id),
								),
							)
					: [];
				const describe = (order: (typeof rows)[number]) => {
					const age =
						order.status === "delivered"
							? daysBetween(order.deliveryDate, TODAY)
							: null;
					return {
						id: order.id,
						deliveryDate: order.deliveryDate,
						status: order.status,
						changeable: order.status === "scheduled",
						daysSinceDelivery: age,
						creditable: age !== null && age <= REPORT_WINDOW_DAYS,
						subtotal: order.subtotal,
						recipes: items
							.filter((item) => item.orderId === order.id)
							.map(({ orderId: _, allergens, ...item }) => {
								const clash = conflicts(allergens, customer);
								return clash.length
									? { ...item, allergyConflicts: clash }
									: item;
							}),
					};
				};
				// Ambiguous output makes for wrong answers: "newest first" once led
				// the agent to describe the box after next as the next one. So the
				// next box is named explicitly.
				const upcoming = rows
					.filter(
						(order) =>
							order.deliveryDate >= TODAY && order.status !== "delivered",
					)
					.reverse();
				const recent = rows.filter((order) => !upcoming.includes(order));
				const next = upcoming.find((order) => order.status !== "skipped");
				return {
					today: TODAY,
					nextBox: next ? describe(next) : null,
					upcoming: upcoming.map(describe),
					recent: recent.slice(0, recentLimit).map(describe),
				};
			},
		}),

		issueCredit: tool({
			description: `Credit a missing or damaged recipe from a delivered box. The amount is computed from the policy (per-serving price × servings), never chosen by you. Credits above ${money(AUTO_CREDIT_LIMIT)} per box are refused automatically: use requestSupportReview for those. The customer approves every credit before it's issued.`,
			inputSchema: z.object({
				orderId: z.string().describe("e.g. 'ord_0123'"),
				recipeId: z.string().describe("The affected recipe's id"),
				problem: z.enum(["missing", "damaged"]),
				details: z
					.string()
					.describe("What was missing or damaged, in a few words"),
			}),
			execute: async ({ orderId, recipeId, problem, details }) => {
				const quote = await quoteCredit(customerId, orderId, recipeId);
				if (!quote.ok) return { issued: false, error: quote.error };
				if (quote.overLimit) {
					return {
						issued: false,
						error: `Above the ${money(AUTO_CREDIT_LIMIT)} automatic limit.`,
					};
				}
				if (dryRun) {
					return { issued: false, dryRun: true, amount: quote.amount };
				}
				const id = `crd_${nanoid(8)}`;
				await db.insert(credits).values({
					id,
					customerId,
					orderId,
					recipeId,
					amount: quote.amount,
					reason: `${problem === "missing" ? "Missing" : "Damaged"}: ${details} (${quote.recipeTitle})`,
					issuedBy: "agent",
					issuedAt: new Date(),
				});
				return {
					issued: true,
					creditId: id,
					amount: quote.amount,
					appliesTo: "the customer's next box",
				};
			},
		}),

		requestSupportReview: tool({
			description:
				"Open a case for Mise's support team, for anything you can't resolve: credits above the automatic limit, late boxes, complaints. Support replies within 1 business day.",
			inputSchema: z.object({
				orderId: z.string().optional(),
				summary: z
					.string()
					.describe(
						"What happened and what the customer wants, for the support agent",
					),
			}),
			execute: async ({ orderId, summary }) => {
				if (orderId) {
					const [order] = await db
						.select({ id: orders.id })
						.from(orders)
						.where(
							and(eq(orders.id, orderId), eq(orders.customerId, customerId)),
						);
					if (!order)
						return {
							opened: false,
							error: `Order ${orderId} isn't one of this customer's orders.`,
						};
				}
				if (dryRun) {
					return {
						opened: true,
						ticketId: "tkt_dry_run",
						expectedReply: "within 1 business day",
						dryRun: true,
					};
				}
				const id = `tkt_${nanoid(8)}`;
				await db
					.insert(supportTickets)
					.values({ id, customerId, orderId, chatId, summary });
				return {
					opened: true,
					ticketId: id,
					expectedReply: "within 1 business day",
				};
			},
		}),
	};
}

export type AgentTools = ReturnType<typeof knowledgeTools> &
	ReturnType<typeof accountTools>;

// Guests only get the knowledge tools; the model never sees account tools it can't use.
export function createTools(options: ToolsOptions): Partial<AgentTools> {
	const knowledge = knowledgeTools(options);
	return options.customer
		? {
				...knowledge,
				...accountTools({ ...options, customer: options.customer }),
			}
		: knowledge;
}
