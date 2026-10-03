# Menaion runtime activation and recovery

## Status

Migration `20261002184929` is already applied; no migration is added or rerun here.
The October 2 read-only preflight passed at commit `0120c2f9` but did not activate
credentials or the form. Its `activation_ready=false` and headline blockers are
fixed diagnostic-only fields, not proof of a detected leak. The inspector stays
read-only; the separate implementation below is still a draft until reviewed and
explicitly approved. Production activation and public-form success are unverified.

## Owner-operated replacement

The `Activate or roll back Menaion runtime` workflow and
`scripts/activate-menaion-runtime.py` implement a bounded activation/recovery path.
Their presence and a green PR check do not mean production has changed. The owner
must approve the exact production scope, enter/save the dedicated credential, and
personally submit the workflow. An assistant must not run the ACTIVATE operation.

### Exact scope

- Preserve the current immutable image, complete effective `Config`, `HostConfig`,
  single network configuration, JWT verifier/audience, unrelated environment bytes,
  labels, working directory, masked paths, and legacy service-role access.
- Change only the already-created dedicated role's password/LOGIN and the Menaion
  runtime URI username/password and schemas (`living_menaion,menaion_feedback`).
  `Config.Image` becomes the already-inspected immutable image ID rather than its
  mutable tag. Never expose the private schema; never change the shared Mercy REST.
- Keep the original container stopped under `living-menaion-rest-before-feedback`
  and retain its private runtime configuration and exact env bytes. This version
  refuses a second activation while any retained state exists. Cleanup/rotation is
  a separately reviewed operation; do not delete the recovery files to force retry.
- Retire the old destructive provisioner's automatic trigger and make that workflow
  refuse before provisioning. It otherwise could overwrite this isolated runtime.
  New operations share the database Actions concurrency and a host-side file lock.

### Credential handling

The owner creates a password-manager-generated random 32–96 printable, non-space
ASCII password and saves it as `MENAION_REST_AUTH_PASSWORD` in this repository's
GitHub `production` Environment. New secrets belong in GitHub encrypted Secrets.
Do not paste it into chat, workflow inputs, command arguments, a PR, or a terminal
command. The user must perform entry, confirmation and final workflow submission.

Pinned-host `ssh -T` sends the secret only over stdin, separately from script
source. Non-TTY `docker exec -i`, an explicit local PostgreSQL socket, a minimal
process environment, `psql -X -w`, and `\password` use client-side SCRAM encryption.
The role/database/Unix-socket target is checked inside that same transaction before
changing the password. Plaintext is never interpolated into SQL. Raw subprocess,
HTTP and Docker errors are suppressed; core dumps and shell tracing are disabled.
No logging/audit/preload setting is disabled. PostgreSQL can log a SCRAM verifier;
this is not a claim that every database/host audit hook is secret-safe. A strong
random password remains essential, and privileged host operators can already read
runtime credentials. The application URI necessarily persists privately in Docker
configuration and the mode-0600 runtime file/backup.

The sanitized, fsync'd journal contains only operation phase, non-secret IDs,
source commit/run identifiers and role OID. Raw configuration and env rollback
copies are separate owned mode-0600 runtime backups in the existing mode-0700
runtime directory. They are never uploaded as workflow artifacts or emitted into
logs. New script staging contains source only, not the credential.

### Verification and recovery

Before the password step, create a stopped candidate with the live configuration
and compare every effective Config/HostConfig field, immutable image and writable
network setting exactly. An ignored field, daemon normalization or unexpected
Docker default fails closed; no broad null/default normalization is used. The
observed WorkingDir, Labels and MaskedPaths differences are copied verbatim.

After cutover, require legacy token HTTP 200 plus an empty zero-row query; an
in-memory feedback JWT expires after 120 seconds and is never exported. Its
invalid-input RPC is a GET, which PostgREST executes in a read-only transaction.
Require the exact `invalid` result. Verify content and unrelated reads are denied with HTTP 403/42501; verify publication
update/delete grants are absent using read-only catalog SQL, and the private profile with
406/PGRST106, and the shared Mercy runtime rejects the feedback role/profile.
Zero-row probes cannot serve as permission success. No PATCH, DELETE or POST probe is sent. Invalid-token,
unknown-route, generic 4xx, timeout and transport failures never count as isolation
proof. Shared runtime identity/configuration is checked unchanged.

All effects have durable write-ahead phases; ambiguous create responses reconcile
only a matching deterministic candidate. Ordinary exceptions and handled
SIGTERM/SIGINT/SIGHUP trigger compensating rollback: stop/remove only the identified
candidate, disable the exact dedicated role, clear its password and terminate only
its remaining sessions, restore the original container name/config/env and verify
its legacy query. The existing role memberships/migration are retained. No content
rows are created, deleted or altered by activation/recovery.

SIGKILL, runner disconnection, Docker/database outage or host power loss can leave
service unavailable until manual recovery. This implementation does not install a
background recovery daemon. After an interrupted/uncertain ACTIVATE, do not retry
ACTIVATE. Use the same reviewed workflow, choose `ROLLBACK`, provide exact current
main SHA and submit it yourself. No password is needed for ROLLBACK. It reads the
versioned private recovery state and reconciles actual IDs, not just the last
completed phase. A failed rollback reports recovery required and retains the
backup/journal; success requires role inactivity, zero dedicated sessions, original
container/env restoration, and the legacy query. Repeated ROLLBACK is supported.

### Minimal eventual owner sequence

Only after the draft is reviewed and explicitly authorized for production:

1. Merge the reviewed change through the normal PR process.
2. Save the dedicated password in Mercy's `production` GitHub Environment secret
   above. Personally start `Activate or roll back Menaion runtime` on `main`, choose
   `ACTIVATE`, and paste the exact current main commit SHA (not a password) into
   `expected_sha`. This authorizes the dedicated credential/runtime changes,
   host-local legacy-token probes and short-lived test-token creation described here.
3. Wait for the verified result. If interrupted, use `ROLLBACK`; never blind retry.

A successful runtime activation is not a working public form. Persistent narrow
feedback-token issuance and user-secure binding to the verified Vercel Production
target remain a separate owner-operated step. This implementation intentionally
issues no persistent application credential and does not deploy Vercel. The final
acceptance also needs an owner-approved real correction, persisted draft and
deduplication check. The existing migration must not be rerun.

### Test evidence and limitations

Offline tests cover exact configuration preservation, malformed password/type
inputs, client-encrypted argv/stdin separation, narrow JWT expiry, sanitized
journals, expected HTTP errors, before/after failure injection for every Docker
transition, lost create/env-write responses, password/probe failures, role-recovery
failure, foreign identity refusal and repeated rollback. The real disposable Docker/
PostgreSQL integration suite runs only in secretless PR CI. Local tests cannot prove
production daemon fidelity, network/DNS behavior, installed audit-hook safety or
successful production credential entry. Report integration as never run until the
actual CI result is available; neither a mocked pass nor a preflight substitutes.

References: [psql password command](https://www.postgresql.org/docs/15/app-psql.html),
[PostgREST configuration](https://docs.postgrest.org/en/v12/references/configuration.html),
[PostgREST transactions](https://docs.postgrest.org/en/v12/references/transactions.html),
[Docker Engine API](https://docs.docker.com/reference/api/engine/version/v1.45/),
[Docker restart policies](https://docs.docker.com/engine/containers/start-containers-automatically/).
