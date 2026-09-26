# Модель данных

`profiles` — приватное дополнение `auth.users`, без email. `staff_roles` — доверенные роли. `help_requests` принадлежит автору; `case_assignments` active row — источник доступа координатора. `messages` неизменяемы и дедуплицируются `(author_id, client_nonce)`. `support_steps` — совместный план. `organizations/service_locations` публикуются только после двойной проверки; confidential address запрещает адрес и геометрию. `volunteer_offers` приватны. `consents` имеют kind/version/accepted/revoked. `audit_events` не содержит content/contact/email/location. `identity_links` — только будущий контракт.

UUID устойчивы; timestamps — `timestamptz` UTC. B-tree индексы покрывают кейсы/чат/назначения, GiST — географию. Enum/status/check/length constraints защищают прямой API. SQL migrations — единственный источник схемы.

Медицинские исполнители, профессиональные профили, квалификационные документы и лицензирование не являются частью модели Mercy.

## Staff workspace projections
`staff_coordinators` is ADMIN-only and returns only a stable user UUID and an alias (or a safe UUID-derived label). `assignment_queue` returns the bounded routing minimum plus the active assignment, never case content. `coordinator_cases` returns a bounded page of active assignments for `auth.uid()`. The existing `case_assignments` active row and `can_access_case` remain the sole source of private case and chat access.

## Resource sharing extensions

Resource sharing is modeled as an extension of Mercy's request/offer/case flow, not as a separate local database or warehouse system.

### Request taxonomy

`help_requests` may support resource-oriented categories such as:

- `need_item_temporarily` — borrow an item for a limited time;
- `need_item_permanently` — receive an item as a donation;
- `need_delivery_for_item` — help move an item;
- `need_resource_match` — find an equivalent acceptable item.

### Resource offers

A future `resource_offers` table may describe things that people or partners can share.

Key fields:

- owner profile id;
- title/category/description;
- photos;
- lend/give mode;
- custody mode;
- city/area;
- availability window;
- pickup/delivery options;
- condition;
- risk class;
- moderation status;
- public-safe summary;
- private contact and address fields protected by case access.

### Custody modes

- `owner_held` — item remains with owner;
- `owner_can_deliver` — owner can deliver;
- `borrower_pickup` — recipient can pick up after approval;
- `volunteer_mediated` — volunteer handles handoff;
- `point_held` — stored at a trusted point;
- `partner_held` — held by organization/partner;
- `event_pool` — available at a scheduled event.

### Handoff cases

A future `resource_handoffs` or support-step projection links:

- one need;
- one offer or matched item;
- optional delivery volunteer;
- coordinator approval;
- private handoff details;
- transfer status;
- due/return status for borrowed items;
- final close reason.

### Bridge to Peerivo Things

Mercy stores the help case and moderated handoff. Peerivo Things should receive or own durable inventory records only when a resource becomes a reusable tracked unit with QR, condition checks, loans, returns, maintenance, cells, and audit events.

The bridge is:

`Mercy resource need/offer -> handoff case -> optional tracked ThingUnit`.

No volunteer, city coordinator, or partner should maintain a separate local database, spreadsheet as source of truth, or manual SQL process.
