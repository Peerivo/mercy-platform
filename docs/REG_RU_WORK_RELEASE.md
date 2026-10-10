# Reviewed Work release proposal (no GitHub Actions)

Status: **source publication and private-candidate preparation authorized; public promotion blocked by WEB-OBS-009**. The owner’s 2026-10-10 11:05 UTC instruction requests publication for official launch on 2026-10-11. Execution results must still bind the exact reviewed SHA; this runbook is not evidence of a completed deployment.

## Scope and authority

The owner's latest 2026-10-10 request is to check and publish Georgian Mercy for official launch on 2026-10-11, treating the product as not yet officially released. The
separate prohibition on GitHub Actions/CI remains in force, including indirect
triggers. Production migrations remain GitHub-Actions-only and are **excluded**.
No database, DNS, account, access, credential, secret, external Auth, analytics or
security-policy mutation is part of this application release.

Global 1.13.0 (`Peerivo/global` main
`cfe62ac4e9a69826178ae69f2ced4a0e8d20307f`) does not prescribe GitHub Actions for
every application deployment; its Actions-only requirement concerns production
database migrations. The existing project release runbook uses protected Actions.
This bounded alternative requires explicit review of its exact artifact, plan and
authorization before any host-side build, file upload, candidate start or promotion.
It preserves the existing readiness and rollback gates rather than disabling them.

## Source and publication

1. Start from actual main `3a4d3b37dd2c015996dd9f2c46fbc7b5ebcdcb61`, preserving
   its changes. Do not merge held PRs #243 or #245 as an incidental release step.
   Georgian localization and any independently required form correction are one
   reviewed diff. No new migration is included.
2. Run local lint, typecheck, unit/regression tests and production build on the
   exact final tree. Record passed, failed and not-run checks separately. Exercise
   Russian and Georgian UI on narrow and wide viewports, language persistence,
   consent copy, error feedback and form draft retention. Real Auth and data
   acceptance remain separate from a secretless local build.
3. Re-read actual main, organization ruleset and **all** repository workflow
   triggers immediately before publishing. Keep normal branch -> draft PR ->
   reviewed merge; no direct-main change or ruleset bypass. Every pushed commit,
   PR head and eventual merge commit must contain `[skip ci]`. This is valid only
   while the complete trigger inventory proves that no unsupported event can
   start work. If evidence is incomplete or a required check blocks merge, stop.
4. At inspected main, all 39 workflows use only `push` (26), `pull_request` (6)
   and `workflow_dispatch` (26). There is no `pull_request_target`, `workflow_run`,
   `repository_dispatch`, `schedule`, `create`, `release`, `merge_group`, or other
   trigger. The unfiltered main-push one-shot dispatcher is also skipped and its
   historical activation marker must never be added to the commit. No workflow
   is edited or disabled by this release. Reviewer automatic execution is
   canonically suspended; verify it remains so. GitHub's documented skip scope
   covers only push and pull_request:
   <https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs>.
5. Verify the resulting exact main SHA remotely and verify that no Actions run
   was created by publication. Do not represent skip/pending as successful CI.
   If main advanced, rebase/review/retest before release.

## Bounded host preparation, after release approval

1. Use the existing verified Gateway server `reg-ru-1`, `/opt/peerivo/mercy`,
   container `mercy`, and existing `mercy-reg-ru` network. Check that no GitHub,
   Gateway, other worker or host deployment is active. Hold one exclusive
   application-release lock throughout preparation and promotion; refuse a
   nonempty loopback candidate port 3101 or existing release-specific names.
2. Record the original container ID, immutable image ID/tag, health/revision,
   running state, port binding, network/MTU, restart policy and protected env-file
   metadata. Store complete Docker configuration and env backup **only on the
   same production host**, mode 0600 under a release-specific private directory.
   Never return values or user records to Work, Gateway output, artifacts or logs.
   Prove existing env-file values agree with the live container before reuse;
   mismatch fails closed. The old container remains running during all build
   and staging work.
