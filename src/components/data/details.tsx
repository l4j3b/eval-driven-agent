import { MessageResponse } from "#/components/ai-elements/message";
import { day, minutes, money } from "#/components/data/format";
import { Badge } from "#/components/ui/badge";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "#/components/ui/sheet";
import type { Trap } from "#/lib/data-notes";
import type { DataExplorer } from "#/server/data";

type Recipe = DataExplorer["recipes"][number];
type Article = DataExplorer["articles"][number];
type Customer = DataExplorer["customers"][number];

export type Selection =
	| { kind: "recipe"; item: Recipe }
	| { kind: "article"; item: Article }
	| { kind: "customer"; item: Customer };

export function Tags({
	values,
	variant = "secondary",
}: {
	values: string[];
	variant?: "secondary" | "destructive" | "outline";
}) {
	if (values.length === 0) {
		return <span className="text-muted-foreground">-</span>;
	}
	return (
		<div className="flex flex-wrap gap-1">
			{values.map((value) => (
				<Badge key={value} variant={variant}>
					{value}
				</Badge>
			))}
		</div>
	);
}

function TrapNote({ trap }: { trap?: Trap }) {
	if (!trap) return null;
	return (
		<div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
			<p className="font-medium text-amber-300">Eval trap</p>
			<p className="text-muted-foreground">{trap.note}</p>
		</div>
	);
}

function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="grid gap-1">
			<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
				{label}
			</p>
			<div className="text-sm">{children}</div>
		</div>
	);
}

function RecipeDetail({ recipe, trap }: { recipe: Recipe; trap?: Trap }) {
	return (
		<div className="grid gap-5">
			<TrapNote trap={trap} />
			<p className="text-sm">{recipe.description}</p>
			<div className="grid grid-cols-3 gap-4">
				<Field label="Time">
					{minutes(recipe.prepMinutes + recipe.cookMinutes)}
				</Field>
				<Field label="Difficulty">{recipe.difficulty}</Field>
				<Field label="Rating">
					{recipe.rating} ({recipe.ratingCount})
				</Field>
				<Field label="Per serving">
					{recipe.calories} kcal · {recipe.proteinG} g protein
				</Field>
				<Field label="Carbs · fat">
					{recipe.carbsG} g · {recipe.fatG} g
				</Field>
				<Field label="Premium">
					{recipe.isPremium ? "Yes (+$4.99)" : "No"}
				</Field>
			</div>
			<Field label="Diet tags">
				<Tags values={recipe.dietTags} />
			</Field>
			<Field label="Allergens">
				<Tags values={recipe.allergens} variant="destructive" />
			</Field>
			<Field label={`Ingredients (serves ${recipe.servings})`}>
				<ul className="grid gap-1">
					{recipe.ingredients.map((ingredient) => (
						<li className="flex justify-between gap-4" key={ingredient.name}>
							<span>
								{ingredient.name}
								{ingredient.note && (
									<span className="text-muted-foreground">
										, {ingredient.note}
									</span>
								)}
								{ingredient.allergens.length > 0 && (
									<span className="ml-2 text-destructive text-xs">
										{ingredient.allergens.join(", ")}
									</span>
								)}
							</span>
							<span className="shrink-0 text-muted-foreground">
								{[ingredient.quantity, ingredient.unit]
									.filter(Boolean)
									.join(" ")}
							</span>
						</li>
					))}
				</ul>
			</Field>
			<Field label="Steps">
				<ol className="grid list-decimal gap-2 pl-5">
					{recipe.steps.map((step) => (
						<li key={step}>{step}</li>
					))}
				</ol>
			</Field>
			{recipe.tips && <Field label="Tips">{recipe.tips}</Field>}
		</div>
	);
}

function ArticleDetail({ article, trap }: { article: Article; trap?: Trap }) {
	return (
		<div className="grid gap-5">
			<TrapNote trap={trap} />
			<div className="flex flex-wrap gap-2">
				<Badge variant="outline">{article.category}</Badge>
				<Badge
					variant={article.status === "archived" ? "destructive" : "secondary"}
				>
					{article.status}
				</Badge>
				<Badge variant="outline">Published {day(article.publishedOn)}</Badge>
				{article.supersededBy && (
					<Badge variant="outline">Replaced by {article.supersededBy}</Badge>
				)}
			</div>
			<p className="text-muted-foreground text-sm">{article.summary}</p>
			<MessageResponse>{article.body}</MessageResponse>
		</div>
	);
}

