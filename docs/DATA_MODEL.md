# Модель данных

`profiles` — приватное дополнение `auth.users`, без email. `staff_roles` — доверенные роли. `help_requests` принадлежит автору; `case_assignments` active row — источник доступа координатора. `messages` неизменяемы и дедуплицируются `(author_id, client_nonce)`. `support_steps` — совместный план. `organizations/service_locations` публикуются только после двойной проверки; confidential address запрещает адрес и геометрию. `volunteer_offers` приватны. `consents` имеют kind/version/accepted/revoked. `audit_events` не содержит content/contact/email/location. `identity_links` — только будущий контракт.

UUID устойчивы; timestamps — `timestamptz` UTC. B-tree индексы покрывают кейсы/чат/назначения, GiST — географию. Enum/status/check/length constraints защищают прямой API. SQL migrations — единственный источник схемы.
