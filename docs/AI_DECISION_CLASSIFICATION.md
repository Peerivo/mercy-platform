# Peerivo Mercy — safe decision classification (2026-10-08)

Status: policy only; no classification service is enabled or required by Mercy v1.

## Use case
For non-sensitive/public help-point metadata, a specialized small model can propose topic, destination department, urgency-review queue and a public content category. Fixed answer IDs belong to versioned local dictionaries. All human help requests remain available through the existing workflow when a classifier fails or abstains.

## Never delegate these decisions
- Accept/reject aid requests, emergency situations, vulnerability, trustworthiness or whether a person is "deserving".
- Appoint volunteers, reveal private addresses, disclose contact information, bypass consent, grant curator access or modify role permissions.
- Automatic user banning, sanctions, financial transfers or irreversible actions.

## Privacy and runtime
A remote PUBLIC endpoint must never receive unredacted help requests, health or disability details, user names, contact details, addresses or sensitive case records. LOCAL_ONLY or trusted consented private processing is required if classification needs sensitive information. No remote model is mandatory for the MVP; allow human curation and deterministic rules as the default.

If introduced in a later PR: use Peerivo Gateway as execution authorization and budget boundary; start shadow-only, measure group-specific errors and missing/urgent case misroutes, preserve source evidence, append-only audit, abstention and manual review. Model-provided confidence is not verified accuracy.

Current Mercy v1 role/email delivery remains **without ESIA** and does not acquire dependencies from the earlier Alexandra home-visit letter. Keep the open roles PR untouched. No DB migrations, service changes or merge in this PR.