function CustomerDetail({
	customer,
	trap,
}: {
	customer: Customer;
	trap?: Trap;
}) {
	const subscription = customer.subscription;
	return (
		<div className="grid gap-5">
			<TrapNote trap={trap} />
			<div className="grid grid-cols-2 gap-4">
				<Field label="Email">{customer.email}</Field>
				<Field label="City">{customer.city}</Field>
				<Field label="Household">{customer.householdSize}</Field>
				<Field label="Joined">{day(customer.joinedOn)}</Field>
			</div>
			<Field label="Preferences">
				<Tags values={customer.dietaryPreferences} />
			</Field>
			<Field label="Allergies">
				<Tags values={customer.allergies} variant="destructive" />
			</Field>
			{subscription && (
				<Field label="Subscription">
					{subscription.recipesPerWeek} recipes ×{" "}
					{subscription.servingsPerRecipe} servings,{" "}
					{money(subscription.pricePerServing)}/serving, delivered on{" "}
					{subscription.deliveryDay}s · <strong>{subscription.status}</strong>
					{subscription.pausedUntil &&
						` until ${day(subscription.pausedUntil)}`}
					{subscription.cancelledOn && ` on ${day(subscription.cancelledOn)}`}
				</Field>
			)}
			<Field label={`Orders (${customer.orders.length})`}>
				<ul className="grid gap-2">
					{[...customer.orders].reverse().map((order) => (
						<li className="rounded-md border p-2" key={order.id}>
							<div className="flex justify-between gap-2 text-xs">
								<span className="font-mono">{order.id}</span>
								<span>
									{day(order.deliveryDate)} · {order.status}
									{order.subtotal > 0 && ` · ${money(order.subtotal)}`}
								</span>
							</div>
							{order.items.length > 0 && (
								<p className="mt-1 text-muted-foreground">
									{order.items.map((item) => item.title).join(" · ")}
								</p>
							)}
						</li>
					))}
				</ul>
			</Field>
			<Field label={`Credits (${customer.credits.length})`}>
				{customer.credits.length === 0 ? (
					<span className="text-muted-foreground">None</span>
				) : (
					<ul className="grid gap-1">
						{customer.credits.map((credit) => (
							<li className="flex justify-between gap-4" key={credit.id}>
								<span>{credit.reason}</span>
								<span className="shrink-0">
									{money(credit.amount)} · {day(credit.issuedAt)}
								</span>
							</li>
						))}
					</ul>
				)}
			</Field>
		</div>
	);
}

export function DetailSheet({
	selection,
	traps,
	onClose,
}: {
	selection: Selection | null;
	traps: Trap[];
	onClose: () => void;
}) {
	const trap = selection
		? traps.find(
				(candidate) =>
					candidate.kind === selection.kind &&
					candidate.id === selection.item.id,
			)
		: undefined;
	const title =
		selection?.kind === "customer"
			? selection.item.name
			: selection?.item.title;

	return (
		<Sheet
			onOpenChange={(open) => !open && onClose()}
			open={selection !== null}
		>
			<SheetContent className="w-full overflow-y-auto sm:max-w-xl">
				<SheetHeader>
					<SheetTitle>{title}</SheetTitle>
					<SheetDescription className="font-mono">
						{selection?.kind} · {selection?.item.id}
						{selection?.kind === "recipe" && ` · ${selection.item.cuisine}`}
					</SheetDescription>
				</SheetHeader>
				<div className="px-4 pb-6">
					{selection?.kind === "recipe" && (
						<RecipeDetail recipe={selection.item} trap={trap} />
					)}
					{selection?.kind === "article" && (
						<ArticleDetail article={selection.item} trap={trap} />
					)}
					{selection?.kind === "customer" && (
						<CustomerDetail customer={selection.item} trap={trap} />
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
}
