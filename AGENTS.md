# Agent rules

Read `PROJECT.md` before changing code. Keep it current and separate implemented behavior from plans.

- TypeScript is strict; validate untrusted input with Zod. Never trust client user IDs, roles, or assignment fields.
- Use user JWTs for normal data access. Never expose service-role keys, database URLs, private content, or visitor coordinates in logs.
- Schema changes are append-only SQL migrations under `supabase/migrations`; never edit an applied migration or push/reset a remote project from this workspace.
- Every API table must have RLS, least-privilege grants, bounded text and pagination. Privileged RPCs fix `search_path` and restrict execute grants.
- Tests must exercise behavior and access boundaries. Run lint, typecheck, tests, build, and migration tests where supported.
- Update relevant docs, `PROJECT.md`, and `docs/ACCEPTANCE.md` with every behavior change.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
