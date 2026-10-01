# Auth mail diagnosis after the Beget cutover

The public callback, Auth health and database readiness endpoints do not prove
that a magic-link email can be sent or that the received link signs a user in.
Keep these acceptance results separate.

## Findings before server inspection

On 2026-09-28, the application at `https://mercy.peerivo.net` reported deployed
SHA `bd078fc21e98eff63f243815b67e6f970e17fecf`. Its inspected browser scripts
contained `https://api.mercy.peerivo.net`, without the former managed project
hostname. The latest Resend sign-in email was from 2026-09-24 and its redirect
target was a separate historical Vercel preview. That historical email is not
evidence of the current production application's API destination.
The GitHub `Production` Environment was also inspected: its variable
`NEXT_PUBLIC_SUPABASE_URL` is `https://api.mercy.peerivo.net`, matching the live
bundle. The REG.RU workflow prioritizes that variable over a secret fallback
and requires the canonical URL before building. No change to this variable is
indicated by the evidence.

Resend reported the sending domain verified, sending enabled, unused daily
quota, no suppressions and disabled click tracking. These observations do not
prove the current Beget Auth SMTP configuration or connectivity.

The cutover script copied Auth users/identities and application data; it did
not copy managed Supabase SMTP settings. The existing URL repair intentionally
changed four URL/issuer fields while preserving the other Auth environment
variables. Neither operation verified production email delivery. The current
runtime SMTP mismatch, if any, remains unverified until inspection.

`OLD_SUPABASE_DB_URL` is a PostgreSQL connection secret used only by the
legacy migration preflight and cutover/recovery workflow. It is not injected
into the application or REG.RU deployment. Removing it does not change Auth's
API or email URLs; retirement of that old recovery path is a separate action.

## Protected inspection

Use **Inspect Beget Auth mail** from current `main`, with:

- `expected_sha`: the exact reviewed current main;
- `confirm`: `INSPECT_AUTH_MAIL`;
- `search_database`: `true` only for the explicitly requested read-only search.

The workflow checks the latest push-triggered project CI on that exact main,
uses the existing production Environment and pinned Beget SSH host key, and
serializes against the existing Auth URL repair. It needs the existing Beget
SSH settings. `RESEND_API_KEY` is optional: absence remains explicit and never
causes a fabricated successful comparison/probe. No new credential is created.

Outputs are fixed classifications/counts, never values from Auth environment,
raw error logs, SQL results, email addresses, API keys or token URLs. Inspection
reads Docker metadata and the last 200 Auth log lines from the last 48 hours.
SMTP probing reuses the installed Storage image ID (`--pull never`) in a
temporary read-only, unprivileged container sharing Auth's network namespace.
The only destination is `smtp.resend.com`, with verified TLS. Missing local
Node support or any probe failure is reported as unverified, not success.

SMTP AUTH success proves only transport/key acceptance. Sender authorization,
message acceptance/delivery and end-to-end login still require a separately
authorized actual application request and inspection of the resulting email.
This workflow never issues MAIL, RCPT, DATA, a login request or a service restart.

The URL report checks both `API_EXTERNAL_URL` and mailer URL paths against
`https://api.mercy.peerivo.net/auth/v1/verify`, plus the canonical site/callback
settings. It flags custom templates and email hooks for separate inspection;
configuration checks must not be presented as proof of an actually generated
email link.

The optional database search reads database role/session settings,
`auth`/`public` function bodies and column defaults, and at most 64
ordinary/partitioned `auth`/`public` tables, at most 10,001 rows per table, in
read-only transactions with 5-second statement and 1-second lock timeouts.
It searches for the former managed project identifier (including hostnames and
pooler DSN usernames), outputs match counts,
and marks bounds/errors incomplete. Matches in historical user metadata,
instances, sessions or audit records do not establish an active Auth setting.
Never perform a global string replacement or delete data based on these counts.
Views, materialized views, RLS policies and trigger expressions are explicitly
outside the catalog search scope; absence in the searched scope is not proof
that no other database definition contains the reference. A changed service
start time, running state or restart count invalidates the collected evidence.

## Repair boundary

This increment adds inspection only. Diagnose the concrete discrepancy before
preparing a targeted configuration repair with backup, rollback and unchanged
non-Auth services. Do not repeat the old URL repair or deploy an application
image solely because mail fails. Do not change DB data/schema, DNS, JWT secrets,
rulesets or unrelated settings. Production-released Mercy must follow the repository's current canonical Global
Contract binding and branch-protection requirements. This diagnostic does not
waive or reinterpret any required project CI or production authorization gate.
The repository binding is synchronized to current Global 1.10.0. Since Global 1.9,
update-resolution applies canonical Global merges automatically to registered
consumers and does not require per-consumer acknowledgement. Reviewer runtime is resolved
separately from `Peerivo/global/contracts/reviewer-runtime.v1.json`; at this
binding sync the canonical runtime policy marks automatic Reviewer code review
as suspended and `requiredForMerge: false`. A later canonical runtime-policy
change supersedes this snapshot wording automatically.

Sources: [Supabase self-hosted Auth configuration](https://supabase.com/docs/guides/self-hosting/auth/config),
[Resend SMTP](https://resend.com/docs/send-with-smtp).
