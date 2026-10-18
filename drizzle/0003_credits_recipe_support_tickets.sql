CREATE TYPE "agent"."ticket_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TABLE "agent"."support_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"order_id" text,
	"chat_id" text,
	"summary" text NOT NULL,
	"status" "agent"."ticket_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent"."support_tickets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent"."credits" ADD COLUMN "recipe_id" text;--> statement-breakpoint
ALTER TABLE "agent"."support_tickets" ADD CONSTRAINT "support_tickets_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "agent"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."support_tickets" ADD CONSTRAINT "support_tickets_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "agent"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_tickets_customer_id_index" ON "agent"."support_tickets" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "support_tickets_order_id_index" ON "agent"."support_tickets" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "agent"."credits" ADD CONSTRAINT "credits_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "agent"."recipes"("id") ON DELETE no action ON UPDATE no action;