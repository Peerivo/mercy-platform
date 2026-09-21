# Agent rules

Read `PROJECT.md` before changing code. Keep it current and separate implemented behavior from plans.

## Global Contract

Before any task, read `.peerivo/global-contract.json` and resolve the pinned canonical contract in `Peerivo/global`. Compute the effective `Global -> Project -> Agent -> Task/Run` contract before effectful work. Local rules may tighten inherited restrictions but may not silently weaken them. If the binding is missing or stale in a way that changes authority, permissions, or safety, fail closed until adoption is reviewed and acknowledged.

- TypeScript is strict; validate untrusted input with Zod. Never trust client user IDs, roles, or assignment fields.
- Use user JWTs for normal data access. Never expose service-role keys, database URLs, private content, or visitor coordinates in logs.
- Schema changes are append-only SQL migrations under `supabase/migrations`; never edit an applied migration or push/reset a remote project from this workspace.
- Every API table must have RLS, least-privilege grants, bounded text and pagination. Privileged RPCs fix `search_path` and restrict execute grants.
- Tests must exercise behavior and access boundaries. Run lint, typecheck, tests, build, and migration tests where supported.
- Update relevant docs, `PROJECT.md`, and `docs/ACCEPTANCE.md` with every behavior change.

## Delivery workflow

- One task includes implementation, verification of UI → server action → RPC/RLS, correction of all discovered causes in one coordinated pass, one pull request, and its normal merge.
- Start each task from an updated `main`/`master`; if it advanced, preserve its changes and verify ancestry. Do not continue obsolete pull requests or feature branches.
- Do not create dependent pull-request chains between development branches. Pull requests target the primary branch directly.
- A red CI result alone does not prohibit an MVP merge when the failure is non-blocking or infrastructural, but record the exact cause, impact, and debt; never claim it passed.
- Fix or remove any new capability that breaks the primary scenario, loses data, or exposes another person's case. Never bypass required GitHub checks or branch protection.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
