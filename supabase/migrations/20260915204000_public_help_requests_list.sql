create or replace function public.list_public_help_requests(
  category_filter text default null,
  city_filter text default null,
  urgency_filter text default null,
  state_filter text default 'ACTIVE',
  result_limit int default 20,
  result_offset int default 0
)
returns table (
  id uuid,
  case_number bigint,
  category text,
  country text,
  city text,
  description text,
  urgency text,
  status public.request_status,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_category text :=
    nullif(trim(category_filter), '');

  normalized_city text :=
    nullif(trim(city_filter), '');

  normalized_urgency text :=
    nullif(trim(urgency_filter), '');

  normalized_state text :=
    upper(
      coalesce(
        nullif(trim(state_filter), ''),
        'ACTIVE'
      )
    );
begin
  if normalized_category is not null
     and normalized_category not in (
       'PREGNANCY',
       'FAMILY',
       'HOUSING',
       'FOOD_GOODS',
       'LEGAL_DOCUMENTS',
       'WORK_EDUCATION',
       'OTHER'
     ) then
    raise exception 'invalid category';
  end if;

  if normalized_urgency is not null
     and normalized_urgency not in (
       'NORMAL',
       'SOON',
       'URGENT'
     ) then
    raise exception 'invalid urgency';
  end if;

  if normalized_state not in (
    'ACTIVE',
    'COMPLETED',
    'ALL'
  ) then
    raise exception 'invalid state';
  end if;

  return query
  select
    h.id,
    h.case_number,
    h.category::text,
    h.country::text,
    h.city::text,
    h.description::text,
    h.urgency::text,
    h.status,
    h.created_at
  from public.help_requests h
  where
    (
      normalized_category is null
      or h.category = normalized_category
    )
    and (
      normalized_city is null
      or lower(h.city)
        like '%' || lower(normalized_city) || '%'
    )
    and (
      normalized_urgency is null
      or h.urgency = normalized_urgency
    )
    and (
      normalized_state = 'ALL'

      or (
        normalized_state = 'ACTIVE'
        and h.status not in (
          'RESOLVED',
          'CLOSED'
        )
      )

      or (
        normalized_state = 'COMPLETED'
        and h.status in (
          'RESOLVED',
          'CLOSED'
        )
      )
    )
  order by
    case h.urgency
      when 'URGENT' then 0
      when 'SOON' then 1
      else 2
    end,
    h.created_at desc
  limit least(
    greatest(result_limit, 1),
    50
  )
  offset greatest(result_offset, 0);
end;
$$;

revoke all
on function public.list_public_help_requests(
  text,
  text,
  text,
  text,
  int,
  int
)
from public;

grant execute
on function public.list_public_help_requests(
  text,
  text,
  text,
  text,
  int,
  int
)
to anon, authenticated;