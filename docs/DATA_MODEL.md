# Модель данных

`profiles` — приватное дополнение `auth.users`, без email. `staff_roles` — доверенные роли. `help_requests` принадлежит автору; `case_assignments` active row — источник доступа координатора. `messages` неизменяемы и дедуплицируются `(author_id, client_nonce)`. `support_steps` — совместный план. `organizations/service_locations` публикуются только после двойной проверки; confidential address запрещает адрес и геометрию. `volunteer_offers` приватны. `consents` имеют kind/version/accepted/revoked. `audit_events` не содержит content/contact/email/location. `identity_links` — только будущий контракт.

UUID устойчивы; timestamps — `timestamptz` UTC. B-tree индексы покрывают кейсы/чат/назначения, GiST — географию. Enum/status/check/length constraints защищают прямой API. SQL migrations — единственный источник схемы.

Медицинские исполнители, профессиональные профили, квалификационные документы и лицензирование не являются частью модели Mercy.

## Staff workspace projections
`staff_coordinators` is ADMIN-only and returns only a stable user UUID and an alias (or a safe UUID-derived label). `assignment_queue` returns the bounded routing minimum plus the active assignment, never case content. `coordinator_cases` returns a bounded page of active assignments for `auth.uid()`. The existing `case_assignments` active row and `can_access_case` remain the sole source of private case and chat access.
