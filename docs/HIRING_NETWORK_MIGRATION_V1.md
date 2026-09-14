# Hiring Network transfer contract — v1

This is a future transfer contract, not a live integration. Mercy remains authoritative and available without Network connectivity; it makes no Network requests and creates no synthetic external IDs.

## Identity and idempotency

Every consented export carries `contract_version: "mercy-specialist-v1"`, `source_system: "mercy"`, and stable `specialist_profiles.id` as `source_profile_id`. Network must upsert by `(source_system, source_profile_id)`, making retries duplicate-safe. A link may be recorded only after the user proves control of both accounts and explicitly accepts the current `IDENTITY_INTEGRATION` consent. A matching name, email, or telephone is never proof.

## Mapping and exclusions

Professional fields are display name, description, country, city/travel area, specializations, services, languages, and work formats. Mercy publication and qualification decisions remain scoped, timestamped Mercy assertions, not portable Network credentials. Contacts transfer only with their explicit visibility setting. Auth credentials, help requests, patient/client data, audit reasons, hidden contacts, and qualification document files or paths never enter the public export.

## Cutover and rollback

1. Mercy starts as source of truth and records no link before verified linking and consent.
2. An idempotent shadow export is compared while Mercy serves all reads and writes.
3. Authority switches per field group; the active source and accepted version must be recorded.
4. Conflicts stop automation and require the owner or an authorized reviewer.
5. Rollback restores Mercy read/write authority from its retained version, revokes the link, and stops export without automatically deleting either account.

The optional `network_identity_id` and `network_linked_at` fields are server-controlled compatibility fields. This application version never populates them.