3. Repeat bounded anonymous data and Admin/Public Auth probes with existing
   runtime configuration. Keep the direct Beget GoTrue preflight as an
   independent check, executed on Beget with its existing runtime configuration;
   export only pass/fail. No key is copied between hosts or rotated. An ambiguous
   identity, invalid key, malformed/partial body, redirect or timeout is failure.
4. Create a source-only `git archive` of the exact approved current-main SHA;
   verify no `.env`, dependencies, build outputs or untracked files are included.
   Bind its SHA-256 and source SHA in the evidence. Transfer only that non-secret
   archive to a new release-specific host directory through the existing Gateway
   transfer path. Verify its SHA-256 before extraction; reject unsafe archive
   entries and do not overwrite the existing application directory.
5. Build Next standalone in Work from that exact merged SHA, using only the
   existing client-visible values independently retrieved from canonical public
   HTML/JavaScript and matched to the reviewed fingerprints. Set the exact merged
   `GIT_SHA`; never export private runtime/service/mail secrets to Work. Verify
   the package contains no env/profile/credential files or synthetic fixture
   configuration. Transfer the immutable checksummed package alongside source
   provenance. On REG.RU perform runtime-only assembly, reproducing the existing
   Dockerfile final stage with the already cached digest-pinned Node image,
   non-root user, ownership, command and healthcheck. No npm install or Next
   compilation runs on this shared host. Require available RAM >=1200 MiB and
   free disk >=2 GiB, bounded owned scratch, an operation timeout and host-headroom
   monitoring. Do not mistake a CLI memory limit for a BuildKit daemon limit.
   Record the immutable image ID; stop on insufficient resource headroom.
6. Use a separately reviewed, bounded **stage-only executor**. Never execute the
   complete `REMOTE_SCRIPT` from `.github/workflows/deploy-reg-ru.yml`, or the
   existing host `deploy-mercy.sh`, for private-candidate preparation: that script
   creates a missing network, automatically stops/renames production after its
   candidate probes, and performs broad historical image-tag cleanup. None of
   those actions belongs to this stage. Reuse only independently reviewed probe
   functions with exact source hashes; exclude all promotion and cleanup code.
   Write a release-specific protected candidate env file on the same host only,
   deriving it from the unchanged verified production configuration and changing
   only non-secret `GIT_SHA`. Do not overwrite `.env.production` or shared
   `.env.next`. Require the existing network with exact expected MTU; missing or
   mismatched network fails closed without creating/updating it. Retain the old
   running production container and every existing image/rollback artifact.
   Cleanup is limited to exact owned candidate labels/IDs and its own scratch.

## Private candidate now; separately gated promotion later

- Candidate uses immutable image ID, non-root read-only runtime, existing MTU1400
  network, private loopback 3101 and a unique SHA-bound name/label. Production
  continues on 3100. No public candidate exposure or firewall change.
- Before promotion: Docker health; exact SHA/environment `/health`; complete
  bounded `/health/data` and direct anonymous RPC; complete same-origin
  Admin/Public Auth 200 JSON with structural checks; canonical failure callback;
  Peerivo Auth PKCE start; Russian hostname 308 with path/query preservation;
  Georgian/Russian rendering. Repeat data checks to distinguish an intermittent
  dependency fault from readiness. Any inconsistent result rejects the candidate.
- The current stage-only executor must stop after private-candidate gates. The
  following promotion/rollback requirements apply only to a separately reviewed
  promotion executor after the public-release gate closes; they are not reachable
  operations in the stage-only script.
- Before stopping anything, independently verify backup presence and retain the
  exact original container ID/image. Recheck main SHA, unchanged live container
  identity and exclusive release ownership. Arm rollback before stop/rename.
