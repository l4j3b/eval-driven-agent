# Phase 0: Setup

The skeleton that every later phase builds on: a chat app, a database the agent can use, and tracing for every model call.

## What's here

| Piece | Where | Notes |
| --- | --- | --- |
| Chat UI | `src/components/chat.tsx` | ai-elements `Conversation`, `Message`, `PromptInput` and `useChat`. |
| Chat API | `src/routes/api/chat.ts` | The agent (`ToolLoopAgent`, phase 7) streamed through the AI Gateway and back as UI message parts. |
| Models | `src/lib/models.ts` | Gemini 2.5 Flash answers by default, Claude Sonnet 5.5 judges evals and rewrites prompts, Flash-Lite does cheap jobs, `gemini-embedding-001` embeds, Cohere reranks. All through one gateway key. |
| Tracing | `src/server/telemetry.ts` | AI SDK telemetry, sent to Langfuse as OpenTelemetry spans. |
| Langfuse | `langfuse/docker-compose.yml` | The official compose file, with the web UI and MinIO bound to 127.0.0.1 and auto-provisioning added. |
| Database | `db/bootstrap.sql`, `src/db/*`, `drizzle/` | Supabase Postgres, pgvector, Drizzle, and least-privilege roles. |

## How a chat turn is traced

1. The browser sends the whole conversation to `/api/chat` with the chat's `id`.
2. `propagateAttributes({ sessionId: id })` tags everything inside it, so all turns of one chat group into one Langfuse **session**.
3. The agent runs (`agent.stream()`, which uses `streamText` underneath). The AI SDK's telemetry integration emits OpenTelemetry **spans**: one for the call and one per step, with model, prompt, output, token usage and latency.
4. `LangfuseSpanProcessor` batches the spans and sends them to Langfuse. Each request becomes a **trace**, and each model call inside it becomes a **generation**.

Langfuse, Braintrust, LangSmith and Phoenix all use this model: a trace is a tree of spans, LLM calls are spans with token and cost data, and scores attach to traces. Braintrust calls traces "logs", but the idea is the same.

## Models and the gateway

The AI Gateway needs a credit card on file before it serves any request. With a card but no paid credits, it runs on its **free tier**, which excludes Claude: Gemini 2.5 Flash and Flash-Lite, Google's embedding models and Cohere rerank all work. The first phases ran entirely on that.

- **Each role has its own model** in `src/lib/models.ts`. Switching one is a one-line change.
- **The judge is a different, stronger model than the agent** (Claude Sonnet 5.5 judging Gemini Flash), so it doesn't favor its own style. Until paid credits were added it was Gemini Flash judging itself; see phase 5 for what changed.
- **A prompt version can pin its agent model** in its Langfuse config (phase 3), so "v5" means "this text on Sonnet". Versions that don't pin one run on the default agent model.
- **Rate limits.** The free tier allows about 5 requests a minute per model, so batch jobs space their calls (`EVAL_RPM`, default 5) and retry. With credits, `EVAL_RPM=60` makes a full eval run take minutes instead of 20.

## Database roles

The demo gets its own corner of the database, so it can share a Supabase project with other apps:

- `agent_app` is the app's login. It owns the `agent` schema and nothing else, so a bug or a SQL injection in the demo can't touch other schemas. Every table has row-level security on with no policies: `agent_app` owns the tables and bypasses it, and Supabase's `anon` and `authenticated` roles see nothing.
- The password is set with a SCRAM-SHA-256 hash computed locally (`alter role ... password 'SCRAM-SHA-256$...'`), so the plain text never reaches Supabase's logs.
- The app connects through **Supavisor's session pooler** (port 5432). Supabase's direct connection is IPv6-only, and the pooler shares a few Postgres connections between clients. A serverless deploy would use the transaction pooler (port 6543) with `prepare: false`, since prepared statements don't survive connection swaps.
- The agent never writes SQL. Every tool runs a fixed, parameterized query, and the customer id comes from the session, never from the model.

Migrations are generated from `src/db/schema.ts` with `npm run db:generate` and applied with `npm run db:migrate`, which runs Drizzle's migrator in a script. (`drizzle-kit migrate` exits silently on some errors.)

### Migrations fail with `permission denied` (42501)

Some tools install event triggers that run on every `CREATE TABLE`, `ALTER TABLE` or `CREATE INDEX` in the database. Rocicorp Zero, for example, installs triggers that call functions in its `zero_0` schema. `agent_app` isn't allowed to call those, so its migrations fail. List them with `select evtname, evtenabled from pg_event_trigger;`. If they belong to an app that no longer runs, `alter event trigger <name> disable;` turns one off without deleting anything, and `enable` brings it back.

## Running it

```bash
npm install
npm run langfuse:env     # generates langfuse/.env and fills the Langfuse keys in .env.local
npm run langfuse:up      # needs Docker (or OrbStack); first run downloads ~2 GB
npm run dev              # http://localhost:3001
```

Langfuse runs at http://localhost:3000. Sign up there with any email and password; it's a local account, and new users join the `agent-lab` project automatically.

If `npm run langfuse:up` fails with `error getting credentials` on macOS, Docker's Keychain lookup was blocked. Approve the Keychain prompt, or pull once with an empty Docker config: `DOCKER_CONFIG=$(mktemp -d) docker compose -f langfuse/docker-compose.yml pull`.

## Questions this answers

- **How do you see what an agent did on a given request?** Traces: every model and tool call is a span with inputs, outputs, tokens, cost and latency, grouped by session and user.
- **What is OpenTelemetry, and why does it matter here?** It's a vendor-neutral standard for spans. The AI SDK emits spans once, and any backend (Langfuse, Datadog, Honeycomb) can receive them, so switching vendors doesn't change application code.
- **Why a model gateway?** One key and one bill. Switching or A/B-testing models is a string change, and there's a single place for fallbacks and rate limits.
- **Why self-host Langfuse instead of using Braintrust?** It's MIT-licensed, keeps data local, and has the same building blocks. The trade-off is running the infrastructure yourself (Postgres, ClickHouse, Redis, MinIO).
- **How do you secure the database an agent can query?** A least-privilege login that owns only its schema, tools with fixed parameterized queries instead of model-written SQL, identity from the session rather than the model, and, if the agent must write SQL, a read-only role with a statement timeout that can only see views.
