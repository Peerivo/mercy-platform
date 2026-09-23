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

Its deployment branch policy must allow only the protected `main` branch. This is a required gate: an older workflow ref must never receive production credentials. The current workflow also rejects non-main GitHub Actions refs before SSH access.

Environment Variables (preferred; non-sensitive):

- `BEGET_SUPABASE_HOST`
- `BEGET_SUPABASE_USER`
- `BEGET_JWT_ROTATION_ATTESTATION` (set only after the run #8 signing-secret incident is fully remediated; value `rotated-and-verified-after-run-8`)

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
4. Take and retain a safety backup of the fresh Beget target using a custom-format `pg_dump -Fc`, globals backup, and a server-side fingerprint of database owner/ACL/settings; the archive must contain database creation metadata and is considered restorable only after the server writes its `prepared` state marker and metadata fingerprint.
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

If a future cutover fails after the target transaction commits, the source is unfrozen and a fresh cutover is blocked. Select `RECOVER` with that future failed run ID. GitHub Actions verifies a failed/interrupted main-branch cutover; a successful-cutover marker blocks recovery. The script verifies the complete archive can be decoded before dropping the database, recreates `postgres`, and uses `pg_restore --create` to restore database settings/ACL, object ownership/ACL and data from the safety archive itself. New backups require a `prepared` marker and database metadata fingerprint. Recovery checks the restored metadata fingerprint, fresh profile (`0 users`, no `public.help_requests`, `0 buckets`, `0 objects`), and Auth/REST/Storage database-role access; it ends without freezing source or applying migrations. A later `MIGRATE` requires a separate fresh approval. Missing, truncated, unverified, or non-fresh backups fail closed, and retained backups remain intact. The retained legacy backup `35770879007` was restored successfully once and is now permanently quarantined from both modes; do not retry it even if the attestation variable is absent.

Historical incident, superseded by successful recovery run `35837560999` and preflight `35837818721`: failed recovery runs #8 and #9 left Beget partially recreated; source was never frozen by `RECOVER`. Run #8 emitted a JWT setting value through `pg_restore` diagnostics. Subsequent reviewed code suppressed raw SQL, used the verified local `supabase_admin` superuser for archived custom GUCs, classified restore errors without values, and used archive evidence rather than the partially restored target as the legacy baseline. Retained run #7 safety files remain; the current fresh state is documented below. Do not initiate another recovery solely because of these historical failures.

The CI disposable Supabase job exercises a custom-format backup without `pg_dump --create` against a real PostgreSQL database. It verifies `pg_restore --create` under the verified Supabase superuser restores database owner/ACL/settings, including a harmless custom GUC, removes post-backup Mercy/Auth/Storage mutations and preserves role-level Auth/REST/Storage access and the `PUBLIC CONNECT` denial.

### Recovery-only workflow

Select `RECOVER` and the exact failed/interrupted run ID to restore the retained target safety backup. This mode finishes after the fresh-target and service-role checks. It neither freezes Mercy-prod nor applies migrations or starts `MIGRATE`. Confirm source remains unfrozen and rerun the read-only preflight, including users, Mercy relation marker, Storage buckets, and Storage objects. A later cutover requires a separate fresh `MIGRATE` approval. Keep retained backups until a complete successful cutover. Rerunning the same GitHub Actions run ID refuses to overwrite any retained safety-backup file; start a new reviewed run instead.

### Archive index diagnostic after run #10

Run #10 reported `missing_object` at TOC `4300` twice while preserving the retained backup and leaving the source unfrozen. The protected read-only `Inspect retained Beget safety archive` workflow inspected failed cutover run `35770879007` and TOC `4300`. It verifies the run identity, reads one `pg_restore -l` index line without SQL/parameter values, and does not drop or restore a database. Run `35832828340` identified the missing GraphQL wrapper; at that point the Beget target was unverified. The reviewed fix and disposable integration preceded the successful recovery.

The first read-only inspection, run `35829539729`, found `4300; 0 0 ACL graphql_public FUNCTION graphql("operationName" text, query text, variables jsonb, extensions jsonb) supabase_admin`. This is archive index metadata; it does not show whether the function, schema, extension, or a grant dependency is missing. Run `35832828340` used `GRAPHQL_CONTEXT` to report bounded related TOC metadata and boolean target `pg_catalog` flags. Both diagnostic modes omit SQL and database setting values; the reviewed fix passed disposable integration before the successful recovery.

Read-only run `35832828340` показал: архив содержит `SCHEMA graphql_public`, `EXTENSION pg_graphql`, ACL `graphql_public.graphql(...)`, но не содержит `FUNCTION` definition; на Beget флаги `t|f|t|t` (схема есть, wrapper отсутствует, расширение установлено и доступно). Это объясняет `missing_object toc=4300`: ACL применяется к отсутствующей функции. Исправленный recovery переносит только этот ACL в конец replay, восстанавливает весь остальной архив с owners/grants, при отсутствии функции создаёт официальный Supabase wrapper через `graphql.resolve`, затем применяет сохранённый ACL и проверяет owner, архивные grants функции и вызов от `supabase_admin` без расширения schema ACL. CI воспроизводит extension-member архив, в котором pg_dump оставляет ACL без определения функции. Временный `push` trigger удалён; до успешного `RECOVER` и read-only preflight Beget оставался непроверенным.

При split TOC `pg_restore --use-list` не применяет database-level ACL из `--create` metadata. Recovery отдельно извлекает только архивные `GRANT/REVOKE ON DATABASE postgres` и применяет их без логирования SQL. Disposable тест требует восстановить запрет `PUBLIC CONNECT`: посторонняя роль не может подключиться после replay.

Recovery run `35836636954` остановился на дополнительном вызове GraphQL от `anon`: в архивном baseline нет `USAGE` на `graphql_public` для этой роли. Не расширять права ради диагностики; сохранять ACL из архива, проверять owner/function grants и выполнять GraphQL probe от `supabase_admin`. Auth/REST/Storage права проверяются отдельно. Source не замораживался, на тот момент Beget ещё не был доказан fresh.

### Подтверждённое состояние после recovery (2026-09-23 08:34 UTC)

`RECOVER` run `35837560999` восстановил retained backup run `35770879007` и прошёл встроенные проверки fresh target, DB ролей и сервисов без freeze source и без `MIGRATE`. Независимый read-only preflight `35837818721` прошёл: Beget `auth.users=0`, `public.help_requests` отсутствует, Storage buckets/objects `0/0`. Отдельный запрос к Mercy-prod подтвердил 8 пользователей, 0 freeze triggers и отсутствие `mercy_migration`. Safety backup не удалён. Global Review был `SKIPPED` по действующему ограниченному исключению, Threat Radar остаётся active.

**Security gate:** в логах старого recovery run #8 оказалось значение `app.settings.jwt_secret`. Удаление или ограничение доступа к логу само по себе не закрывает инцидент. Сначала сменить signing secret Beget, заново выпустить и согласованно развернуть зависимые anon/service keys во всех Beget сервисах и конфигурации GitHub, перезапустить сервисы, проверить отказ старых токенов и работу Auth/REST/Storage с новыми ключами, затем закрыть доступ к старому логу и зафиксировать evidence без значений секретов. Только после этого уполномоченный владелец устанавливает защищённую переменную production Environment `BEGET_JWT_ROTATION_ATTESTATION=rotated-and-verified-after-run-8`. Workflow и скрипт без неё блокируют `MIGRATE` до любого SSH или source freeze. `RECOVER` и `MIGRATE` с доротационным архивом run `35770879007` запрещены постоянно, независимо от переменной: safety backup сохранён как evidence, но не может вновь включить скомпрометированный secret. Аттестация устранения инцидента ещё не подтверждена, поэтому свежий approval на `MIGRATE` небезопасен; выполнение всё равно требует отдельного нового явного разрешения. DNS и приложение REG.RU в рамках recovery не изменялись.

### Если после ротации получено `DB_JWT_STALE`

Не выполнять `ALTER DATABASE` вручную на Beget. Сначала доставить и смержить reviewed workflow `Repair Beget JWT database setting`. Затем, только по свежему разрешению на эту конкретную production-операцию, запустить его из `main` с точным подтверждением `REPAIR_JWT_DB_SETTING`. Workflow использует уже запущенные контейнеры как источник фактического нового signing secret: сравнивает `GOTRUE_JWT_SECRET` Auth и `PGRST_JWT_SECRET` REST, при наличии того же параметра у Storage также требует совпадение. Значение не передаётся через GitHub input/secret и не печатается. Для PostgreSQL оно поступает через stdin во внутреннюю shell-сессию контейнера; `PGOPTIONS` задаёт session value, а SQL выполняет только `ALTER DATABASE postgres SET "app.settings.jwt_secret" FROM CURRENT`. Затем новый `psql` connection должен вернуть значение, равное runtime secret, без вывода самого секрета. Любое несоответствие — fail closed.

После успешного workflow заново выполнить внешнюю проверку: новый Auth/REST/Storage — 2xx, старый anon JWT — не 2xx, локальная проверка — `DB_JWT_OK`. Лишь затем обновлять `NEXT_PUBLIC_SUPABASE_ANON_KEY`, удалять/ограничивать старый лог и ставить `BEGET_JWT_ROTATION_ATTESTATION`.


### Run 13: incomplete target fingerprint caused by SSH stdin consumption

Production MIGRATE run `35899437604` passed compatibility gates, created a target safety backup, froze all 17 expected source relations, dumped the frozen source and applied the canonical Mercy schema/data to Beget. Verification then reported a target fingerprint containing only `public.audit_events`, `auth.users` and `auth.identities`, while the frozen source fingerprint contained all public relations. The migration was not accepted; cleanup restored the Beget safety backup and unfroze the managed source. A separate read-only source query after the run confirmed `auth.users=8`, `volunteer_offers=1`, zero migration freeze triggers and no `mercy_migration` schema.

The defect was in the verification transport, not established as data loss: the target loop used `ssh` while its own stdin carried the process-substitution list of public table names. The first SSH process could consume the remaining list, so only the first public table was probed. All SSH calls in `fingerprint_target` now use `ssh -n`, binding SSH stdin away from the loop. CI asserts this. Do not retry MIGRATE until this fix is merged, a new read-only preflight proves the Beget target fresh again, and a fresh one-run production approval is granted.
