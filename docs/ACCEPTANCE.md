# Acceptance

## Automated status
- Unit validation: implemented.
- Clean temporary Supabase migration/RLS/Realtime integration: implemented as mandatory CI job without cloud credentials or silent skips; previously passed clean migrations and all 20 pgTAP assertions at `15b2a8e`, but requires a new full run for the corrected head.
- pgTAP: 20 schema/RLS/grant/default-privilege/publication assertions configured; NOT_RUN locally because Docker is unavailable.
- Auth/API/Realtime: 9 behavioral tests configured with isolated real user sessions in Node, including nonce conflicts, concurrent per-author quota, anonymous EXECUTE denial, PostgreSQL `system` readiness, two-second forbidden-event observation, denied C1 retry after reassignment, and self-contained open-socket reassignment/staff-role revocation scenarios; NOT_RUN for the corrected head locally because Docker is unavailable.
- Chromium: 2 production-build browser scenarios configured, including two contexts at 360 px, Quick Exit, ordinary History return and an assertion that Chromium really emitted `pageshow` with `persisted=true`; assertions cover removal of both private chat text and a restored form value, `/safe` loop avoidance, and explicit return.
- Chat catch-up regressions cover more than 100 rows, equal `created_at` values, a concurrent newer Realtime row, UUID deduplication and cancellation of stale responses.
- Local lint, typecheck, unit tests and production build must pass before publication; Docker-backed checks remain mandatory in CI and coverage is not weakened.

## Required behavioral run
On disposable Supabase create two users, two coordinators, one admin and explicitly fictional data. User A registers/signs in, creates request; admin queue exposes only number/category/city/urgency/status/time, assigns C1 with reason; A/C1 exchange idempotent messages; C1 adds step and valid status transition. User B direct/UI/API reads and mutations fail. Forged owner/author/role/assignment/status fail. Unassigned C2 fails. Reassign to C2: C1 history SELECT/message INSERT and subsequent Realtime delivery fail; C2 works. Reconnect queries after cursor and deduplicates nonce.

Catalog test publishes only verified organization+point; pending rows fail view and geo RPC. Known coordinates verify ordering/distance tolerance, radius and pagination. Denied location and tile error retain list. Confidential shelter insert with coordinates/address fails.

At 360px and keyboard-only verify labels, focus, contrast, loading/error/empty states. Quick exit must not wait for network, must neutralize Back/BFCache rendering, and warns browser history remains.

## Before real cases
Not accepted until staging integration/e2e, staff CRUD UI, deletion operational SLA, verified local emergency/catalog data, coordinator staffing/hours/response expectation, incident response, security/privacy/legal review, backups and monitoring are approved.
