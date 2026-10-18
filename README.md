# Agent Lab

A demo agent for Mise, a fictional meal-kit company. It answers questions about recipes, cooking and customer accounts, and it's built to show every piece of a production LLM system: embeddings and hybrid search, RAG, database tools, prompt engineering, tracing, evals, and a self-improving loop gated by evals.

Stack: TanStack Start, shadcn and ai-elements, Tailwind, AI SDK 7 through the Vercel AI Gateway (free-tier Gemini models for now), Supabase Postgres with pgvector and Drizzle, and self-hosted Langfuse.

## Running it

```bash
cp .env.example .env.local   # then fill it in
npm install
npm run langfuse:up          # Langfuse at http://localhost:3000
npm run db:migrate           # after running db/bootstrap.sql once
npm run db:seed              # loads data/*.json (regenerate with npm run data:generate)
npm run index                # chunks, contextualizes and embeds for search
npm run prompt:push          # uploads the system prompt to Langfuse
npm run dev                  # app at http://localhost:3001
```

## Phases

Each phase ends with something runnable and a short write-up in `docs/`.

| Phase | What it adds | Status |
| --- | --- | --- |
| 0 · [Setup](docs/00-setup.md) | Chat UI, AI Gateway, Langfuse tracing, database roles | Done |
| 1 · [Data](docs/01-data.md) | Dummy recipes, articles, customers and orders; saved chats and a sidebar; a Data page | Done |
| 2 · [Retrieval](docs/02-retrieval.md) | Chunking, contextual retrieval, embeddings; vector, keyword and hybrid search with rerank; a `/search` playground | Done |
| 3 · [Agent](docs/03-agent.md) | System prompt in Langfuse, tools, citations, approval for write tools, simulated sign-in | Done |
| 4 · Feedback | Thumbs up/down as Langfuse scores; failing traces become dataset items | |
| 5 · Evals | Datasets, deterministic and LLM-judge scorers, experiments | |
| 6 · Self-improvement | An optimizer proposes prompts; an eval gate promotes or rejects them | |
| 7 · Stretch | Guardrails, memory, model routing, caching, MCP | |
