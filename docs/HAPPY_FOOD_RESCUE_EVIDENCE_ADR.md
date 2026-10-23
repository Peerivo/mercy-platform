# Mercy ↔ Happy Food Rescue: evidence and protected delivery (ADR, 2026-10-23)

Status: implemented in PR #256; activation requires green CI, production schema migration through the reviewed workflow, and exact-SHA Mercy deployment. A green CI or local test never proves a real beneficiary received food.

## Canonical separation

- **Food** owns offers, finite quantity, reservations, accounting, and the append-only Mercy event intake. Peerivo ID authenticates the user.
- **Mercy** owns human coordination, consent, identity, proof-of-handoff documents, and staff approvals. No private beneficiary or case details travel to Food.
- Existing region scope: GE-AJ. A reservation can be initiated by ADMIN/COORDINATOR after session-backed `current_staff_role()` verification.
- Only separate staff members may submit and approve the same evidence. Neither a self-reviewed document nor a free-text proof ID can trigger a Food accounting outcome.

## Workflow

1. Staff reserves an existing Food donation offer, receiving `reservation_...`. No fulfillment is inferred.
2. A staff member uploads a PDF, PNG or JPEG (100 bytes–5 MB) under a randomly generated private Storage object path, with byte-level type check and SHA-256.
3. Mercy stores an evidence record in `public.food_donation_evidence`, with RLS enabled, no anon/authenticated table grants or policies, and a unique reservation ID.
4. A **different** currently authorized staff member opens a short-lived signed URL (120 s) to review the private document, checks a review confirmation and approves it. At approval the binary SHA-256 is checked again.
5. A separate dispatch checks the stored binary checksum, claims the record, and sends a versioned privacy-safe `donation_outcome.attested` event to Food.
6. The event ID, timestamp, evidence ref and digest remain stable across network retries; a short in-flight lease and Food idempotency protect against duplicate accounting.
7. Only a successful Food acknowledgment moves the evidence record to SENT. A failed send returns to APPROVED and may be retried.

A photographed document must still be truthfully reviewed by the second staff member. Cryptographic integrity does not prove the real-world transfer by itself. A real beneficiary and actual donation are not created by synthetic QA test identities.

## Deployment and activation

- Database schema: `supabase/migrations/20261023184600_food_donation_evidence.sql`. This is *never* applied manually. Use the exact-main GitHub Actions `mercy-food-evidence-migrate.yml` with input `confirm=MIGRATE_MERCY_FOOD_EVIDENCE` and `expected_sha=<current 40-char main SHA>`.
- The workflow explicitly asserts RLS, denial of client direct reads, and private Storage bucket state. CI runs separate pgTAP checks on disposable Supabase.
- Mercy Next.js deploy: `.github/workflows/deploy-reg-ru.yml`, PREPARE then VERIFY, pinned exact main SHA. The REG.RU deployment may bind the existing Food Mercy token *locally on the same server* from `/opt/peerivo/happy-food/postgres/food-core.env` if no dedicated protected GitHub Environment token is set. The value is never copied into GitHub, logs or this repo. Candidate makes a credentialed, deliberately invalid (non-mutating) HTTP request to verify authentication boundary before release.
- Keep production evidence dispatch fail-closed until the schema is migrated and the live candidate handshake succeeds.
- Rollback: preserve previous Mercy container/env as the deployment script already does. Never reverse a DB migration by deleting submitted evidence; signed audit evidence remains private in Mercy. Keep existing Food QA/PostgreSQL rollback while incident response proceeds.

## Acceptance gates

- Staff role check: anonymous/member denied, admin/coordinator allowed.
- Independent review: submitting actor cannot approve their own evidence; tampered document SHA or missing Storage object prevents approval/dispatch.
- Persistent idempotency: retry with same event identity does not double-decrement Food inventory.
- Negative auth: wrong bearer token is rejected by Food; credentialed malformed payload is rejected by schema validation with 400.
- Public browsing: mobile/tablet/desktop no horizontal overflow; actual Watch end-to-end testing must be separately documented, not assumed based on curl.
- Final live status must distinguish deploy + migration + synthetic E2E from **verified real-world** handoff.
