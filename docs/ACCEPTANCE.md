# Acceptance

## Automated status
- Unit validation: implemented.
- Clean temporary Supabase migration/RLS/Realtime integration: implemented as mandatory CI job without cloud credentials or silent skips; previously passed clean migrations and all 20 pgTAP assertions at `15b2a8e`, but requires a new full run for the corrected head.
- pgTAP: 20 schema/RLS/grant/default-privilege/publication assertions configured; NOT_RUN locally because Docker is unavailable.
- Auth/API/Realtime: 9 behavioral tests configured with isolated real user sessions in Node, including nonce conflicts, concurrent per-author quota, anonymous EXECUTE denial, and self-contained open-socket reassignment and staff-role revocation scenarios; NOT_RUN for the corrected head locally because Docker is unavailable.
- Chromium: 2 browser scenarios configured, including two contexts, 360 px and Quick Exit/Back/BFCache.
- Local lint (no errors, two existing warnings), typecheck, 3 unit tests and build are VERIFIED on 2026-09-12 after the fixture/session/scenario fixes. The local runtime was Node 20 rather than the required CI Node 22; Docker-backed checks remain NOT_RUN for the new head and CI coverage is not weakened.

## Required behavioral run
On disposable Supabase create two users, two coordinators, one admin and explicitly fictional data. User A registers/signs in, creates request; admin queue exposes only number/category/city/urgency/status/time, assigns C1 with reason; A/C1 exchange idempotent messages; C1 adds step and valid status transition. User B direct/UI/API reads and mutations fail. Forged owner/author/role/assignment/status fail. Unassigned C2 fails. Reassign to C2: C1 history SELECT/message INSERT and subsequent Realtime delivery fail; C2 works. Reconnect queries after cursor and deduplicates nonce.

Catalog test publishes only verified organization+point; pending rows fail view and geo RPC. Known coordinates verify ordering/distance tolerance, radius and pagination. Denied location and tile error retain list. Confidential shelter insert with coordinates/address fails.

At 360px and keyboard-only verify labels, focus, contrast, loading/error/empty states. Quick exit must not wait for network, must neutralize Back/BFCache rendering, and warns browser history remains.

## Before real cases
Not accepted until staging integration/e2e, staff CRUD UI, deletion operational SLA, verified local emergency/catalog data, coordinator staffing/hours/response expectation, incident response, security/privacy/legal review, backups and monitoring are approved.
