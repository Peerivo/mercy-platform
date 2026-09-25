# Deployment

## Граница облака
Codex готовит SQL → Git/CI воспроизводит clean DB → уполномоченный оператор вручную запускает workflow_dispatch с точным project ref/environment secrets. Container никогда не мигрирует DB. Remote push/reset и production deploy в этой задаче не выполнялись.

## Переменные
Build/app public: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (legacy `...ANON_KEY` fallback), `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_MAP_TILE_URL`, `NEXT_PUBLIC_MAP_ATTRIBUTION`. CI cloud-only: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, input `project_ref`. Не печатать значения. Publishable variables must exist before Next/Docker build.

## Порядок
1. Для integration CI используйте disposable Supabase на GitHub runner по `docs/TESTING.md`; облачный staging для этого job не нужен. Перед операционной приёмкой отдельно создайте staging Supabase и backup policy, настройте Site URL/callback и email confirmation/SMTP.
2. `supabase link --project-ref ...`; inspect diff; `supabase db push` only in protected workflow/environment.
3. Realtime publication is migration-controlled. Execute `select public.bootstrap_first_admin('<verified auth UUID>');` once via trusted SQL connection; function has no API EXECUTE.
4. Build image with public build args, deploy, verify `/health`, Auth and acceptance suite. Configure CSP/egress and tile attribution/provider quota.
5. Back up before migrations. Roll application back by immutable image. Database migrations are forward-only: prepare a reviewed compensating migration; restore only via approved disaster recovery.

ChatGPT environment may run `npm ci && npm run check`; local Supabase requires Docker. Production credentials are never needed for build.

## MVP v1 release verification
Обязательные build args: Supabase URL/publishable key, canonical `NEXT_PUBLIC_SITE_URL` и `GIT_SHA`; repository не содержит application Compose manifest, а production/CI собирают immutable image напрямую из `Dockerfile`. Production Site URL должен быть HTTPS и точно присутствовать в Supabase Auth redirect allow-list вместе с `/auth/callback`. После immutable deploy запрос `GET /health` обязан вернуть `status=ok`, `environment=production`, ожидаемый SHA в `version` и `Cache-Control: no-store`; endpoint не проверяет БД и не выводит конфигурацию.

Перед migration workflow зафиксируйте backup и сопоставьте `supabase_migrations.schema_migrations` с `supabase/migrations`. После migration проверьте `messages` в Realtime publication и RLS, затем выполните documented one-time `bootstrap_first_admin` через trusted SQL (не API). Smoke A и B выполняются отдельными USER/helper/COORDINATOR/ADMIN аккаунтами; отдельно подтвердите отрицательные проверки доступа. Не используйте seed в remote среде.

## REG.RU application cutover
The canonical public website remains `https://mercy.peerivo.net`. The Russian hostname `https://язык-милосердия.рф` is a permanent 308 entry point to that canonical URL, while Supabase remains on Beget at `https://api.mercy.peerivo.net`.

Use the protected workflow `Deploy REG.RU production` in two phases documented in `docs/REG_RU_DEPLOYMENT.md`:

1. `PREPARE` stages the exact approved current-main image on REG.RU and verifies local liveness, bounded data readiness, exact SHA and redirect behavior without changing DNS.
2. After a separately approved DNS cutover, `VERIFY` confirms the exact public revision, data readiness, Russian-host 308 path/query preservation and Beget Auth reachability.

The REG.RU workflow never runs a database migration. The old managed Supabase remains write-frozen during the rollback window, and Vercel remains the application rollback host until the REG.RU cutover is accepted.
