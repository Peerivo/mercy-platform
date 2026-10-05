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

PREPARE stages the exact current reviewed `main` SHA. Read-only DNS/HTTPS verification on 2026-10-05 confirmed `mercy.peerivo.net` already reaches REG.RU at `95.163.223.68` through nginx, so final promotion changes the live application version. The candidate is first tested on loopback 3101 while the original container continues serving 3100.

The operator supplies:

- `operation=PREPARE`;
- `expected_sha=<exact 40-character reviewed main SHA>`;
- `confirm=PREPARE`.

The workflow:

1. proves the dispatch SHA is still live `main` and validates protected canonical configuration;
2. resolves the unique accepted existing service-role candidate directly against GoTrue on Beget;
3. tests the configured public key against the exact public PostgREST RPC, with bounded complete-body, JSON and redirect checks;
4. builds the immutable image and tests its real `/health/data` on the runner before any upload;
5. uploads the image, protected next env, deployment script and non-secret data-probe script over pinned SSH;
6. starts a release-specific candidate on the existing MTU-1400 network and loopback 3101, leaving production untouched;
7. requires Docker/app/data health, exact revision, complete same-origin Admin/Public 200, canonical callback, PKCE start and Russian-host redirect;
8. only after every staging gate passes, saves the old env, stops and retains the original container under a release-specific rollback name, starts production on 3100 and repeats every gate;
9. promotes env/image metadata only after the production-port gates pass, removes the temporary candidate and retains the original stopped rollback container plus old env/image.

A failed staging probe removes only this release's labelled candidate. A failure after production switching restores the same original container and previous env; unknown restoration is reported explicitly. Existing release-specific candidate/rollback names fail closed rather than being overwritten. Historical retained rollback containers are not silently deleted.

The public RPC diagnostic never prints rows, credentials or raw errors. It reports fixed status/error categories, elapsed time and fingerprints only for validated public anon/publishable keys. A route failure additionally runs the equivalent runtime-env probe: runtime success with route failure suggests compiled config, while HTTP/error categories distinguish authorization from transport without guessing.

PREPARE does **not** change DNS. Since canonical traffic already reaches REG.RU, treat promotion as a live application deployment. Vercel deployment records alone never establish the REG.RU version.

### Current routing and historical cutover

The canonical hostname already resolves to REG.RU; no new DNS cutover is required for this release. The reverse proxy/TLS forwards `mercy.peerivo.net` to loopback 3100; the private staging port 3101 must not be exposed. The Russian hostname should reach the same application and return its canonical 308 redirect. `api.mercy.peerivo.net` stays on Beget.

The earlier Vercel-to-REG.RU DNS cutover procedure is historical. Any future routing change or DNS rollback remains outside PREPARE/VERIFY and requires its own scoped authorization.

### VERIFY

After the target revision is promoted and public routing is independently verified, run:

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

Production binds only to `127.0.0.1:3100`; the isolated staging candidate uses `127.0.0.1:3101`. The REG.RU reverse proxy is responsible for public HTTPS on ports 80/443 and for preserving the request Host header.

REG.RU's public interface is MTU 1450 while Docker's default `docker0` bridge is MTU 1500. This was proven to black-hole larger TLS packets from the Beget API: host networking succeeded while the default bridge timed out, and a temporary MTU-1400 bridge succeeded. PREPARE therefore creates/reuses a dedicated `mercy-reg-ru` bridge with MTU 1400 and fails closed if an existing network with that name has a different MTU. It does not modify `docker0`, Docker daemon configuration, firewalld, or host interface MTU.

## Rollback

A failed staging gate leaves the original production container and env unchanged. After switching begins, rollback first restores the same retained original container ID/name/running state, independently of filesystem metadata restoration. It then attempts to restore previous env/image metadata. Metadata failure is explicitly reported as `REG_RU_ROLLBACK_METADATA_UNVERIFIED` and does not prevent the original process from restarting; the deployment remains failed and the metadata must be reconciled before another release.

After success, the original stopped container, image and previous env remain available. Do not substitute a DNS change to Vercel or a database rollback for this application-container rollback. Confirm the actual public revision and data readiness after restoration; a started container alone does not prove end-to-end health.

A database rollback, source unfreeze, migration, secret rotation or DNS mutation is outside PREPARE/VERIFY authority.


### Complete, same-origin public Auth acceptance
The candidate's external Admin/Public probes now reject redirects before any credential can be forwarded to another endpoint. Success requires complete JSON bodies within the existing 10-second abort windows, an Admin `users` array and a public-settings `external` object, then HTTP 200 for both. Truncated/stalled bodies, maintenance HTML and unexpected JSON shapes fail closed while rollback remains armed. Executable tests run the exact candidate Node probe against real loopback HTTP servers, including an independent redirect sink which must receive zero requests/credentials. Baseline `88f48d1` fails all ten rejection cases; this is production-gate regression evidence, not a claim of successful live sign-in.
