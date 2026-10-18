// Closed vocabularies shared by the data generator, the database rows and the
// agent's tool schemas, so the model can only ask for values that exist.

export const ALLERGENS = [
	"peanuts",
	"tree-nuts",
	"dairy",
	"eggs",
	"gluten",
	"soy",
	"fish",
	"shellfish",
	"sesame",
] as const;

export const DIET_TAGS = [
	"vegetarian",
	"vegan",
	"pescatarian",
	"gluten-free",
	"dairy-free",
	"high-protein",
	"low-carb",
	"spicy",
	"kid-friendly",
] as const;

export const INGREDIENT_CATEGORIES = [
	"produce",
	"protein",
	"seafood",
	"dairy",
	"grain",
	"pantry",
	"spice",
	"herb",
	"sauce",
] as const;

export const COURSES = ["main", "side", "dessert", "breakfast"] as const;
