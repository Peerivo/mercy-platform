# Deployment

## Граница облака
Codex готовит SQL → Git/CI воспроизводит clean DB → уполномоченный оператор вручную запускает workflow_dispatch с точным project ref/environment secrets. Container никогда не мигрирует DB. Remote push/reset и production deploy в этой задаче не выполнялись.

## Переменные
Build/app public: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (legacy `...ANON_KEY` fallback), `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_MAP_TILE_URL`, `NEXT_PUBLIC_MAP_ATTRIBUTION`. CI cloud-only: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, input `project_ref`. Не печатать значения. Publishable variables must exist before Next/Docker build.

## Порядок
1. Create staging Supabase and backup policy; configure Site URL/callback, email confirmation/SMTP.
2. `supabase link --project-ref ...`; inspect diff; `supabase db push` only in protected workflow/environment.
3. Realtime publication is migration-controlled. Execute `select public.bootstrap_first_admin('<verified auth UUID>');` once via trusted SQL connection; function has no API EXECUTE.
4. Build image with public build args, deploy, verify `/health`, Auth and acceptance suite. Configure CSP/egress and tile attribution/provider quota.
5. Back up before migrations. Roll application back by immutable image. Database migrations are forward-only: prepare a reviewed compensating migration; restore only via approved disaster recovery.

ChatGPT environment may run `npm ci && npm run check`; local Supabase requires Docker. Production credentials are never needed for build.
