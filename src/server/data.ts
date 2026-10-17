import { createServerFn } from "@tanstack/react-start";
import { asc } from "drizzle-orm";

import { db } from "#/db/client";
import {
	articles,
	chatMessages,
	chats,
	credits,
	customers,
	ingredients,
	orderItems,
	orders,
	recipeIngredients,
	recipes,
	subscriptions,
	weeklyMenus,
} from "#/db/schema";

function groupBy<T, K>(rows: T[], key: (row: T) => K) {
	const groups = new Map<K, T[]>();
	for (const row of rows) {
		const k = key(row);
		groups.set(k, [...(groups.get(k) ?? []), row]);
	}
	return groups;
}

// Everything the data page shows, in one round trip. The dataset is small
// (a few hundred rows), so there is no pagination.
export const getDataExplorer = createServerFn({ method: "GET" }).handler(
	async () => {
		const [
			recipeRows,
			recipeIngredientRows,
			ingredientRows,
			articleRows,
			customerRows,
			subscriptionRows,
			orderRows,
			orderItemRows,
			creditRows,
			menuRows,
			chatCount,
			messageCount,
		] = await Promise.all([
			db
				.select()
				.from(recipes)
				.orderBy(asc(recipes.cuisine), asc(recipes.title)),
			db
				.select()
				.from(recipeIngredients)
				.orderBy(
					asc(recipeIngredients.recipeId),
					asc(recipeIngredients.position),
				),
			db.select().from(ingredients),
			db
				.select()
				.from(articles)
				.orderBy(asc(articles.category), asc(articles.title)),
			db.select().from(customers).orderBy(asc(customers.id)),
			db.select().from(subscriptions),
			db.select().from(orders).orderBy(asc(orders.weekStart), asc(orders.id)),
			db.select().from(orderItems),
			db.select().from(credits).orderBy(asc(credits.issuedAt)),
			db.select().from(weeklyMenus).orderBy(asc(weeklyMenus.weekStart)),
			db.$count(chats),
			db.$count(chatMessages),
		]);

		const ingredientName = new Map(
			ingredientRows.map((row) => [row.id, row.name]),
		);
		const recipeTitle = new Map(recipeRows.map((row) => [row.id, row.title]));
		const ingredientsByRecipe = groupBy(
			recipeIngredientRows,
			(row) => row.recipeId,
		);
		const itemsByOrder = groupBy(orderItemRows, (row) => row.orderId);
		const ordersByCustomer = groupBy(orderRows, (row) => row.customerId);
		const creditsByCustomer = groupBy(creditRows, (row) => row.customerId);
		const subscriptionByCustomer = new Map(
			subscriptionRows.map((row) => [row.customerId, row]),
		);
		const customerName = new Map(customerRows.map((row) => [row.id, row.name]));

		const orderViews = orderRows.map((order) => ({
			...order,
			customerName: customerName.get(order.customerId) ?? order.customerId,
			items: (itemsByOrder.get(order.id) ?? []).map((item) => ({
				...item,
				title: recipeTitle.get(item.recipeId) ?? item.recipeId,
			})),
		}));
		const orderViewsByCustomer = groupBy(orderViews, (row) => row.customerId);

		return {
			counts: {
				recipes: recipeRows.length,
				ingredients: ingredientRows.length,
				recipeIngredients: recipeIngredientRows.length,
				articles: articleRows.length,
				weeklyMenus: menuRows.length,
				customers: customerRows.length,
				subscriptions: subscriptionRows.length,
				orders: orderRows.length,
				orderItems: orderItemRows.length,
				credits: creditRows.length,
				chats: chatCount,
				chatMessages: messageCount,
			},
			recipes: recipeRows.map((recipe) => ({
				...recipe,
				ingredients: (ingredientsByRecipe.get(recipe.id) ?? []).map((row) => ({
					name: ingredientName.get(row.ingredientId) ?? row.ingredientId,
					quantity: row.quantity,
					unit: row.unit,
					note: row.note,
					allergens: row.allergens,
				})),
			})),
			articles: articleRows,
			customers: customerRows.map((customer) => ({
				...customer,
				subscription: subscriptionByCustomer.get(customer.id) ?? null,
				orderCount: (ordersByCustomer.get(customer.id) ?? []).filter(
					(order) => order.status !== "skipped",
				).length,
				orders: orderViewsByCustomer.get(customer.id) ?? [],
				credits: creditsByCustomer.get(customer.id) ?? [],
			})),
			orders: orderViews,
			menus: [...groupBy(menuRows, (row) => row.weekStart)].map(
				([weekStart, rows]) => ({
					weekStart,
					recipes: rows.map((row) => ({
						id: row.recipeId,
						title: recipeTitle.get(row.recipeId) ?? row.recipeId,
					})),
				}),
			),
		};
	},
);

export type DataExplorer = Awaited<ReturnType<typeof getDataExplorer>>;
