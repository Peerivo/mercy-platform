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
3. uses pinned Beget SSH to discover the unique Mercy GoTrue container/address and select exactly one distinct accepted live service-role candidate through direct `/admin/users`; unreachable/incomplete responses and ambiguous discovery/selection fail closed without key output;
4. validates the configured public Supabase key against Beget before REG.RU SSH;
5. builds one immutable application image;
6. uploads the image and candidate runtime environment to REG.RU;
7. creates/reuses the dedicated `mercy-reg-ru` Docker bridge at MTU 1400, then arms rollback before removing any existing REG.RU application container;
8. starts the candidate on loopback `127.0.0.1:3100`;
9. requires Docker health, bounded local `/health`, bounded local `/health/data`, exact Git SHA, the local host-based 308 redirect contract, canonical callback redirect and Peerivo PKCE start;
10. independently requires Admin=200 and Public=200 from the candidate through the canonical public Beget API, then promotes the environment only after every gate passes;
11. keeps only the current and one rollback image, with the previous runtime environment.

The direct preflight avoids Beget's same-origin public hairpin; it is only credential-selection evidence. Executable synthetic fixtures cover deduplication, selection, unreachable/rejected/partial-response failures and ambiguous containers, addresses or keys. Production acceptance still requires the independent REG.RU public-path gates and a real-account browser login, cabinet return, reload and logout. Never use fixture/Preview success as live production evidence.

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

GitHub encrypted Secrets are the canonical source for new secrets under current Global policy. Existing legacy secrets remain in place until a separately authorized migration. The protected production Environment is the execution surface; this release creates or rotates no credentials.

Required:

- `REG_RU_HOST` (Variable preferred; Secret fallback supported);
- `REG_RU_USER` (Variable preferred; Secret fallback supported);
- `REG_RU_SSH_KEY` (Secret);
- `REG_RU_KNOWN_HOSTS` (Variable, pre-verified out of band);
- `BEGET_SUPABASE_HOST`, `BEGET_SUPABASE_USER`, `BEGET_SUPABASE_KNOWN_HOSTS` and existing `BEGET_SUPABASE_SSH_KEY` (Secret) for the live preflight;
- `NEXT_PUBLIC_SUPABASE_URL=https://api.mercy.peerivo.net` (Variable preferred);
- one of `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Variable; these are client-visible);
- the existing Peerivo Auth URL/client/redirect configuration and `PEERIVO_AUTH_LOCAL_PASSWORD_SECRET` (Secret);
- `RESEND_API_KEY` (Secret);
- `RESEND_FROM_EMAIL`;
- `FEEDBACK_TO_EMAIL`.

Do not paste secret values into chat, PRs, issues, screenshots, or logs.

## REG.RU host prerequisites

The REG.RU host must provide Docker, gzip, curl and SSH access for the pinned deployment identity. The private deployment directory is `/opt/peerivo/mercy`.

The application binds only to `127.0.0.1:3100`. The REG.RU reverse proxy is responsible for public HTTPS on ports 80/443 and for preserving the request Host header.

REG.RU's public interface is MTU 1450 while Docker's default `docker0` bridge is MTU 1500. This was proven to black-hole larger TLS packets from the Beget API: host networking succeeded while the default bridge timed out, and a temporary MTU-1400 bridge succeeded. PREPARE therefore creates/reuses a dedicated `mercy-reg-ru` bridge with MTU 1400 and fails closed if an existing network with that name has a different MTU. It does not modify `docker0`, Docker daemon configuration, firewalld, or host interface MTU.

## Rollback

Before DNS cutover, a failed PREPARE automatically restores the previous REG.RU application image/environment when one exists.

After DNS cutover, the fastest application rollback is to repoint `mercy.peerivo.net` to the still-retained Vercel production deployment, then investigate REG.RU. Do not unfreeze or roll back the old managed Supabase merely because an application-host cutover failed.

A database rollback, source unfreeze, migration, secret rotation or DNS mutation is outside PREPARE/VERIFY authority.


### Complete, same-origin public Auth acceptance
The candidate's external Admin/Public probes now reject redirects before any credential can be forwarded to another endpoint. Success requires complete JSON bodies within the existing 10-second abort windows, an Admin `users` array and a public-settings `external` object, then HTTP 200 for both. Truncated/stalled bodies, maintenance HTML and unexpected JSON shapes fail closed while rollback remains armed. Executable tests run the exact candidate Node probe against real loopback HTTP servers, including an independent redirect sink which must receive zero requests/credentials. Baseline `88f48d1` fails all ten rejection cases; this is production-gate regression evidence, not a claim of successful live sign-in.
