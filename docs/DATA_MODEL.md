# Модель данных

`profiles` — приватное дополнение `auth.users`, без email. `staff_roles` — доверенные роли. `help_requests` принадлежит автору; `case_assignments` active row — источник доступа координатора. `messages` неизменяемы и дедуплицируются `(author_id, client_nonce)`. `support_steps` — совместный план. `organizations/service_locations` публикуются только после двойной проверки; confidential address запрещает адрес и геометрию. `volunteer_offers` приватны. `consents` имеют kind/version/accepted/revoked. `audit_events` не содержит content/contact/email/location. `identity_links` — только будущий контракт.

UUID устойчивы; timestamps — `timestamptz` UTC. B-tree индексы покрывают кейсы/чат/назначения, GiST — географию. Enum/status/check/length constraints защищают прямой API. SQL migrations — единственный источник схемы.

Медицинские исполнители, профессиональные профили, квалификационные документы и лицензирование не являются частью модели Mercy.

## Staff workspace projections
`staff_coordinators` is ADMIN-only and returns only a stable user UUID and an alias (or a safe UUID-derived label). `assignment_queue` returns the bounded routing minimum plus the active assignment, never case content. `coordinator_cases` returns a bounded page of active assignments for `auth.uid()`. The existing `case_assignments` active row and `can_access_case` remain the sole source of private case and chat access.

## Mercy v1 volunteer and role data — proposal in PR #243

- Auth uses confirmed email; an authenticated account is the base `USER`. `VISITOR` is derived from having created a help request. It is not a claim about government identity verification.
- `mercy_role_grants` records time-bounded `VOLUNTEER/CURATOR/PATRON/ADMIN` grants with actor, timestamp and mandatory reason, and revocation. Administrators may manage staff; curators may grant/revoke only volunteers and patrons. Bootstrap retains trusted existing `staff_roles`.
- `volunteer_profiles` contains service state, directions and online availability. `patron_profiles` stores `PERSON/SOLE_PROPRIETOR/LEGAL_ENTITY/GOVERNMENT` categories.
- `volunteer_contact_persons` is restricted to curator/admin workflows, requires confirmation of the contact person's consent, and never exposes contact data publicly.
- `volunteer_case_assignments` attaches one active volunteer per case with `REMOTE/PUBLIC_PLACE/HOME` task modes. Active role, active profile and active assignment are required to read/message that case. Revocation, incident suspension and completion close access.
- `volunteer_incidents` records suspension/review with a bounded description and no private contact data in audit events.
- No ESIA schema/identity integration and no Alexandra-specific home-visit intake, paired visit clearance or video-call prerequisites are installed by this migration.
- All new tables have RLS and table privileges revoked for public/anon/authenticated; allowed access is through bounded audited RPCs. No uncontrolled direct INSERT/UPDATE for volunteers.
- Code committed in **draft PR #243**, not merged, not applied in production. Production DB deployment requires the protected GitHub Actions migration workflow and its separate authorization.
