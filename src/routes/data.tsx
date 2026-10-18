import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { DetailSheet, type Selection, Tags } from "#/components/data/details";
import { day, minutes, money } from "#/components/data/format";
import { PageHeader } from "#/components/page-header";
import { Badge } from "#/components/ui/badge";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { TABLE_NOTES, TRAPS } from "#/lib/data-notes";
import { type DataExplorer, getDataExplorer } from "#/server/data";

const TABS = [
	"overview",
	"recipes",
	"articles",
	"customers",
	"orders",
	"menus",
] as const;

export const Route = createFileRoute("/data")({
	validateSearch: z.object({ tab: z.enum(TABS).optional().catch(undefined) }),
	loader: () => getDataExplorer(),
	component: DataPage,
});

function DataPage() {
	const data = Route.useLoaderData();
	const tab = Route.useSearch({ select: (search) => search.tab ?? "overview" });
	const navigate = Route.useNavigate();
	const [selection, setSelection] = useState<Selection | null>(null);
	const [query, setQuery] = useState("");

	const open = (kind: Selection["kind"], id: string) => {
		const item =
			kind === "recipe"
				? data.recipes.find((row) => row.id === id)
				: kind === "article"
					? data.articles.find((row) => row.id === id)
					: data.customers.find((row) => row.id === id);
		if (item) setSelection({ kind, item } as Selection);
	};

	const isEmpty = data.counts.recipes === 0;

	return (
		<>
			<PageHeader>Data</PageHeader>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto grid max-w-6xl gap-6 p-6">
					<div>
						<h1 className="font-semibold text-2xl tracking-tight">
							What the agent can work with
						</h1>
						<p className="text-muted-foreground">
							Dummy data for Mise, a fictional meal-kit company. Recipes and
							articles were written by Gemini 2.5 Flash from briefs in{" "}
							<code>scripts/data/briefs.ts</code>; accounts come from Faker with
							a fixed seed.
						</p>
					</div>

					{isEmpty && (
						<Card>
							<CardHeader>
								<CardTitle>No data yet</CardTitle>
								<CardDescription>
									Run <code>npm run data:generate</code>, then{" "}
									<code>npm run db:seed</code>.
								</CardDescription>
							</CardHeader>
						</Card>
					)}

					<Tabs
						onValueChange={(value) =>
							navigate({ search: { tab: value as (typeof TABS)[number] } })
						}
						value={tab}
					>
						<TabsList className="max-w-full justify-start overflow-x-auto">
							<TabsTrigger value="overview">Overview</TabsTrigger>
							<TabsTrigger value="recipes">
								Recipes ({data.counts.recipes})
							</TabsTrigger>
							<TabsTrigger value="articles">
								Articles ({data.counts.articles})
							</TabsTrigger>
							<TabsTrigger value="customers">
								Customers ({data.counts.customers})
							</TabsTrigger>
							<TabsTrigger value="orders">
								Orders ({data.counts.orders})
							</TabsTrigger>
							<TabsTrigger value="menus">Menus</TabsTrigger>
						</TabsList>

						<TabsContent className="grid gap-6 pt-4" value="overview">
							<Overview data={data} onOpen={open} />
						</TabsContent>
						<TabsContent className="grid gap-3 pt-4" value="recipes">
							<Input
								className="max-w-sm"
								onChange={(event) => setQuery(event.target.value)}
								placeholder="Filter by title, cuisine, tag or allergen…"
								value={query}
							/>
							<Recipes
								onOpen={(id) => open("recipe", id)}
								query={query}
								recipes={data.recipes}
							/>
						</TabsContent>
						<TabsContent className="pt-4" value="articles">
							<Articles
								articles={data.articles}
								onOpen={(id) => open("article", id)}
							/>
						</TabsContent>
						<TabsContent className="pt-4" value="customers">
							<Customers
								customers={data.customers}
								onOpen={(id) => open("customer", id)}
							/>
						</TabsContent>
						<TabsContent className="pt-4" value="orders">
							<Orders
								onOpenCustomer={(id) => open("customer", id)}
								orders={data.orders}
							/>
						</TabsContent>
						<TabsContent className="grid gap-4 pt-4" value="menus">
							{data.menus.map((menu) => (
								<div className="grid gap-2" key={menu.weekStart}>
									<p className="font-medium text-sm">
										Week of {day(menu.weekStart)}
									</p>
									<div className="flex flex-wrap gap-1.5">
										{menu.recipes.map((recipe) => (
											<button
												className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
												key={recipe.id}
												onClick={() => open("recipe", recipe.id)}
												type="button"
											>
												{recipe.title}
											</button>
										))}
									</div>
								</div>
							))}
						</TabsContent>
					</Tabs>
				</div>
			</div>
			<DetailSheet
				onClose={() => setSelection(null)}
				selection={selection}
				traps={TRAPS}
			/>
		</>
	);
}

