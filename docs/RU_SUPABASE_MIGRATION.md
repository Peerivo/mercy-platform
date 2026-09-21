# Russian Supabase migration runbook

## Scope

This runbook covers the planned migration of Mercy production data from the current managed Supabase project to the self-hosted Supabase instance in Russia on Beget.

The workflow currently implemented in this repository is **preflight-only**. It does not dump user data, restore data, change the Beget database, or cut production traffic over.

## Current topology

- Application production: existing Mercy deployment until the cutover increment is approved.
- Source database: current managed `Mercy-prod` Supabase project.
- Target database: self-hosted Supabase on Beget in Russia.
- Public target API endpoint: `https://api.xn----htbcggcjkhwxk7j6bn.xn--p1ai`.
- Target PostgreSQL and pooler ports must remain bound only to localhost; public access is through HTTPS/Caddy/Kong.

## Required GitHub Environment secrets

The `production` environment must provide:

- `BEGET_SUPABASE_HOST`
- `BEGET_SUPABASE_USER`
- `BEGET_SUPABASE_SSH_KEY`
- `BEGET_SUPABASE_KNOWN_HOSTS`
- `OLD_SUPABASE_DB_URL`

The source DB password must never be printed, committed, uploaded as an artifact, or passed in a process argument. The preflight parses it into a mode-0600 env file and passes it to the temporary Postgres client container through `--env-file`.

## Preflight

Run **Preflight Mercy Supabase migration to Beget** manually.

It must pass all of these checks:

1. Required production secrets exist.
2. The Beget SSH host key matches the pinned `known_hosts` value.
3. The source database is reachable.
4. The Beget `supabase-db` container is reachable.
5. Source and target PostgreSQL versions are reported.
6. The target has no Mercy users and no `public.help_requests` relation.
7. Required extensions used by Mercy are present on the target.
8. No source data dump is created.
9. No target database mutation occurs.

A successful preflight is evidence only; it is not authorization to migrate.

## Cutover prerequisites for the future apply increment

The destructive migration workflow must be implemented and reviewed separately. Before it can run:

1. Put the old Mercy production into an explicit maintenance/write-freeze state so no new requests, messages, moderation actions, feedback, auth writes relevant to the application, or other mutable Mercy records can be created during the final dump and cutover.
2. Confirm the freeze from outside the application with a smoke check that write paths are unavailable.
3. Re-run source verification immediately after the freeze.
4. Take and retain a safety backup of the fresh Beget target.
5. Dump roles, schema and data using the Supabase-supported filtered procedure.
6. Do not send production database dumps to GitHub Artifacts.
7. Restore fail-closed in a transaction where supported and abort on the first SQL error.
8. Verify all material tables, users, RLS policies, grants, Realtime publication state, and critical row counts, not only a small subset.
9. Restart and verify every affected service: Auth, REST/PostgREST, Realtime, Storage and Kong. A process merely starting is insufficient; health/readiness must pass.
10. Switch the application only after database verification succeeds.
11. Run production smoke tests against the Russian endpoint.
12. Keep the source frozen until the Russian deployment is verified.
13. On any failed verification, restore Beget from the safety backup and route the application back to the old production before reopening writes.

## Rollback

A future apply workflow must retain:

- target globals backup;
- target PostgreSQL backup;
- the exact source revision / dump evidence used for cutover;
- application image SHA and environment revision used for the Russian deployment.

Rollback is complete only when the previous production endpoint is serving, required write paths work again, and the Russian target is no longer receiving production traffic.

## Post-cutover

After a successful cutover:

- keep the old source read-only for a defined rollback window;
- verify Auth redirect URLs, SMTP/email login, RLS, Realtime chat and public request reads;
- rotate any migration-only credentials;
- remove temporary migration files from both runner and destination;
- record the migration result and evidence in the deployment history.
