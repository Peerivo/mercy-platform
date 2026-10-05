# Menaion moderation migration10: review-only transport

## State and scope

This change prepares a bounded transport; it does not apply or activate production.
Mercy base: `15fe3f513e7d87599f9af7149dc2a4aeb14461ee`.
Source: `Peerivo/living-menaion`,
`supabase/migrations/20261005073345_pronunciation_moderation_outbox.sql`.
The exact plaintext SHA-256 is
`ee2bf27553ca0a71baa275ad607b7ddbf0893e9e64d5687d8029d94bf592b499`.
Its schema, owner-decision binding and worker behavior are reviewed in the source project.
Only encrypted SQL crosses into this public repository.

This does not supersede draft Mercy PR #214 (`ops/menaion-owner-activation-recovery`).
Migration9, its ciphertext, the old executor, and the legacy bundle remain unchanged.
The transport cannot create a key, role, token, runtime binding, PostgREST configuration,
public endpoint or worker activation. Migration10 grants its narrowly specified access
to the existing service role; separate operator approval is required before applying it.

## Immutable provenance

- Existing public certificate recovered from successful read-only
  [inspection run 37057008733](https://github.com/Peerivo/mercy-platform/actions/runs/37057008733),
  job `111004079615`. Public DER SHA-256:
  `1c445517d9fe95784a9caced337ce5f34b9132610afd1946f325bd5ad8d385c9`.
  It matches the existing migration9 executor and expires 2036-09-26. No private key
  was copied, exported or generated. This historical evidence is not live readiness.
- `moderation-predecessors.json` retains all eight old ledger entries byte-for-value
  and appends migration9 with SHA-256
  `15265e48dcbf87b24b7aed34c296c2a4a83cbba132a5e33bffc0cfdd9469444c`.
  Do not replace historical ledger hashes with hashes of normalized current source files.
- Manifest SHA-256: `613887b5920dcffae6cad1db2b107ba0f8e366ae8c21f809a0b31f7d2fbf91a6`.
- Ciphertext-file SHA-256: `0462c0804ee37bb73edfbe468c16ccd5cfd5de69a7f1e1e108c4d50625e7fa57`.
  OpenSSL CMS, DER, binary input, AES-256-CBC, encrypted only to the verified existing
  public certificate. The remote plaintext digest is verified independently after decrypt.

## Gates and behavior

Workflow: `apply-menaion-moderation-encrypted.yml`.
PR events run credential-free regression tests only. There is no push deployment.
Manual operations use the existing `production` Environment, protected Beget bindings,
strict pinned SSH host verification and the existing database-production concurrency group.
They require first attempt, exact current `main`, exact expected SHA, and exact confirmation.
The current main SHA is checked again immediately before executing the remote script.

`INSPECT` is the default. Read-only SQL verifies database `living_menaion`, exact
`supabase_admin` session/executor, the existing ledger and prerequisite roles/objects/RLS.
Only exact nine-predecessor history with unused migration10 object names is ready.
Exact ten-entry history also verifies migration10 boundaries and reports already applied.
Missing, extra, reordered/incorrect versions and checksum drift fail closed.
The inspector emits one allowlisted status marker, never rows or configuration.

`APPLY` also requires a successful `INSPECT` run of this workflow from the same current
main SHA. It repeats the read-only inspection before decrypting. The transaction checks
the target and exact nine-entry history again under an exclusive ledger lock; applies
the pinned plaintext; verifies private RLS, service-role RPC grants, denied public/feedback
access and trigger boundaries; proves role attributes/memberships unchanged; and inserts
the tenth ledger row before committing. An already-applied state never replays SQL.
Raw SQL/database errors are suppressed because they can include private content.

Temporary files use an owner-only, validated directory and are removed. Neither mode
touches runtime containers, production app releases, credentials or owner Telegram setup.

## Smallest owner sequence

1. Authorize publication of this specific draft PR to `Peerivo/mercy-platform` if that
   cross-repository publication is not already authorized. Review its exact diff and CI;
   merging remains a separate action. Keep existing PR #214 separate.
2. After the reviewed transport is on main, approve/run `INSPECT` with that exact current
   Mercy main SHA and confirmation `INSPECT_MENAION_MODERATION`. Record its run ID and
   `MENAION_MODERATION_READY` (or verified already-applied) result.
3. Separately approve migration10 only, including its existing service-role schema grants.
   Run `APPLY` with the same current SHA, that successful inspection run ID, and
   `APPLY_MENAION_MODERATION_SCHEMA_ONLY`. If main advances, inspect the new main first.
   A production Environment approval must be granted by an authorized operator.
4. Re-run `INSPECT` against the same exact main to verify the ten-entry boundary.
   Database schema readiness does not prove public submissions or Telegram moderation.
   Continue the existing owner activation path separately for runtime credentials, private
   owner Notify binding, worker deployment/cache publication and end-to-end acceptance.

Missing protected bindings, absent/rotated certificate, stale checksum/history, or unresolved
PR #214 activation requirements are blockers. Do not generate replacements, reuse the old
generic database bundle, use direct shell SQL, or broaden public grants as a workaround.
New secrets belong only in canonical protected GitHub encrypted secrets. Do not put them
in this document, a PR, chat, an artifact or logs.

## Failure and rollback

- A rejected preflight never applies SQL. A transaction failure rolls back schema and
  ledger together, including the modified publication RPC and trigger/backfill.
- If a connection ends after submission, commit outcome is unknown. Do not click Re-run
  jobs or blindly dispatch APPLY again. Obtain a fresh read-only INSPECT. Exact ten-entry
  history plus successful boundary checks is already applied; exact nine-entry history
  requires a fresh operator decision before another apply. Any other state requires review.
- There is no automatic destructive down migration. After a confirmed commit, any rollback
  is a separately reviewed append-only migration, preserving drafts/decisions/outbox/audit
  data and the historical ledger. Runtime rollback must use the separately reviewed
  runtime path. Do not delete ledger rows or edit an applied migration.

## Local verification and remaining limits

Focused tests:

```sh
bash -n scripts/apply-menaion-moderation-encrypted.sh
python3 -m unittest discover -s tests -p 'test_menaion_moderation_transport.py' -v
python3 -m unittest discover -s tests -p 'test_menaion_feedback_transaction.py' -v
python3 tests/integration_menaion_moderation_transport.py \
  --pg-bin /path/to/installed/postgresql/bin \
  --migrations-dir /path/to/reviewed/living-menaion/supabase/migrations
```

The opt-in integration harness creates and stops its own disposable loopback-only cluster;
it accepts no production URL or credentials. Private source migrations must already be
available through the approved source checkout. It exercises real inspection/apply SQL,
wrong database/executor/checksum/version/object collisions, full rollback after injected
post-SQL failure, all ACL checks, ledger atomicity, replay denial and the source owner-decision
acceptance suite. Public PR CI runs the deterministic hash/dispatch/executor regression
suite and unchanged migration9 regressions without accessing private source or keys.

No live Beget invocation, production decrypt, authenticated API or Telegram test is claimed.
The full Mercy application build is outside this transport-only local test evidence.
Effective policy was resolved from active Global 1.12 at
`5ac07019c004415ed8eb82222f6bdc51b6a270aa`; local bindings are audit snapshots.