function Overview({
	data,
	onOpen,
}: {
	data: DataExplorer;
	onOpen: (kind: Selection["kind"], id: string) => void;
}) {
	return (
		<>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{TABLE_NOTES.map((table) => (
					<Card className="gap-2 py-4" key={table.name}>
						<CardHeader className="px-4">
							<div className="flex items-center justify-between gap-2">
								<CardTitle className="font-mono text-sm">
									{table.name}
								</CardTitle>
								<Badge variant="outline">{table.role}</Badge>
							</div>
							<p className="font-semibold text-2xl">
								{table.keys
									.map((key) => data.counts[key].toLocaleString())
									.join(" · ")}
								<span className="ml-1 font-normal text-muted-foreground text-xs">
									rows
								</span>
							</p>
							<CardDescription className="text-xs">
								{table.note}
							</CardDescription>
						</CardHeader>
					</Card>
				))}
			</div>

			<div className="grid gap-2">
				<h2 className="font-semibold text-lg">Eval traps</h2>
				<p className="text-muted-foreground text-sm">
					Planted on purpose, so the evals in phase 5 have something to catch.
					They live only in this page's code, never where the agent can read
					them.
				</p>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Item</TableHead>
							<TableHead>What it tests</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{TRAPS.map((trap) => (
							<TableRow
								className="cursor-pointer"
								key={`${trap.kind}:${trap.id}`}
								onClick={() => onOpen(trap.kind, trap.id)}
							>
								<TableCell className="align-top">
									<div className="font-medium">{trap.title}</div>
									<div className="font-mono text-muted-foreground text-xs">
										{trap.kind} · {trap.id}
									</div>
								</TableCell>
								<TableCell className="whitespace-normal text-muted-foreground">
									{trap.note}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</>
	);
}

function Recipes({
	recipes,
	query,
	onOpen,
}: {
	recipes: DataExplorer["recipes"];
	query: string;
	onOpen: (id: string) => void;
}) {
	const needle = query.trim().toLowerCase();
	const rows = needle
		? recipes.filter((recipe) =>
				[recipe.title, recipe.cuisine, ...recipe.dietTags, ...recipe.allergens]
					.join(" ")
					.toLowerCase()
					.includes(needle),
			)
		: recipes;
	const trapIds = new Set(
		TRAPS.filter((trap) => trap.kind === "recipe").map((trap) => trap.id),
	);

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Recipe</TableHead>
					<TableHead>Cuisine</TableHead>
					<TableHead>Course</TableHead>
					<TableHead>Time</TableHead>
					<TableHead>Diet</TableHead>
					<TableHead>Allergens</TableHead>
					<TableHead className="text-right">Rating</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.map((recipe) => (
					<TableRow
						className="cursor-pointer"
						key={recipe.id}
						onClick={() => onOpen(recipe.id)}
					>
						<TableCell className="max-w-72 whitespace-normal font-medium">
							{recipe.title}
							{recipe.isPremium && (
								<Badge className="ml-2" variant="outline">
									premium
								</Badge>
							)}
							{trapIds.has(recipe.id) && (
								<Badge className="ml-2 bg-amber-500/20 text-amber-300">
									trap
								</Badge>
							)}
						</TableCell>
						<TableCell>{recipe.cuisine}</TableCell>
						<TableCell>{recipe.course}</TableCell>
						<TableCell>
							{minutes(recipe.prepMinutes + recipe.cookMinutes)}
						</TableCell>
						<TableCell className="max-w-48 whitespace-normal">
							<Tags values={recipe.dietTags} />
						</TableCell>
						<TableCell className="max-w-48 whitespace-normal">
							<Tags values={recipe.allergens} variant="destructive" />
						</TableCell>
						<TableCell className="text-right">{recipe.rating}</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

function Articles({
	articles,
	onOpen,
}: {
	articles: DataExplorer["articles"];
	onOpen: (id: string) => void;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Article</TableHead>
					<TableHead>Category</TableHead>
					<TableHead>Status</TableHead>
					<TableHead>Published</TableHead>
					<TableHead className="text-right">Words</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{articles.map((article) => (
					<TableRow
						className="cursor-pointer"
						key={article.id}
						onClick={() => onOpen(article.id)}
					>
						<TableCell className="max-w-96 whitespace-normal">
							<div className="font-medium">{article.title}</div>
							<div className="text-muted-foreground text-xs">
								{article.summary}
							</div>
						</TableCell>
						<TableCell>{article.category}</TableCell>
						<TableCell>
							<Badge
								variant={
									article.status === "archived" ? "destructive" : "secondary"
								}
							>
								{article.status}
							</Badge>
						</TableCell>
						<TableCell>{day(article.publishedOn)}</TableCell>
						<TableCell className="text-right">
							{article.body.split(/\s+/).length}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

function Customers({
	customers,
	onOpen,
}: {
	customers: DataExplorer["customers"];
	onOpen: (id: string) => void;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Customer</TableHead>
					<TableHead>Plan</TableHead>
					<TableHead>Status</TableHead>
					<TableHead>Preferences</TableHead>
					<TableHead>Allergies</TableHead>
					<TableHead className="text-right">Boxes</TableHead>
					<TableHead className="text-right">Credits</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{customers.map((customer) => (
					<TableRow
						className="cursor-pointer"
						key={customer.id}
						onClick={() => onOpen(customer.id)}
					>
						<TableCell>
							<div className="font-medium">{customer.name}</div>
							<div className="font-mono text-muted-foreground text-xs">
								{customer.id} · {customer.city}
							</div>
						</TableCell>
						<TableCell>
							{customer.subscription &&
								`${customer.subscription.recipesPerWeek} × ${customer.subscription.servingsPerRecipe} servings`}
						</TableCell>
						<TableCell>
							<Badge
								variant={
									customer.subscription?.status === "active"
										? "secondary"
										: "outline"
								}
							>
								{customer.subscription?.status}
							</Badge>
						</TableCell>
						<TableCell>
							<Tags values={customer.dietaryPreferences} />
						</TableCell>
						<TableCell>
							<Tags values={customer.allergies} variant="destructive" />
						</TableCell>
						<TableCell className="text-right">{customer.orderCount}</TableCell>
						<TableCell className="text-right">
							{customer.credits.length > 0
								? money(
										customer.credits.reduce(
											(sum, credit) => sum + credit.amount,
											0,
										),
									)
								: "-"}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

function Orders({
	orders,
	onOpenCustomer,
}: {
	orders: DataExplorer["orders"];
	onOpenCustomer: (id: string) => void;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Order</TableHead>
					<TableHead>Customer</TableHead>
					<TableHead>Delivery</TableHead>
					<TableHead>Status</TableHead>
					<TableHead>Recipes</TableHead>
					<TableHead className="text-right">Subtotal</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{[...orders].reverse().map((order) => (
					<TableRow
						className="cursor-pointer"
						key={order.id}
						onClick={() => onOpenCustomer(order.customerId)}
					>
						<TableCell className="font-mono text-xs">{order.id}</TableCell>
						<TableCell>{order.customerName}</TableCell>
						<TableCell>{day(order.deliveryDate)}</TableCell>
						<TableCell>
							<Badge
								variant={order.status === "delivered" ? "secondary" : "outline"}
							>
								{order.status}
							</Badge>
						</TableCell>
						<TableCell className="max-w-96 whitespace-normal text-muted-foreground text-xs">
							{order.items.map((item) => item.title).join(" · ") || "-"}
						</TableCell>
						<TableCell className="text-right">
							{order.subtotal > 0 ? money(order.subtotal) : "-"}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
