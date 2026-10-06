# GitHub issue moderation: existing-target schema package

## Review scope and provenance

The initial package transport merged through PR #227. These append-only13,
policy11-authority and diagnostic corrections are prepared locally against the
verified current Mercy main `6f353bb9c80946a5c8a448da30e275341bec2546`,
preserving the already-merged Happy Food Rescue adapter and project documentation.
They have not been dispatched or applied to production. Paused/unmerged authentication PR #214
is not included. Effective Global authority was rechecked as 1.12.0 at
`5ac07019c004415ed8eb82222f6bdc51b6a270aa` on 6 October 2026.

The package uses the existing protected Beget transport, existing public deployment
certificate and remote private key. Its fixed target is Docker `supabase-db`, database
`living_menaion`, session/executor `supabase_admin`, and the existing ledger
`public.living_menaion_schema_migrations`. Docker is pinned to the local Unix daemon
`unix:///var/run/docker.sock`; remote host/context overrides are rejected.
Inherited libpq host/address/port/service selectors are cleared inside the container,
preserving its established local socket defaults; APPLY also clears inherited PGOPTIONS. No SQL file path, database, role, host,
certificate, arbitrary version or source checksum is an operator input.

Frozen sources from `Peerivo/living-menaion`:

| Version | Role in this package | Plaintext SHA-256 |
| --- | --- | --- |
| `20261005073345` | Apply only if missing: private moderation outbox, decisions and approval-only cache events | `ee2bf27553ca0a71baa275ad607b7ddbf0893e9e64d5687d8029d94bf592b499` |
| `20261006033844` | Optional already-applied content policy; verify and preserve, never apply or replace | `48292e5d1ae87aea8931cdd3cd8d28f1ffbef1795adc0e28c874eb0b6b5b7b34` |
| `20261006055900` | Apply missing immutable issue-ingestion/action/attempt/receipt ledger and service-only RPCs | `57661d31ed4bc5f441b94a1b9f44b704e17ac6b98c390c8a4bddfcdd16a076a3` |
| `20261006070900` | Append-only submitted-time rate-window and shared-counter retention repair | `97dc3c7e3e76bdad2d3448dfbd75adef8c3f3c62ecd0248856b729c6d403cf2f` |

The nine historical deployed checksums are taken only from unchanged
`ops/living-menaion/moderation-predecessors.json`; its SHA-256 is
`613887b5920dcffae6cad1db2b107ba0f8e366ae8c21f809a0b31f7d2fbf91a6`.
Current normalized source fixture bytes must never replace those historical values.

New catalog contract SHA-256:
`b4ba5f1c5950dc444f150d241b4a2e7311d798d00dcdefa1a3ae984aca1ad122`.
Existing migration10 ciphertext remains unchanged with SHA-256
`0462c0804ee37bb73edfbe468c16ccd5cfd5de69a7f1e1e108c4d50625e7fa57`.
Immutable migration12 ciphertext-file SHA-256:
`1bc348d8c88f45815a34defd25e77b44aa589892a4be150ff3dddeb2ae5ebe68`.
New migration13 ciphertext-file SHA-256:
`3c84ef432b7ac4e0b7c46a14d4b8e6023818c01ddd0bf3722c0b937d430ea716`.
Encryption is OpenSSL CMS, DER, binary, AES-256-CBC to the existing certificate,
whose public DER SHA-256 is
`1c445517d9fe95784a9caced337ce5f34b9132610afd1946f325bd5ad8d385c9`.
Only ciphertext, catalog digests and object names enter this public repository;
private source SQL and policy11 function bodies are not copied here.

## Exact accepted histories

`H9` means all nine exact version/checksum pairs in the immutable predecessor file.
The only eligible starting histories are:

- H9
- H9 + canonical10
- H9 + canonical11
- H9 + canonical10 + canonical11
- H9 + canonical10 + canonical12
- H9 + canonical10 + canonical11 + canonical12

The completed histories H9+10+12+13 and H9+10+11+12+13 are verification-only.
Existing12 is eligible only for the missing13 repair; immutable12 never replays. Missing predecessors, checksum drift, any other version,
issue12 without10, issue13 without12, and unknown future migrations fail closed. Counts alone are not
history evidence. The older standalone migration10 transport is not called by this
package and cannot be used to work around a policy11 history rejection.

