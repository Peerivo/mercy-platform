# Notify RU-core read-only inspection

Run [37305664387](https://github.com/Peerivo/mercy-platform/actions/runs/37305664387)
at `e439c7cc67c5329c61f7ac62742cbe724afa88de` passed exact-main and pinned SSH,
but the host rejected `sudo -n /usr/bin/python3 -` with
`sudo: a password is required`. The inspector did not execute. No protected facts
were read and nothing changed.

The workflow now reads only service/health facts available to the existing SSH
account. It never retries sudo or accesses runtime files, EnvironmentFile or Docker.
Protected metadata is a separate explicit human-operated mode. Neither mode reuses
the old effectful Helicopter relay rollout.

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
/usr/bin/python3 - --public-only
```

The script creates no remote file, imports no other product's credentials and
never prints exception bodies, environment values, database URLs, chat IDs,
tokens, customer content or Telegram messages.

## Workflow read set

Only the `systemctl show` and two unauthenticated `/health` requests listed below
run in the workflow. Default command-line and function invocation are also
public-service-only. The report identifies `inspectionMode=public_service_only`;
all protected checks stay explicitly unverified. There is no escalation fallback.

## Separate user-executed protected metadata mode

An administrator using existing Beget access can review and explicitly invoke
`--protected-metadata`. This adds file hashes, release layout, migration ledger
and scope-constrained connection metadata to the two public health checks:


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

## Minimum secure handoff after the observed sudo refusal

Use an existing administrator terminal on Beget `45.144.176.213`. The GitHub SSH
account is `supabase-deploy`; it has not been granted new sudo rights. Never send a
password, key or environment file in chat. If the operator already has sudo access,
they can download, verify and run the immutable reviewed original inspector:

```sh
work=$(mktemp -d)
curl --fail --silent --show-error --proto '=https' --tlsv1.2 \
  'https://raw.githubusercontent.com/Peerivo/mercy-platform/e439c7cc67c5329c61f7ac62742cbe724afa88de/scripts/inspect-notify-ru-core.py' \
  -o "$work/inspect.py"
(cd "$work" && printf '%s  inspect.py\n' \
  '366b005f0c23d575af422a5e32ef7d827edec59101473494fecdfa0d9ccb1f90' | sha256sum --check --status) && \
  sudo -- /usr/bin/python3 "$work/inspect.py"
```

Review that exact GitHub source before running and stop on download/hash failure.
The immutable original requires no mode argument and includes all protected reads
listed above. Return only its sanitized JSON, never passwords or file contents.
Remove the temporary download normally afterward. If existing privilege is absent,
use the normal server administrator. Do not install a broad Python/shell sudoers
entry. A new fixed helper or persistent permission needs a separate security
decision and applicable action-time approval.
