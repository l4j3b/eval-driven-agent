# Phase 0: Setup

The skeleton that every later phase builds on: a chat app, a database the agent can use, and tracing for every model call.

## What's here

| Piece | Where | Notes |
| --- | --- | --- |
| Chat UI | `src/routes/index.tsx` | Reused from Ripple: ai-elements `Conversation`, `Message`, `PromptInput` and `useChat`. |
| Chat API | `src/routes/api/chat.ts` | `streamText` through the AI Gateway, streamed back as UI message parts. |
| Models | `src/lib/models.ts` | Gemini 2.5 Flash answers and judges, Flash-Lite does cheap jobs, `gemini-embedding-001` embeds, Cohere reranks. All through one gateway key. |
| Tracing | `src/server/telemetry.ts` | AI SDK telemetry, sent to Langfuse as OpenTelemetry spans. |
| Langfuse | `langfuse/docker-compose.yml` | The official compose file, with the web UI and MinIO bound to 127.0.0.1 and auto-provisioning added. |
| Database | `db/bootstrap.sql`, `src/db/*`, `drizzle/` | Supabase Postgres, pgvector, Drizzle, and least-privilege roles. |

## How a chat turn is traced

1. The browser sends the whole conversation to `/api/chat` with the chat's `id`.
2. `propagateAttributes({ sessionId: id })` tags everything inside it, so all turns of one chat group into one Langfuse **session**.
3. `streamText` runs. The AI SDK's telemetry integration emits OpenTelemetry **spans**: one for the call and one per step, with model, prompt, output, token usage and latency.
4. `LangfuseSpanProcessor` batches the spans and sends them to Langfuse. Each request becomes a **trace**, and each model call inside it becomes a **generation**.

Langfuse, Braintrust, LangSmith and Phoenix all use this model: a trace is a tree of spans, LLM calls are spans with token and cost data, and scores attach to traces. Braintrust calls traces "logs", but the idea is the same.

## Models and the gateway's free tier

The AI Gateway needs a credit card on file before it serves any request. With a card but no paid credits, it runs on its **free tier**, which excludes Claude and OpenAI's embedding models; Gemini 2.5 Flash and Flash-Lite, Google's embedding models and Cohere rerank all work. So the demo runs on Google models.

- Moving to Claude later is a one-line change per role in `src/lib/models.ts`, after topping up credits.
- The judge is the same model as the agent for now. Ideally it would be a different, stronger one (Gemini Pro and Claude aren't free), so it doesn't favor its own style. That's a known limitation worth mentioning in the interview.
- The free tier is rate limited per minute. Batch jobs (data generation, evals) run a few calls at a time with retries, and a chat sent while a batch job runs can take a minute or two to answer.

## Database roles

The Supabase project is shared with another app, so the demo gets its own corner:

- `agent_app` is the app's login. It owns the `agent` schema and nothing else, so a bug or a SQL injection in the demo can't touch other schemas.
- `agent_readonly` can't log in. In phase 3, the text-to-SQL tool runs inside a transaction with `set local role agent_readonly`, so even a malicious generated query can only `select` from the views we grant.
- The password is set with a SCRAM-SHA-256 hash computed locally (`alter role ... password 'SCRAM-SHA-256$...'`), so the plain text never reaches Supabase's logs.
- The app connects through **Supavisor's session pooler** (port 5432). Supabase's direct connection is IPv6-only, and the pooler shares a few Postgres connections between clients. A serverless deploy would use the transaction pooler (port 6543) with `prepare: false`, since prepared statements don't survive connection swaps.

Migrations are generated from `src/db/schema.ts` with `npm run db:generate` and applied with `npm run db:migrate`, which runs Drizzle's migrator in a script. (`drizzle-kit migrate` exits silently on some errors.)

### Zero's event triggers (disabled)

This Supabase project also hosted an app built on Rocicorp Zero. Zero installs event triggers that run on every `CREATE TABLE`, `ALTER TABLE` or `CREATE INDEX` in the database and call functions in the `zero_0` schema. `agent_app` isn't allowed to call those, so its migrations failed with `permission denied` (`42501`).

Zero's replication slot had been inactive since April 2026 and was marked `lost`, so on 2026-10-17 its 8 triggers were disabled. Nothing was deleted. To bring them back (Zero would also reinstall them on its next start):

```sql
alter event trigger zero_ddl_start_0 enable;
alter event trigger zero_create_table_0 enable;
alter event trigger zero_alter_table_0 enable;
alter event trigger zero_drop_table_0 enable;
alter event trigger zero_create_index_0 enable;
alter event trigger zero_drop_index_0 enable;
alter event trigger zero_alter_publication_0 enable;
alter event trigger zero_alter_schema_0 enable;
```

## Running it

```bash
npm install
npm run langfuse:up      # needs OrbStack or Docker; first run downloads ~2 GB
npm run dev              # http://localhost:3001
```

Langfuse runs at http://localhost:3000. Sign up there with any email and password; it's a local account, and new users join the `agent-lab` project automatically.

If `npm run langfuse:up` fails with `error getting credentials`, macOS blocked Docker's Keychain lookup. Approve the Keychain prompt, or pull once with an empty Docker config: `DOCKER_CONFIG=$(mktemp -d) docker compose -f langfuse/docker-compose.yml pull`.

## Interview questions this prepares you for

- **How do you see what an agent did on a given request?** Traces: every model and tool call is a span with inputs, outputs, tokens, cost and latency, grouped by session and user.
- **What is OpenTelemetry, and why does it matter here?** It's a vendor-neutral standard for spans. The AI SDK emits spans once, and any backend (Langfuse, Datadog, Honeycomb) can receive them, so switching vendors doesn't change application code.
- **Why a model gateway?** One key and one bill. Switching or A/B-testing models is a string change, and there's a single place for fallbacks and rate limits.
- **Why self-host Langfuse instead of using Braintrust?** It's MIT-licensed, keeps data local, and has the same building blocks. The trade-off is running the infrastructure yourself (Postgres, ClickHouse, Redis, MinIO).
- **How do you secure the database an agent can query?** Least-privilege roles, a read-only role for generated SQL, statement timeouts, and only exposing views.
