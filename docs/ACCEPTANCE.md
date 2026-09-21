# Acceptance

## Automated status
- Unit validation: help request, request-safety review, volunteer offer, moderation and staff workspace schemas are covered. Specialist/provider validation is intentionally absent because that contour is not part of Mercy.
- Clean temporary Supabase migration/RLS/Realtime integration is mandatory in CI and runs without cloud credentials or silent skips.
- pgTAP: 32 schema/RLS/grant/default-privilege/publication assertions, including explicit checks that `specialist_profiles`, qualification documents, the specialist projection and specialist RPCs do not exist after clean migration replay.
- Auth/API/Realtime: 10 behavioral tests with isolated real user sessions, including nonce conflicts, concurrent per-author quota, anonymous EXECUTE denial, PostgreSQL readiness, denied access after reassignment, and open-socket reassignment/staff-role revocation scenarios.
- Chromium: production-build browser acceptance covers session isolation, request/chat flows, Quick Exit, ordinary Back/BFCache safety, responsive shell, icon metadata and horizontal-overflow protection.
- Local lint, typecheck, unit tests and production build must pass before publication; Docker-backed checks remain mandatory in CI and coverage is not weakened.
- Responsive shell: header and main content use the same bounded container with 16/24/40/56 px inline padding at the 0/640/1024/1440 px breakpoints.

## Mercy product boundary
Mercy contains public help requests with private contact data, owner actions, staff coordination, volunteer offers, complaint moderation and a verified organization/location catalog.

Mercy does **not** contain professional or medical provider profiles, qualification documents, licence verification, medical booking, provider matching, payments, commissions, ratings or a medical marketplace. Clean migration replay must end with those specialist/provider database objects absent.

## Required behavioral run
On disposable Supabase create users, coordinators, one admin and explicitly fictional data. User A registers/signs in and creates a request; it is not public while PENDING. The dedicated ADMIN moderation queue exposes the bounded review payload, a non-admin cannot moderate, and approval/rejection is audited. Requests for another beneficiary require confirmed consent; HOME_VISIT requires requester identity confirmation and remains closed to direct volunteer responses. The assignment queue still exposes only routing minimum and assigns a coordinator with reason; owner/coordinator exchange idempotent messages and perform valid status transitions. Another user, unassigned coordinators and forged ownership/author/role/assignment mutations fail.

Reassignment must revoke the previous coordinator's RLS/Realtime access and grant the new coordinator access. Staff-role revocation must likewise remove access from existing and reconnected Realtime subscriptions.

Catalog tests publish only verified organization+point records; pending rows stay hidden. Known coordinates verify ordering/distance, radius and pagination. Confidential locations never expose protected addresses.

At mobile width and keyboard-only, labels, focus, loading/error/empty states and horizontal overflow remain usable. Quick Exit must not wait for network and must prevent private content/session recovery through Back/BFCache behavior.

## Request Trust & Safety

A new help request has no public publication timestamp until ADMIN review. Public list/detail and direct response fail closed. Owner/active coordinator can still access a pending private card. Review transitions are single-use PENDING → VERIFIED/REJECTED, require a bounded reason and never copy request content/contact into audit. HOME_VISIT direct response is denied at the database RPC, not only in UI. Staff notification email contains no request content.

## Volunteer offer MVP
A user creates an offer only through the atomic RPC: owner identity comes from JWT, bounded payload/rate limits are checked, and consent is recorded. Direct INSERT is revoked. RLS exposes a row only to its owner and ADMIN; creating an offer never grants staff privileges. ADMIN moderation requires a reason and writes audit data without copying private contact/description into the audit log.

## Production launch gate
Before LIVE: apply migration history to the explicitly identified Supabase project through the protected GitHub Actions workflow, verify backup/restore, Auth Site URL/redirect+SMTP/email confirmation, Realtime publication, trusted ADMIN bootstrap, immutable image SHA and smoke tests. No manual `supabase db push` is part of the production procedure.