Inspection is a read-only transaction. It checks PostgreSQL17, target/executor,
the exact real three-column ledger structure (including `applied_at`), exact history,
predecessor schema ownership/ACLs and effective worker USAGE, RLS/roles, private object-name
collisions (including relation indexes and composite types), and relevant live
catalogs. Catalog fingerprints include exact columns/defaults, checks, foreign keys,
unique constraints/indexes, policies, RLS, owners, table and column ACLs, triggers,
and function definitions/configuration/ACLs. Effective access for public/client/
feedback/editorial roles is checked separately to catch inherited service access.
For policy11, exact function definitions and trigger structure are required, and
its existing function ownership/ACLs are preserved across application.

Apply repeats those checks under an exclusive ledger lock. It applies missing10,12
and13 in one transaction, verifies all resulting catalogs, inserts only missing
ledger entries and commits. Role attributes/configuration/memberships, the
publication RPC owner/ACL, legacy submitter owner/ACL and the content policy remain unchanged. Any failure
rolls back both package schemas and ledger entries. A race with an already
completed package is refused under the lock rather than replayed.

Migration13 attributes delayed issue admissions to their validated submission windows,
and retains shared client/global counters through the seven-day delayed-admission
horizon. It replaces only the existing issue-ingestion and restricted legacy-submitter
function bodies, preserving owners, ACLs, signatures and security modes. It also extends
still-live recognized counters without changing their counts. It does not restore
already expired/deleted counters, reconsider terminal admissions, or replay issue12.
Rollback tests prove these counter updates and function replacements roll back with
all schema/history changes.

Migration10 is generic private audit/outbox/cache infrastructure. There is no
prerequisite for a Menaion PostgREST authenticator, active login, JWT, exposed
schema, new DB credential, Notify database, RU core or bot runtime. The fixture
suite demonstrates application with the dormant Menaion authenticator role
removed. This schema package creates no role or credential, changes no login,
accepts no runtime secrets and performs no runtime activation. Existing service
access is narrowly granted by the frozen source migrations.

## Exact operator inputs

Workflow: `.github/workflows/apply-menaion-issue-package-encrypted.yml`.
PRs run credential-free regression validation only. Manual dispatch also runs the
same validation before the protected `production` job. There is no push deploy.
Both modes require attempt1 and the exact current Mercy main commit, rechecked
immediately before remote execution. SSH host verification uses the existing
protected bindings and the shared database-production concurrency group.

After review/publication/merge is authorized and complete:

1. Record the actual current Mercy main SHA and successful validation for that
   exact code. Run `INSPECT` with:
   - `action`: `INSPECT`
   - `expected_sha`: the exact current 40-character Mercy main SHA
   - `confirmation`: `INSPECT_MENAION_ISSUE_PACKAGE`
   - `inspection_run_id`: empty
2. Record its workflow run ID and the two allowlisted output lines. A ready package
   reports `MENAION_ISSUE_PACKAGE_READY`. A completed package reports
   `MENAION_ISSUE_PACKAGE_ALREADY_APPLIED`; no apply is needed.
3. For an explicitly approved schema application, dispatch against the same current
   main with:
   - `action`: `APPLY`
   - `expected_sha`: that exact current Mercy main SHA
   - `confirmation`: `APPLY_MENAION_ISSUE_PACKAGE_SCHEMA_ONLY`
   - `inspection_run_id`: the successful package INSPECT run ID from that SHA
4. Authorized Environment approval remains required by its actual protection
   settings. The workflow rejects another workflow, branch, SHA, rerun, event,
   unfinished/failed result or mismatched inspection title. If main advances,
   inspect the new main first. Successful application emits
   `MENAION_ISSUE_PACKAGE_VERIFIED`; repeat read-only INSPECT for final evidence.

Each successful inspection/application also reports exactly:
`MENAION_ISSUE_PACKAGE_LEGACY_UNMAPPED_ATTEMPTED=<nonnegative integer>`.
This counts outstanding, undecided legacy outbox rows that were previously attempted
or bound and have no saved issue mapping. No word, proposal, owner identity, action
ID or other row data is printed. Schema application preserves these rows. A positive
count blocks enabling issue-only polling unless correctly configured legacy polling
is retained or these actions are separately reconciled. Never resend ambiguous
legacy delivery or manufacture an issue mapping. Never-attempted unbound drafts are
safely adoptable by the reviewed issue worker; completed decisions need no legacy
polling. Runtime readiness remains the installer’s separate responsibility.

Schema success does not establish configured GitHub credentials, verified private
owner/bot binding, webhook readiness, Telegram delivery, callback acceptance, worker
rollout, or cache/master refresh. The complete package installer and end-to-end
acceptance own those checks. No prior Notify sudo denial may be bypassed by this
transport or by switching to a privileged route.

