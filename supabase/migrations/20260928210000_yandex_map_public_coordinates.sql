-- Expose coordinates only for already public, verified, non-confidential
-- service locations so the optional Yandex map can render the same safe catalog.
create or replace view public.published_service_locations
with (security_invoker = true)
as
select
  l.id,
  o.name as organization_name,
  l.name,
  l.categories,
  l.country,
  l.city,
  l.address_public,
  l.languages,
  l.formats,
  l.cost_type,
  l.opening_hours,
  l.contact_public,
  l.last_verified_at,
  case
    when l.location is null then null
    else extensions.st_x(l.location::extensions.geometry)
  end as longitude,
  case
    when l.location is null then null
    else extensions.st_y(l.location::extensions.geometry)
  end as latitude
from public.service_locations as l
join public.organizations as o on o.id = l.organization_id
where l.review_status = 'VERIFIED'
  and l.published_at is not null
  and o.review_status = 'VERIFIED'
  and o.published_at is not null
  and not l.is_confidential_address;
