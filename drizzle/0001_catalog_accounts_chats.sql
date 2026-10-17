CREATE TYPE "agent"."article_category" AS ENUM('technique', 'food-safety', 'substitutions', 'help-center');--> statement-breakpoint
CREATE TYPE "agent"."article_status" AS ENUM('published', 'archived');--> statement-breakpoint
CREATE TYPE "agent"."course" AS ENUM('main', 'side', 'dessert', 'breakfast');--> statement-breakpoint
CREATE TYPE "agent"."difficulty" AS ENUM('easy', 'medium', 'hard');--> statement-breakpoint
CREATE TYPE "agent"."ingredient_category" AS ENUM('produce', 'protein', 'seafood', 'dairy', 'grain', 'pantry', 'spice', 'herb', 'sauce');--> statement-breakpoint
CREATE TYPE "agent"."order_status" AS ENUM('scheduled', 'processing', 'delivered', 'skipped');--> statement-breakpoint
CREATE TYPE "agent"."subscription_status" AS ENUM('active', 'paused', 'cancelled');--> statement-breakpoint
CREATE TABLE "agent"."articles" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"category" "agent"."article_category" NOT NULL,
	"status" "agent"."article_status" DEFAULT 'published' NOT NULL,
	"summary" text NOT NULL,
	"body" text NOT NULL,
	"published_on" date NOT NULL,
	"superseded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent"."articles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent"."chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent"."chat_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent"."chats" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"customer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent"."chats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent"."credits" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"order_id" text,
	"amount" numeric(6, 2) NOT NULL,
	"reason" text NOT NULL,
	"issued_by" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent"."credits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent"."customers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"city" text NOT NULL,
	"household_size" integer NOT NULL,
	"dietary_preferences" text[] DEFAULT '{}' NOT NULL,
	"allergies" text[] DEFAULT '{}' NOT NULL,
	"joined_on" date NOT NULL,
	CONSTRAINT "customers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "agent"."customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent"."ingredients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" "agent"."ingredient_category" NOT NULL,
	CONSTRAINT "ingredients_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "agent"."ingredients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent"."order_items" (
	"order_id" text NOT NULL,
	"recipe_id" text NOT NULL,
	"servings" integer NOT NULL,
	"unit_price" numeric(6, 2) NOT NULL,
	CONSTRAINT "order_items_order_id_recipe_id_pk" PRIMARY KEY("order_id","recipe_id")
);
--> statement-breakpoint
ALTER TABLE "agent"."order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent"."orders" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"week_start" date NOT NULL,
	"status" "agent"."order_status" NOT NULL,
	"delivery_date" date NOT NULL,
	"subtotal" numeric(8, 2) NOT NULL,
	"shipping" numeric(6, 2) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent"."orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent"."recipe_ingredients" (
	"recipe_id" text NOT NULL,
	"position" integer NOT NULL,
	"ingredient_id" text NOT NULL,
	"quantity" real,
	"unit" text,
	"note" text,
	"allergens" text[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "recipe_ingredients_recipe_id_position_pk" PRIMARY KEY("recipe_id","position")
);
--> statement-breakpoint
ALTER TABLE "agent"."recipe_ingredients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent"."recipes" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"cuisine" text NOT NULL,
	"course" "agent"."course" NOT NULL,
	"difficulty" "agent"."difficulty" NOT NULL,
	"prep_minutes" integer NOT NULL,
	"cook_minutes" integer NOT NULL,
	"servings" integer NOT NULL,
	"calories" integer NOT NULL,
	"protein_g" integer NOT NULL,
	"carbs_g" integer NOT NULL,
	"fat_g" integer NOT NULL,
	"diet_tags" text[] DEFAULT '{}' NOT NULL,
	"allergens" text[] DEFAULT '{}' NOT NULL,
	"steps" text[] NOT NULL,
	"tips" text,
	"is_premium" boolean DEFAULT false NOT NULL,
	"rating" real NOT NULL,
	"rating_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent"."recipes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent"."subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"servings_per_recipe" integer NOT NULL,
	"recipes_per_week" integer NOT NULL,
	"status" "agent"."subscription_status" NOT NULL,
	"delivery_day" text NOT NULL,
	"price_per_serving" numeric(6, 2) NOT NULL,
	"started_on" date NOT NULL,
	"paused_until" date,
	"cancelled_on" date,
	CONSTRAINT "subscriptions_customerId_unique" UNIQUE("customer_id")
);
--> statement-breakpoint
ALTER TABLE "agent"."subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent"."weekly_menus" (
	"week_start" date NOT NULL,
	"recipe_id" text NOT NULL,
	CONSTRAINT "weekly_menus_week_start_recipe_id_pk" PRIMARY KEY("week_start","recipe_id")
);
--> statement-breakpoint
ALTER TABLE "agent"."weekly_menus" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent"."chat_messages" ADD CONSTRAINT "chat_messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "agent"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."chats" ADD CONSTRAINT "chats_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "agent"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."credits" ADD CONSTRAINT "credits_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "agent"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."credits" ADD CONSTRAINT "credits_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "agent"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "agent"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."order_items" ADD CONSTRAINT "order_items_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "agent"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "agent"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "agent"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "agent"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."subscriptions" ADD CONSTRAINT "subscriptions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "agent"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."weekly_menus" ADD CONSTRAINT "weekly_menus_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "agent"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_chat_id_created_at_index" ON "agent"."chat_messages" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "chats_customer_id_index" ON "agent"."chats" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "chats_updated_at_index" ON "agent"."chats" USING btree ("updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "credits_customer_id_index" ON "agent"."credits" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "credits_order_id_index" ON "agent"."credits" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_recipe_id_index" ON "agent"."order_items" USING btree ("recipe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_customer_id_week_start_index" ON "agent"."orders" USING btree ("customer_id","week_start");--> statement-breakpoint
CREATE INDEX "recipe_ingredients_ingredient_id_index" ON "agent"."recipe_ingredients" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "weekly_menus_recipe_id_index" ON "agent"."weekly_menus" USING btree ("recipe_id");