- Retain the old stopped container under the release-specific rollback name;
  start the new production container on 3100 and repeat every gate. Promote
  environment/image metadata only after all production-port gates succeed.
- On failure before switching, remove only the labelled candidate. On failure
  after switching, restore the **same original container**, previous env and
  image metadata. Verify its expected public revision and baseline behavior;
  report restoration uncertainty explicitly. Do not hide the known baseline
  data-readiness failure or perform a DB/DNS rollback.
- After success, retain original container/image/env and the evidence. Public
  HTTPS must independently report the exact deployed revision and healthy data.
  Real-account login -> cabinet -> refresh -> authorized form submission and
  owner visibility -> logout are separate acceptance scenarios; do not invent
  a test identity or submit personal data without suitable authority. A browser
  login/verification handoff may be needed. Missing scenario evidence stays open.
- Public-web compliance is a separate release gate under Global WEB-OBS-009.
  Verify the live `/site-observability.json`, GTM-only integration, approved
  provider/consent/DNS evidence and privacy policy or an explicitly approved
  exception. Existing documentation records `unknown_not_verified`; Georgian
  UI work does not make it compliant. Do not silently add analytics, recordings,
  advertising or sensitive-form telemetry to satisfy this gate.

## Fresh baseline findings (2026-10-10)

- Actual main: `3a4d3b37dd2c015996dd9f2c46fbc7b5ebcdcb61`.
- REG.RU original runtime: `733b3207444b96c3873433d70b4c9279be3bee09`,
  container `5ae52808eb803c62a1a55c9a19472140061761aaa92a13b082115a40000630d0`,
  immutable image `sha256:e6537d489ed3e30fc90a75f040a8000042dce41e9f0aabf1fc5f23af17f51ab8`.
- `/health` 200; `/health/data` was observed both 503 and 200, so readiness is
  **intermittent/unverified**, not fixed. The same bounded RPC in fresh container
  processes returned 200. Compiled and runtime anonymous key fingerprints and
  canonical URL match; no stale-key conclusion is supported.
- Existing Admin and Public Auth probes returned 200 with complete expected JSON.
  These are channel checks, not evidence of a completed user login.
- Root cause of the intermittent data failure was proven read-only: Kong uses
  `http://rest:3000/` and `http://rest:3000/rpc/graphql`, while both `supabase-rest`
  (`172.18.0.2`) and `peerivo-auth-rest` (`172.18.0.11`) advertise `rest` on
  `supabase_default`. Kong DNS returns both. The identical Mercy anon/RPC returns
  200 from the former and 401/PGRST301 from the latter. Eight paired samples gave
  direct RPC401/PGRST301 while the application route gave200. This cannot be
  accepted as stable readiness. A proposed two-URL change to `supabase-rest`
  requires separate routing approval, backup, config validation, graceful reload
  and bounded repeated verification; it is not performed by this UI branch.
- No parallel deployment process/Gateway job found at the initial inspection;
  recheck immediately before any effectful step.


## Updated dependency and release checkpoint — 2026-10-10

The earlier intermittent baseline and proposed Kong repair above are historical.
The owner separately approved exactly the two upstream URL corrections; verified
backup/config parsing/graceful reload and repeated checks completed successfully.
The source candidate now has 280 passed tests plus one pre-existing optional skip,
16/16 isolated synthetic Chromium scenarios and a successful independent Work
build with fingerprint-verified public production configuration. None proves real
Auth/RLS/write/email acceptance.

Global CONTRACT section 15 explicitly requires observability for the first public
production release even while the project is still pre-production. Therefore the
owner's updated lifecycle classification does not convert canonical public
`mercy.peerivo.net` promotion into a private preview. Source PR/merge and private
loopback staging are separate permitted outcomes. Keep the old public container
running while WEB-OBS-009 remains open; do not falsify registry/evidence or invent
provider IDs. Historical content-bound artifacts must be rebuilt against the
merged SHA, and synthetic QA archives must never be promoted.
