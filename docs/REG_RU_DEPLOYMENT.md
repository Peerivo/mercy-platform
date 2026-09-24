# Mercy application cutover to REG.RU

This runbook covers the Next.js application container only. Supabase is already hosted separately on Beget and is reached through the canonical API hostname `https://api.mercy.peerivo.net`. Database migrations are never performed by this deployment workflow.

## Final topology

- canonical website: `https://mercy.peerivo.net`;
- Russian convenience hostname: `https://язык-милосердия.рф` (and optional `www`) permanently redirects to the canonical website;
- Supabase API: `https://api.mercy.peerivo.net` on Beget;
- REG.RU hosts only the application/reverse-proxy layer;
- Vercel remains the rollback application host until the REG.RU rollback window closes;
- the old managed Supabase source remains write-frozen during the rollback window.

The Russian hostname must never become a separately indexable copy of the site.

## Workflow operations

The protected GitHub Actions workflow **Deploy REG.RU production** has two explicit operations.

### PREPARE

PREPARE stages the exact current reviewed `main` SHA on the REG.RU host while public DNS may still point `mercy.peerivo.net` at Vercel.

The operator supplies:

- `operation=PREPARE`;
- `expected_sha=<exact 40-character reviewed main SHA>`;
- `confirm=PREPARE`.

The workflow:

1. proves the dispatch SHA is still live `main`;
2. validates protected configuration and that `NEXT_PUBLIC_SUPABASE_URL` is exactly `https://api.mercy.peerivo.net`;
3. validates the configured public Supabase key against Beget before any SSH;
4. builds one immutable application image;
5. uploads the image and candidate runtime environment to REG.RU;
6. arms rollback before removing any existing REG.RU application container;
7. starts the candidate on loopback `127.0.0.1:3100`;
8. requires Docker health, bounded local `/health`, bounded local `/health/data`, exact Git SHA, and the local host-based 308 redirect contract;
9. promotes the candidate environment only after all local gates pass;
10. keeps only the current and one rollback image.

PREPARE does **not** change DNS and therefore does not move public traffic.

### DNS cutover

Only after PREPARE succeeds:

1. REG.RU reverse proxy/TLS must forward `mercy.peerivo.net` to `127.0.0.1:3100`;
2. the Russian hostname must reach the same application (the app itself returns HTTP 308 to `mercy.peerivo.net`);
3. change public DNS for `mercy.peerivo.net` from Vercel to the REG.RU host;
4. point `язык-милосердия.рф` (and `www`, if used) to the REG.RU host too;
5. do not change `api.mercy.peerivo.net`; it remains on Beget.

DNS mutation is intentionally outside the deployment workflow and requires its own production authorization.

### VERIFY

After DNS has converged, run:

- `operation=VERIFY`;
- the same `expected_sha`;
- `confirm=VERIFY`.

VERIFY is read-only. It requires:

- `https://mercy.peerivo.net/health` = production + exact SHA;
- `https://mercy.peerivo.net/health/data` = `{"status":"ok"}`;
- `https://язык-милосердия.рф/requests?cutover_probe=1` = HTTP 308 with the exact canonical path/query;
- `https://api.mercy.peerivo.net/auth/v1/health` succeeds with the configured public key.

## Protected configuration

Infisical remains the canonical secret source. GitHub production Environment is a downstream execution surface.

Required:

- `REG_RU_HOST` (Variable preferred; Secret fallback supported);
- `REG_RU_USER` (Variable preferred; Secret fallback supported);
- `REG_RU_SSH_KEY` (Secret);
- `REG_RU_KNOWN_HOSTS` (Variable, pre-verified out of band);
- `NEXT_PUBLIC_SUPABASE_URL=https://api.mercy.peerivo.net` (Variable preferred);
- one of `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Variable; these are client-visible);
- `RESEND_API_KEY` (Secret);
- `RESEND_FROM_EMAIL`;
- `FEEDBACK_TO_EMAIL`.

Do not paste secret values into chat, PRs, issues, screenshots, or logs.

## REG.RU host prerequisites

The REG.RU host must provide Docker, gzip, curl and SSH access for the pinned deployment identity. The private deployment directory is `/opt/peerivo/mercy`.

The application binds only to `127.0.0.1:3100`. The REG.RU reverse proxy is responsible for public HTTPS on ports 80/443 and for preserving the request Host header.

## Rollback

Before DNS cutover, a failed PREPARE automatically restores the previous REG.RU application image/environment when one exists.

After DNS cutover, the fastest application rollback is to repoint `mercy.peerivo.net` to the still-retained Vercel production deployment, then investigate REG.RU. Do not unfreeze or roll back the old managed Supabase merely because an application-host cutover failed.

A database rollback, source unfreeze, migration, secret rotation or DNS mutation is outside PREPARE/VERIFY authority.
