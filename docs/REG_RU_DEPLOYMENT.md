# Mercy production deployment to REG.RU

This runbook covers the application container only. The Russian Supabase database cutover is a separate guarded workflow documented in `docs/RU_SUPABASE_MIGRATION.md`. The application deployment never runs database migrations.

## Authority and trigger

Production deployment is manual through GitHub Actions workflow **Deploy REG.RU production**.

Required conditions:

1. the workflow is dispatched from `main`;
2. input `confirm` is exactly `DEPLOY`;
3. the event SHA still equals the live `origin/main` SHA when the job starts;
4. the protected GitHub `production` environment permits the job;
5. required production configuration is present.

A queued or re-run workflow for an obsolete revision aborts before the image is built or uploaded.

## Protected configuration

Infisical remains the canonical secret source. GitHub Actions production configuration is a downstream delivery surface.

Required protected values:

- `REG_RU_HOST`
- `REG_RU_USER`
- `REG_RU_SSH_KEY`
- `REG_RU_KNOWN_HOSTS` — a pre-verified OpenSSH known-hosts line for the exact production host; never generate trust with `ssh-keyscan` inside the deployment
- `NEXT_PUBLIC_SUPABASE_URL`
- one of `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `FEEDBACK_TO_EMAIL`

Do not paste secret values into issues, PRs, logs, chat or documentation.

## Host prerequisites

REG.RU host must provide:

- Docker;
- gzip;
- curl;
- SSH user authorized by the pinned key;
- writable private directory `/opt/peerivo/mercy`;
- reverse proxy/TLS for `https://xn----htbcggcjkhwxk7j6bn.xn--p1ai` to `127.0.0.1:3100`.

The application container runs non-root, read-only, with only a scoped `/tmp` tmpfs and binds only to loopback port 3100.

## Deployment transaction

The workflow builds an immutable image `mercy-platform:<git-sha>` on the GitHub runner, saves it as an archive and uploads the archive plus a candidate environment file.

The remote transaction:

1. records the currently running image;
2. loads the immutable candidate image;
3. leaves `.env.production` untouched;
4. stops the old container and starts the candidate with `.env.next`;
5. waits for the Docker healthcheck;
6. verifies local `/health`;
7. verifies local `/health/data`, which exercises the configured Supabase public RPC path without returning user data;
8. verifies both endpoints through the public HTTPS domain/reverse proxy;
9. only after all checks pass, snapshots the old environment/image for rollback and promotes `.env.next` to `.env.production`;
10. retains the current image and exactly one previous image, deleting older Mercy tags.

## Rollback

Until promotion is committed, any non-zero exit or HUP/INT/TERM signal arms rollback.

Rollback:

- removes the failed candidate container;
- restores the prior environment if promotion had started;
- restarts the previous image with its known-good environment;
- removes the candidate environment/archive;
- removes the failed candidate image when safe.

The workflow never treats a successful `/health` liveness response alone as deployment success.

## Health endpoints

- `GET /health` — liveness/release identity; no database call.
- `GET /health/data` — anonymous data-readiness probe. It performs a bounded `list_public_help_requests` RPC and returns only `{"status":"ok"}` or `{"status":"degraded"}`, with `Cache-Control: no-store`.

After the remote transaction, GitHub Actions verifies that public `/health` reports the exact deployed Git SHA and that `/health/data` reports `ok`.

## First activation

Before the first real deployment, verify the pinned `REG_RU_KNOWN_HOSTS` value out of band and confirm the reverse proxy/TLS route. Do not use the workflow itself to discover or trust the host key.

A production deployment is effectful. Preparing or merging this workflow does not authorize running it; the actual `DEPLOY` dispatch remains a separately scoped production action.
