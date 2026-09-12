# Acceptance

## Automated status
- Unit validation: implemented.
- Clean temporary Supabase migration/RLS/Realtime integration: implemented as mandatory CI job without cloud credentials or silent skips; awaiting an actual Docker runner result for the latest SHA.
- pgTAP: 13 schema/RLS/grant/publication assertions configured; RLS flags are read from `pg_class.relrowsecurity` independently of the test role's bypass capability.
- Auth/API/Realtime: 9 behavioral tests configured with real user sessions, including case/body-bound nonce conflicts, retry denial after access loss, a concurrent DB rate-limit boundary and open-socket/reconnect revocation scenarios for both assignment and staff role.
- Chromium: 2 browser scenarios configured, including two contexts, 360 px and Quick Exit/Back/BFCache.
- Local lint/typecheck/unit/build results belong in the final run report; Docker availability is reported separately and never turns off CI coverage.

## Required behavioral run
On disposable Supabase create three users (including one isolated quota actor), two coordinators, one admin and explicitly fictional data. User A registers/signs in, creates request; admin queue exposes only number/category/city/urgency/status/time, assigns C1 with reason; A/C1 exchange idempotent messages; C1 adds step and valid status transition. User B direct/UI/API reads and mutations fail. Forged owner/author/role/assignment/status fail. Unassigned C2 fails. Reassign to C2: C1 history SELECT/message INSERT and subsequent Realtime delivery fail; C2 works. Reconnect queries after cursor and deduplicates nonce.

Catalog test publishes only verified organization+point; pending rows fail view and geo RPC. Known coordinates verify ordering/distance tolerance, radius and pagination. Denied location and tile error retain list. Confidential shelter insert with coordinates/address fails.

At 360px and keyboard-only verify labels, focus, contrast, loading/error/empty states. Quick exit must not wait for network, must neutralize Back/BFCache rendering, and warns browser history remains.

## Before real cases
Not accepted until staging integration/e2e, staff CRUD UI, deletion operational SLA, verified local emergency/catalog data, coordinator staffing/hours/response expectation, incident response, security/privacy/legal review, backups and monitoring are approved.