## Failure, retention and recovery

Failures now include `MENAION_ISSUE_PACKAGE_FAILURE stage=<fixed stage> gate=<fixed gate>`.
Stages distinguish input integrity, local Docker target, deployment-key/certificate
presence, inspection construction/database/output, decode/decrypt/source integrity,
and application construction/database/output. Database gate failures use fixed SQLSTATE
codes mapped to fixed names, such as `history_mismatch`, `schema_catalog` and
`policy11_authority`; unknown errors become `database_unclassified`. SQLSTATE-only
psql verbosity and suppressed context ensure no raw SQL, row, error message, path or
secret is copied into the diagnostic. The source SQL is never rewritten to instrument
it. This diagnostics change does not retry the failed live inspection or authorize an
application.

Both policy11 functions now require their canonical owner and complete EXECUTE ACL,
including grantors and grant options, before inspection can certify readiness. Existing
canonical grants remain unchanged; a before/after snapshot alone is not accepted as
proof of pre-existing authority.

All temporary files use a validated owner-only directory and are removed. Database,
decrypt and raw construction errors are withheld because they may contain source or
row data. Output is limited to fixed state markers and the legacy count.

A connection failure after submission leaves the commit outcome unknown. Do not use
Re-run jobs or blindly dispatch APPLY again. Obtain a fresh INSPECT. Exact completed
history and catalog evidence means applied; exact eligible history permits a new
scoped operator decision. Any other result requires investigation. There is no
automatic destructive rollback/down migration, deletion of drafts/audit/receipts, or
ledger rewriting. Disable runtime admissions/delivery through the separately
reviewed package rollback; any schema correction must be append-only and approved.

## Local verification

```sh
bash -n scripts/apply-menaion-issue-package-encrypted.sh
python3 -m unittest discover -s tests -p 'test_menaion_issue_package_transport.py' -v
python3 -m unittest discover -s tests -p 'test_menaion_moderation_transport.py' -v
python3 -m unittest discover -s tests -p 'test_menaion_feedback_transaction.py' -v
python3 tests/integration_menaion_issue_package.py \
  --pg-bin /path/to/installed/postgresql/17/bin \
  --migrations-dir /path/to/reviewed/living-menaion/supabase/migrations \
  --policy11 /path/to/frozen/20261006033844_blockwise_publication_readiness.sql
```

The real PG17 harness creates/stops its own disposable loopback-only cluster. It
accepts no database URL, remote host, password or existing cluster. It recomputes
and compares catalog fingerprints from the frozen sources; covers all six eligible
starting histories; injects failure after DDL to prove atomic rollback; verifies
success and policy11 preservation; denies replay, bad history/target/executor,
object collisions and catalog/security drift; runs the source issue acceptance
suite; checks the legacy count and absence of authenticator prerequisites.
Public PR CI cannot decrypt private source, so it runs deterministic integrity,
shell/redaction/no-replay and dispatch gates without protected secrets. Full Mercy
application CI and live Beget/Telegram acceptance are not claimed by local transport
verification.

The previous read-only INSPECT run `37427490190` failed with an unclassified marker
before any approved APPLY. It remains failure evidence, not schema-install evidence.
A new read-only diagnostic run requires the reviewed correction on exact current main;
these local repairs do not themselves retry that run.

## Pre-13 quiescent transition guard

Migration13 remains byte-for-byte frozen. Its trailing live-counter UPDATE is not
a safe 12->13 conversion by itself, and removing only that UPDATE is also unsafe:
the migration13 ON CONFLICT path can still prolong a shared v12 key. The installer
therefore hash-pins `pre13-quiescent-guard.sql` and executes those exact guard
bytes only after canonical10+12 and immediately before unchanged13, in the same
database transaction.

Before APPLY, both pronunciation-admission writers must be paused and every
in-flight call drained. The workflow requires an explicit quiescence attestation,
but the database guard remains authoritative: it takes advisory transaction lock
`(194819,1)` and refuses if any shared `rate_buckets` row is still live. A
refusal never deletes, resets, shortens or namespaces a counter. Wait for natural
expiry and run INSPECT again.

INSPECT has three fixed states: READY, PRE13_LIVE_RATE_COUNTERS and 13_PRESENT.
If13 is already present, APPLY stops before decryption/guard. The pre13 guard is
not a repair for an installed13. Recovery must first preserve evidence and
separately establish counter provenance; old and new counters have the same
representation and the issue-ingestion ledger does not retain the client rate key.
