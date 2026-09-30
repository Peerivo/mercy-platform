# Модель данных

`profiles` — приватное дополнение `auth.users`, без email. `staff_roles` — доверенные роли. `help_requests` принадлежит автору; `case_assignments` active row — источник доступа координатора. `messages` неизменяемы и дедуплицируются `(author_id, client_nonce)`. `support_steps` — совместный план. `organizations/service_locations` публикуются только после двойной проверки; confidential address запрещает адрес и геометрию. `volunteer_offers` приватны. `consents` имеют kind/version/accepted/revoked. `audit_events` не содержит content/contact/email/location. `identity_links` — только будущий контракт.

UUID устойчивы; timestamps — `timestamptz` UTC. B-tree индексы покрывают кейсы/чат/назначения, GiST — географию. Enum/status/check/length constraints защищают прямой API. SQL migrations — единственный источник схемы.

Медицинские исполнители, профессиональные профили, квалификационные документы и лицензирование не являются частью модели Mercy.

## Staff workspace projections
`staff_coordinators` is ADMIN-only and returns only a stable user UUID and an alias (or a safe UUID-derived label). `assignment_queue` returns the bounded routing minimum plus the active assignment, never case content. `coordinator_cases` returns a bounded page of active assignments for `auth.uid()`. The existing `case_assignments` active row and `can_access_case` remain the sole source of private case and chat access.

## Mercy roles and volunteer service

Mercy separates authentication, identity verification and authorization.

- **USER / Пользователь** is implicit for any signed-in `auth.users` account. Email login alone never grants staff or volunteer privileges.
- **VISITOR / Посетитель** is a derived identity state: an account has an active `identity_links` row with provider `ESIA`. It is not a mutable user-selected role.
- **VOLUNTEER / Волонтёр**, **CURATOR / Куратор**, **PATRON / Меценат** and **ADMIN** are audited grants in `mercy_role_grants`. New VOLUNTEER, CURATOR and ordinary ADMIN grants require an active ESIA identity link. PATRON requires a registered account and curator/admin grant but does not require ESIA.
- A curator may grant/revoke only VOLUNTEER and PATRON. Only an ADMIN may grant/revoke CURATOR or ADMIN.
- PATRON has a required type: PERSON, SOLE_PROPRIETOR, LEGAL_ENTITY or GOVERNMENT.
- Legacy `staff_roles.COORDINATOR` remains a compatibility projection of CURATOR and `staff_roles.ADMIN` remains a compatibility projection of ADMIN while the existing staff workspace is migrated.

Authorization is evaluated from database state rather than user-controlled JWT metadata. Revocation therefore takes effect without waiting for a token refresh.

### Volunteer safety model

`volunteer_profiles` tracks service state, categories, online availability, supervision and a separate home-visit clearance. A volunteer receives private case access only while all of the following are true: ESIA is active, VOLUNTEER grant is active, service status is ACTIVE, and an active `volunteer_case_assignments` row exists for that exact request.

`volunteer_contact_persons` stores curator-linked contact persons only after explicit confirmation that the contact person consented. These records are RPC-only and never public.

`help_request_safety` records whether the requester is the beneficiary, the beneficiary's consent state and whether a home visit is approved. A HOME_PAIRED assignment fails closed unless beneficiary consent is either not separately required (requester is beneficiary) or confirmed, the request is approved for a home visit, the volunteer has home-visit clearance, and a second verified participant is present. When the UI omits a separate companion, the assigned ESIA-verified curator is the second participant.

`volunteer_incidents` provides the conflict/safety path requested by volunteer organizations. Opening an incident changes the volunteer service status to SUSPENDED, which immediately removes private case access. Resolving the incident does not automatically restore access: a curator or administrator must explicitly reactivate the volunteer after review.

An assigned volunteer may read the exact assigned request, its shared plan and chat. That access does **not** permit changing the request lifecycle and does not expose other responders' messages/contact methods. Owners and active curators retain those controls.

The application is ready to consume an ESIA identity adapter through `identity_links`, but this schema change does not claim that the external ESIA OAuth/OIDC integration is already provisioned.



## Home-visit safety
ESIA identity verification and home-visit safety are separate controls. `help_request_safety`
stores requester-declared household, animal, smoke and access conditions, an optional trusted
contact, video-call status and curator approval. These fields stay outside public request
projections and are available only through bounded authenticated RPCs to people who need them
for the case.

`volunteer_profiles` stores home-visit compatibility limits for dogs, cats, smoke and a
bounded free-text limitation note. A paired home assignment fails closed when required
conditions, consent, curator approval or a declared-possible preliminary video call are missing,
and when recorded volunteer restrictions conflict with the home conditions. ESIA identity
verification does not satisfy these visit-safety checks.
