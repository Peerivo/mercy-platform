# Planned Happy Food Rescue integration

Status: **contract only / not implemented**.

Mercy will be the social-help and last-mile side of the future Happy Food Rescue integration. Happy remains the owner of merchant surplus, paid rescue and food allocation.

Canonical semantic contract is owned by `Peerivo/happy`:

- repository: `Peerivo/happy`
- path: `contracts/food-rescue-mercy.v1.json`
- contract: `peerivo.happy.food-rescue.mercy`
- version: `1.0.0`
- immutable contract pin: `734df94d8dc53ed46e97eec8abca0b95838340e9`

The local planned consumer binding is `.peerivo/integrations/happy-food-rescue.v1.json`.

## What Mercy will eventually do

When implemented in a later task, Mercy may:

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

No current Mercy table, RPC, route or user flow is modified by this contract.

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
2. the canonical contract must be pinned to an immutable Happy commit/release;
3. Mercy adapters must be implemented in a separate reviewed increment;
4. privacy, idempotency, reservation expiry and recall must be tested;
5. the regional policy must permit the exact donation/transport flow;
6. production enablement requires its own approvals.

Nothing in this document enables the integration.
