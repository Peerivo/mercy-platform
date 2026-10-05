# Notify RU-core read-only inspection

Prepared, not run. This manual diagnostic uses the existing protected Beget SSH
transport without changing the runtime, database, credentials or Telegram state.
It does not reuse the old effectful Helicopter relay rollout.

## Exact invocation and authority boundary

Workflow: `.github/workflows/inspect-notify-ru-core.yml` on the exact current
`Peerivo/mercy-platform` main. Inputs:

- `expected_sha`: exact reviewed current main SHA, also checked against GitHub;
- `confirm`: `INSPECT_NOTIFY_RU_CORE_READ_ONLY`.

The production job exists only for explicit manual dispatch. Its separate PR job
runs synthetic unit tests without production environment or secrets. No push,
schedule, issue or pull-request-target event can execute the protected diagnostic.

Transport is fixed to Beget `45.144.176.213`, user `supabase-deploy`, using the
existing `BEGET_SUPABASE_SSH_KEY` and pinned `BEGET_SUPABASE_KNOWN_HOSTS` in the
existing production environment. Host/user are checked before connection.
Identity-only, batch-mode and strict known-host verification remain mandatory.
The runner uses temporary key files and removes them on exit; no new key, account,
authorized_keys entry, permission, firewall rule or persistent access is created.

The only remote entry is reviewed Python streamed over stdin:

```text
sudo -n /usr/bin/python3 -
```

The script creates no remote file, imports no other product's credentials and
never prints exception bodies, environment values, database URLs, chat IDs,
tokens, customer content or Telegram messages.

## Read set

- `systemctl show peerivo-notify`: allowlisted state, PID/exit code and booleans
  comparing user/group/working directory/entrypoint to the existing canonical unit;
- current runtime layout: directory/symlink/missing and bounded location categories;
- fixed runtime `package.json` and seven RU modules: existence and SHA-256 only;
- optional local release manifest: validated 40-hex source revision only;
- fixed local Docker socket, existing `supabase-db`, database `postgres`: bounded
  Notify migration-version ledger inside `BEGIN TRANSACTION READ ONLY`, local
  five-second statement timeout and `ROLLBACK`; no schema/table/user-data export;
- unauthenticated loopback `http://127.0.0.1:3000/health` and canonical HTTPS
  `https://notify-api.peerivo.net/health`, with bounded bodies/timeouts and no redirects;
- protected Notify environment: only existing tenant/connection/actor references
  and port are parsed, without shell evaluation; credential fields are ignored;
- if those references are valid: one primary-key- and tenant-constrained connection
  metadata read in the same PostgreSQL target, inside a bounded read-only transaction.
  Only found/binding/private/actor/active booleans can leave the database.

The connection report contains safe metadata booleans without exposing identities.
No bearer is transmitted. The HTTP request layer rejects credential headers and
all paths except the two public health endpoints. This avoids trusting spoofable
health JSON or a check-then-connect listener identity. File reads are bounded
before allocation; symlinks and FIFOs are refused.

## Interpreting the report

Missing permissions/configuration, network failure, query failure and malformed
responses remain unverified. The process may report available diagnostic facts
while other checks remain false; workflow completion is not readiness success.
Compare runtime hashes to the accepted Notify source independently. A declared
revision alone is not proof of deployed bytes.

`matchesConfiguredPrivateOwner` only indicates that stored connection metadata
matches the existing scope reference. It does not verify an API credential,
independently identify the owner, or prove delivery. `privateOwnerConnection.ready`
and `apiVerified` always remain false here, as do `ownerIdentityIndependentlyVerified`
and `productionDeliveryVerified`. Those need separate acceptance evidence.

No restart, deploy, migration, credential provisioning, relay arm, onboarding or
Telegram send is permitted by this workflow. If inspection identifies a needed
change, describe that exact next action and obtain its applicable authorization.

## Local verification

```sh
python3 -m unittest discover -s tests -p 'test_notify_ru_inspection.py' -v
```

Fixtures exercise sanitized metadata, absent/aliased/arbitrary ignored credentials,
wrong actor/chat/binding, spoofed listener health, SQL target/transaction/row bounds,
exception redaction, environment non-evaluation, bounded memory, symlink/FIFO refusal
and manual workflow gates. They do not contact production or prove live delivery.
