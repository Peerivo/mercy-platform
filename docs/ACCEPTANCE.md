# Acceptance

## Automated status
- Unit validation: implemented.
- Clean temporary Supabase migration/RLS/Realtime integration: mandatory CI job; not silently skipped.
- Lint/typecheck/unit/build: passed locally; Docker and Supabase integration unavailable because this environment has no Docker.

## RPC EXECUTE regression status
### VERIFIED
- pgTAP diagnoses `anon` and `authenticated` independently for each private RPC/helper.
- Public nearby search remains available to both API roles; bootstrap and trigger implementation remain unavailable.

### FAILED
- None after a successful local run; keep any discovered failures here until fixed.

### NOT_RUN
- PostgREST/Auth/Realtime/Playwright results must be tied to the published commit in the mandatory integration job, not inferred from a local SHA.

## Required behavioral run
On disposable Supabase create two users, two coordinators, one admin and explicitly fictional data. User A registers/signs in, creates request; admin queue exposes only number/category/city/urgency/status/time, assigns C1 with reason; A/C1 exchange idempotent messages; C1 adds step and valid status transition. User B direct/UI/API reads and mutations fail. Forged owner/author/role/assignment/status fail. Unassigned C2 fails. Reassign to C2: C1 history SELECT/message INSERT and subsequent Realtime delivery fail; C2 works. Reconnect queries after cursor and deduplicates nonce.

Catalog test publishes only verified organization+point; pending rows fail view and geo RPC. Known coordinates verify ordering/distance tolerance, radius and pagination. Denied location and tile error retain list. Confidential shelter insert with coordinates/address fails.

At 360px and keyboard-only verify labels, focus, contrast, loading/error/empty states. Quick exit must not wait for network, must neutralize Back/BFCache rendering, and warns browser history remains.

## Before real cases
Not accepted until staging integration/e2e, staff CRUD UI, deletion operational SLA, verified local emergency/catalog data, coordinator staffing/hours/response expectation, incident response, security/privacy/legal review, backups and monitoring are approved.
