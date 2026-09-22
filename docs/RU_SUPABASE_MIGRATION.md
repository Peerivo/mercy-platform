# Russian Supabase migration runbook

## Scope

This runbook covers the planned migration of Mercy production data from the current managed Supabase project to the self-hosted Supabase instance in Russia on Beget.

The repository contains both a read-only preflight and a separately guarded destructive cutover workflow. The cutover is manual, requires `MIGRATE`, and leaves the old source write-frozen after success until the Russian application is verified.

## Current topology

- Application production: existing Mercy deployment until the cutover increment is approved.
- Source database: current managed `Mercy-prod` Supabase project.
- Target database: self-hosted Supabase on Beget in Russia.
- Public target API endpoint: `https://api.xn----htbcggcjkhwxk7j6bn.xn--p1ai`. The cutover workflow uses this canonical public URL directly; it is not a secret.
- Target PostgreSQL and pooler ports must remain bound only to localhost; public access is through HTTPS/Caddy/Kong.

## Required GitHub Environment configuration

The `production` environment must provide:

Environment Variables (preferred; non-sensitive):

- `BEGET_SUPABASE_HOST`
- `BEGET_SUPABASE_USER`

Environment Secrets:

- `BEGET_SUPABASE_SSH_KEY`
- `BEGET_SUPABASE_KNOWN_HOSTS`
- `OLD_SUPABASE_DB_URL`

For compatibility, the workflow also accepts `BEGET_SUPABASE_HOST` and `BEGET_SUPABASE_USER` as Secrets if Variables are not set.

The source DB password must never be printed, committed, uploaded as an artifact, or passed in a process argument. The preflight parses it into a mode-0600 env file and passes it to the temporary Postgres client container through `--env-file`.

## Preflight

Run **Preflight Mercy Supabase migration to Beget** manually.

It must pass all of these checks:

1. Required production secrets exist.
2. The Beget SSH host key matches the pinned `known_hosts` value.
3. The source database is reachable.
4. The Beget `supabase-db` container is reachable.
5. Source and target PostgreSQL versions are reported.
6. The target has no Mercy users, no `public.help_requests` relation, and zero pre-existing Storage buckets/objects.
7. Required extensions used by Mercy are available on the target via `pg_available_extensions`. They need not already be installed in the fresh database when the canonical Mercy migration installs them; specifically, `202609120001_initial.sql` installs PostGIS into schema `extensions`.
8. No source data dump is created.
9. No target database mutation occurs.

A successful preflight is evidence only; it is not authorization to migrate.

## Cutover workflow

Run **Cut over Mercy Supabase to Beget** only after the preflight succeeds. The workflow performs these gates and actions:

1. Put the old Mercy production into an explicit maintenance/write-freeze state so no new requests, messages, moderation actions, feedback, auth writes relevant to the application, or other mutable Mercy records can be created during the final dump and cutover.
2. Confirm the freeze from outside the application with a smoke check that write paths are unavailable.
3. Re-run source verification immediately after the freeze.
4. Take and retain a safety backup of the fresh Beget target.
5. Verify source migration history exactly matches the repository and `auth.users`/`auth.identities` column layouts match Beget.
6. Refuse to continue if the source Storage is non-empty, MFA/SSO/non-email identities are present, or the Beget target already contains any Storage bucket/object before mutation.
7. Freeze all `public` table writes and Auth user/identity writes on the old source using temporary DB triggers inside one transaction. Stream the SQL to containerized `psql` with Docker stdin attached (`-i`), arm cleanup before execution, then verify the exact expected relation set has the trigger and report any missing relation. The failure trap removes these triggers automatically.
8. Apply the canonical SQL migrations from `supabase/migrations`, normalize the historical `qualification-documents` Storage bucket to the verified source profile (currently zero buckets/objects). Because self-hosted Storage installs a delete-protection trigger, temporarily set `session_replication_role = replica` only around deletion of this known empty historical bucket inside the same bootstrap transaction, restore `origin` immediately, then restore `auth.users`, `auth.identities` and `public` data and record migration history in that target PostgreSQL transaction. Remote loop variables must be evaluated on Beget via `ssh ... bash -s`/quoted heredoc, never interpolated by the GitHub runner. Data import runs with `session_replication_role = replica` inside that transaction.
9. Do not send production database dumps to GitHub Artifacts; temporary dumps live only on the runner and Beget work directory and are removed after the run.
10. Compare deterministic row fingerprints for every public table plus Auth users/identities, require the target Storage bucket/object counts to match the verified empty source profile, compare public RLS policy fingerprint, and compare Realtime publication membership.
11. Restart and verify every affected service (`auth`, `rest`, `realtime`, `storage`, `kong`) by Docker Compose labels rather than hard-coded container names or `cd` into the root-owned compose directory, then smoke Auth and a public RPC through the Russian API endpoint.
12. Switch the application only after database verification succeeds.
13. Keep the source frozen until the Russian deployment is verified.
14. On any failed migration verification after target mutation, the workflow first recreates the Beget `postgres` database from the retained safety backup, preserving archived owners/ACLs and verifying `supabase_auth_admin` / `supabase_storage_admin` access, then unfreezes the old source. The safety backup remains retained as evidence.

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

### Recovery after a failed post-apply run

If a cutover fails after the Beget schema/data transaction has committed, the source is unfrozen and the target must not be reused implicitly. New runs normally restore their own current safety backup automatically on such failures. For a failure produced by an older cutover implementation that did not roll the target back, rerun the guarded workflow with `MIGRATE` and set `recover_from_run_id` to the exact failed GitHub Actions run ID. The script restores only `beget-pre-migration-backups/before-<run-id>-postgres.dump`, stops non-DB containers belonging to the same Docker Compose project using full, untruncated Docker container IDs so `supabase-db` is excluded reliably,, recreates the `postgres` database so post-backup Mercy objects/extensions cannot survive, restores the archive with ownership and ACL entries intact, verifies Auth/Storage service-role access and the fresh target profile (`0 users`, no `public.help_requests`, `0 buckets`, `0 objects`), then takes a new safety backup and proceeds with the normal cutover. A missing, empty, nonnumeric, or non-fresh recovery backup fails closed before source freeze.


The CI disposable Supabase job also exercises the recovery strategy against a real PostgreSQL database: it takes a custom-format baseline dump with non-default owner/ACL, creates a post-backup object, recreates the database, restores the dump, and verifies that the extra object is gone while ownership and grants survive.
