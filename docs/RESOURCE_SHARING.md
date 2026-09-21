# Resource Sharing / Вещи рядом

Status: v0 product direction for Mercy.

Mercy resource sharing starts as a **virtual-first layer of needs and available resources**, not as a warehouse. A physical Library of Things point is a later custody mode, enabled only where real demand, volunteers, and repeatable inventory justify it.

## Core decision

Do not start by building a склад.

Start with three Mercy-native actions:

1. **Нужна вещь** — a person needs an item temporarily or permanently.
2. **Могу поделиться** — a person can lend, give away, or make an item available.
3. **Могу доставить** — a volunteer can help move an item between people or a trusted point.

This makes Things part of Mercy's help flow:

```text
need -> offer -> coordinator/moderation -> handoff -> return or close
```

## Why virtual-first

Most useful things already sit somewhere:

- at a person's home;
- in a garage;
- in an office;
- at a parish or volunteer center;
- at a partner organization;
- in a workshop;
- with a company that can lend or donate.

Forcing all of them into a warehouse creates cost and delay before demand is proven. The first version should discover what people actually need and what people are already willing to share.

## Custody modes

Every resource offer has a custody mode.

### `owner_held`

The item remains with the owner. This is the default v0 mode.

### `owner_can_deliver`

The owner is willing to deliver within stated limits.

### `borrower_pickup`

The recipient can pick up the item. Private address details are shared only after approval and only to the involved parties.

### `volunteer_mediated`

A volunteer collects and delivers the item, or acts as an intermediate trusted handoff.

### `point_held`

The item is stored at a trusted Mercy/Things point with shelves, cells, QR labels, and staff workflows.

### `partner_held`

The item is held by a parish, charity, workshop, office, library, or other partner.

### `event_pool`

The item is available through a scheduled event such as Mercy Saturday, collection day, repair day, or seasonal distribution.

## Request types

Resource-related Mercy cases may be:

- `need_item_temporarily` — borrow for a limited period;
- `need_item_permanently` — receive as a donation;
- `offer_lend_item` — lend an item;
- `offer_give_item` — give an item away;
- `offer_delivery` — help transport a resource;
- `offer_storage_point` — provide a controlled place for local resource storage.

## User flows

### Person needs an item

1. User chooses `Нужна вещь`.
2. User enters item, city/area, duration, urgency, pickup/delivery constraints, and whether an equivalent item is acceptable.
3. The request enters normal Mercy moderation.
4. Matching may surface existing resource offers.
5. Coordinator approves a safe handoff path.
6. Case closes after transfer or return.

### Person can share an item

1. User chooses `Могу поделиться`.
2. User enters item, photos, lend/give mode, condition, location area, delivery/pickup options, duration, restrictions, and safety notes.
3. Offer is moderated before public discovery.
4. Contact/address is private until a handoff is approved.
5. Offer may match an existing need or wait in local discovery.

### Volunteer can deliver

1. Volunteer chooses `Могу доставить`.
2. Volunteer states area, times, transport limitations, and capacity.
3. Coordinator assigns only approved handoff cases.
4. Volunteer sees only the minimum required details.

## Public discovery

Public users may see safe summaries:

- item name;
- city/area;
- lend/give mode;
- approximate availability;
- whether delivery/pickup is possible;
- moderated description and photo if approved.

Public users must not see:

- private addresses;
- private contacts;
- exact geolocation of a home;
- internal notes;
- identity documents;
- dispute information.

## Physical point trigger

A physical Library of Things point should be opened only when there is evidence:

- repeated demand for the same categories;
- enough offers to justify shared custody;
- at least one reliable coordinator;
- a safe room/shelf/partner location;
- clear opening hours;
- willingness to handle returns and maintenance;
- risk categories that benefit from check-in/check-out control.

Until then, virtual owner-held and volunteer-mediated handoffs are preferred.

## Relation to Peerivo Things

Mercy owns the help case and moderation flow.

Peerivo Things owns the durable inventory model when an item becomes a reusable tracked unit with condition checks, QR labels, cells, loans, returns, maintenance, and audit trail.

The bridge is:

```text
Mercy resource need/offer -> handoff case -> optional ThingUnit when repeated reuse is proven
```

## Safety and exclusions

Blocked or restricted by default:

- weapons;
- pyrotechnics;
- hazardous chemicals;
- medicines and controlled substances;
- medical devices and professional medical services;
- gas equipment;
- unsafe electrical equipment;
- anything requiring licensing or specialist qualification;
- items that expose vulnerable people to unsafe private meetings.

Risky but possible later with additional policy:

- power tools;
- ladders;
- heaters;
- baby equipment;
- expensive electronics;
- transport of bulky goods.

## v0 implementation order

1. Add category `Вещи` to Mercy's request/offer taxonomy.
2. Add actions `Нужна вещь`, `Могу поделиться`, `Могу доставить`.
3. Keep all records in the single Mercy application database.
4. Add moderation and private-contact rules before public discovery.
5. Add simple matching by city/area/category.
6. Add handoff/return status steps.
7. Promote repeated items to Peerivo Things tracked units only after real usage.
