-- Просьбы о помощи публичны,
-- но приватные поля владельца и контактов не выдаются через Data API.

revoke select on table public.help_requests
from anon, authenticated;

grant select (
  id,
  case_number,
  category,
  country,
  city,
  description,
  urgency,
  status,
  created_at
)
on table public.help_requests
to anon, authenticated;

drop policy if exists case_public_read
on public.help_requests;

create policy case_public_read
on public.help_requests
for select
to anon, authenticated
using (true);