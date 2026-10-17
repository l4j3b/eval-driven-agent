-- One-time setup, run as `postgres` (Supabase SQL editor or MCP), before `npm run db:migrate`.
-- Everything after this is owned by agent_app and lives in Drizzle migrations.

-- pgvector, in Supabase's extensions schema.
create extension if not exists vector with schema extensions;

-- The app's own login. It owns the `agent` schema (created by the first migration)
-- and can't see anything else in the project.
-- The password is set separately with a SCRAM hash, so the plain text never leaves your machine:
--   alter role agent_app with password 'SCRAM-SHA-256$4096:...';
create role agent_app login;
alter role agent_app set search_path = agent, extensions;
grant create on database postgres to agent_app;
grant usage on schema extensions to agent_app;

-- Read-only role for the text-to-SQL tool. It can't log in: the app switches to it
-- with `set local role agent_readonly` inside a transaction, and grants are per view.
create role agent_readonly nologin;
grant agent_readonly to agent_app;
