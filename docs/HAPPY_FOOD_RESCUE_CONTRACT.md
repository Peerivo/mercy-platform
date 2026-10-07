# Planned Happy Food Rescue integration

Status: **runtime adapter implemented, disabled by default**.

Mercy will be the social-help and last-mile side of the future Happy Food Rescue integration. Happy remains the owner of merchant surplus, paid rescue and food allocation.

Canonical semantic contract is owned by `Peerivo/happy`:

- repository: `Peerivo/happy`
- path: `contracts/food-rescue-mercy.v1.json`
- contract: `peerivo.happy.food-rescue.mercy`
- version: `1.0.0`
- implementation pin: `540220e2c20c452583c67d45f9459f0442ac2a2e`

The local planned consumer binding is `.peerivo/integrations/happy-food-rescue.v1.json`.

## Implemented adapter

`lib/happy-food-rescue.ts` now implements the Mercy -> Happy HTTPS event adapter for contract v1.

It is **off unless `HAPPY_FOOD_RESCUE_ENABLED=true`**. When enabled it additionally requires:

- `HAPPY_FOOD_RESCUE_URL` — HTTPS base URL for the Happy Food Rescue service;
- `HAPPY_FOOD_RESCUE_TOKEN` — dedicated integration bearer token, separate from ordinary user/application auth.

The adapter builds and sends privacy-safe, revisioned events for donation reservation upsert/release, donation outcome attestation, demand signals and rescue-mission disposition. It rejects known beneficiary/case/contact fields before network I/O.

## Live staging harness

Mercy contains an opt-in live staging harness at `tests/happy-food-rescue.staging-e2e.test.ts`. It is skipped unless `HAPPY_FOOD_RESCUE_STAGING_E2E=true`; ordinary CI therefore performs no external staging mutation and a green default CI run is **not** Happy/Mercy E2E evidence.

The harness is pinned to the Happy staging origin `https://happy-food-staging-staging.up.railway.app` and expected Happy deployment revision `0917bb8f7b43805f02242db8b70d1733da6c25f5`. Happy deployment run `37443496525` / job `112202637271` completed successfully for that revision. `HAPPY_FOOD_RESCUE_STAGING_REVISION` is only an operator assertion consumed by the harness; it is not remote revision attestation by itself, so accepted E2E evidence must also reference the independent Happy deployment evidence for the same revision.

The live runner requires runtime-only staging configuration:

- `HAPPY_FOOD_RESCUE_STAGING_E2E=true` — explicit opt-in;
- `HAPPY_FOOD_RESCUE_ENABLED=true` — enables the Mercy adapter for the run;
- `HAPPY_FOOD_RESCUE_URL=https://happy-food-staging-staging.up.railway.app` — exact allowlisted staging origin;
- `HAPPY_FOOD_RESCUE_STAGING_REVISION=0917bb8f7b43805f02242db8b70d1733da6c25f5` — expected deployed Happy revision;
- `HAPPY_FOOD_RESCUE_API_TOKEN` — merchant/pilot credential corresponding to Happy `FOOD_RESCUE_API_TOKEN`;
- `HAPPY_FOOD_RESCUE_TOKEN` — dedicated Mercy integration credential corresponding to Happy `FOOD_RESCUE_MERCY_TOKEN`.

The two bearer credentials must be different and least-privilege for their surfaces. Before the first mutating request, the harness fails if the credentials are equal, proves the integration credential receives `401 unauthorized` on the merchant surface using read-only `GET_CAPABILITIES`, and proves the merchant credential receives `401 unauthorized` on the Mercy integration surface using an intentionally invalid non-mutating envelope. Every live request has a bounded timeout and external JSON is schema-validated; error reporting exposes only HTTP status plus an allowlisted error code.

Canonical invocation:

```sh
npx vitest run tests/happy-food-rescue.staging-e2e.test.ts
```

Repository execution path: `.github/workflows/happy-food-rescue-staging-e2e.yml` is protected by the GitHub `staging` environment. It supports an explicit `workflow_dispatch` bound to the exact current `main` SHA and a one-shot `push main` trigger scoped only to `.deploy/happy-food-rescue-staging-e2e`. The PR #229 merge adds that marker once so the first non-skipped staging run can be produced without turning ordinary pushes or CI into external-mutation events. The workflow accepts either the Mercy-prefixed staging secret names or the compatible Happy names, but never writes credential values to the repository, summaries or logs.


A staging E2E claim is accepted only when all of the following are bound together: the exact Mercy head, the independently successful Happy staging deployment for the pinned origin/revision, a non-skipped harness run, both negative cross-surface `401` checks, and the successful create -> reserve -> replay -> partial-outcome -> quantity/accounting assertions. Harness presence, a skipped test, default CI, or a Vercel Preview must never be represented as completed staging E2E evidence.

It does **not** yet add Mercy database tables, user-facing Food Rescue UI, automatic matching/mission orchestration or Happy -> Mercy inbound event persistence.

## What Mercy will eventually do

Mercy may:

- match a donation tranche against an existing food-help request;
- route food to a verified NGO or redistribution point;
- create a volunteer/courier rescue mission;
- use separately authorized field outreach if regional policy permits it;
- return a bounded reservation to Happy while placement is being coordinated;
- return privacy-safe delivery/outcome attestation.

Mercy must not expose recipient identity or case details to Happy.

## Active search

A rescue mission is intentionally stronger than a passive listing.

If Happy reports safe food that is still unplaced, Mercy may actively coordinate a lawful recipient or destination.

An ordinary courier is never asked to choose a person because that person appears poor, homeless or otherwise vulnerable. Direct field outreach is a separate Mercy function requiring suitable authorization and regional rules.

If no suitable recipient/destination can be found before the safe deadline, Mercy reports `EXHAUSTED` and does not fabricate success.

## Existing Mercy model vs this contract

This contract does not reinterpret existing public help requests or volunteer offers as an already-working Food Rescue integration.

Future implementation must add explicit adapters/workflows and preserve existing RLS, consent, assignment and privacy boundaries.

No current Mercy table, RPC or user flow is modified by this adapter. The only runtime surface added in this increment is the disabled-by-default outbound integration client.

## Organization identity

The target model is one Peerivo organization identity reused across Happy and Mercy. A food business should not have to register a second organization just to donate.

Future enablement of donation will be an explicit capability/consent (planned name: `MERCY_DONOR`).

Public partner badges, cross-marketing or promotional use are separate consents.

## Money boundary

Mercy does not become a merchant-payment marketplace.

Paid food rescue and merchant commission remain in Happy. Donation has no Happy transaction commission.

If a sponsor or municipality funds last-mile delivery, Mercy may later consume an opaque transport-funding reference under a separate authorized implementation; this contract does not implement payment handling.

## Safety

Happy is authoritative for food lot safety cutoff and recall.

Mercy must stop handoff on a valid safety recall even if a recipient, volunteer or reservation already exists.

Regional food-safety/donation policy remains required before rollout.

## Implementation gate

Before runtime integration:

1. Happy Food Rescue must first prove its own lot lifecycle and quantity-conservation state machine;
2. the canonical contract must remain pinned to an immutable Happy commit/release;
3. the Mercy adapter must remain disabled until cross-system staging verification is green;
4. privacy, idempotency, reservation expiry and recall must be tested;
5. the regional policy must permit the exact donation/transport flow;
6. production enablement requires its own approvals.

Nothing in this document enables production integration.
