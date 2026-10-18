CREATE TYPE "agent"."chunk_source" AS ENUM('recipe', 'article');--> statement-breakpoint
CREATE TABLE "agent"."chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"source_type" "agent"."chunk_source" NOT NULL,
	"source_id" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"heading" text,
	"content" text NOT NULL,
	"context" text,
	"content_hash" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"fts" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("heading", '')), 'B') || setweight(to_tsvector('english', coalesce("context", '') || ' ' || "content"), 'C')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent"."chunks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "chunks_source_type_source_id_index" ON "agent"."chunks" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "chunks_embedding_hnsw" ON "agent"."chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "chunks_fts_gin" ON "agent"."chunks" USING gin ("fts");