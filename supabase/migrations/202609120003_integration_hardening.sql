-- Security and idempotency corrections found while building the disposable-stack suite.
create or replace function public.is_active_coordinator(case_id uuid,uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.case_assignments a
    join public.staff_roles r on r.user_id=a.coordinator_id and r.role='COORDINATOR'
    where a.help_request_id=case_id and a.coordinator_id=uid and a.revoked_at is null
  )
$$;

create function public.send_message(case_id uuid, message_body text, message_nonce uuid)
returns public.messages
language plpgsql security definer set search_path = ''
as $$
declare result public.messages;
begin
  if auth.uid() is null or not public.can_access_case(case_id, auth.uid()) then
    raise exception 'access denied';
  end if;
  if length(trim(message_body)) not between 1 and 4000 then
    raise exception 'invalid message';
  end if;
  -- Serialize retries for one author/nonce. A retry after an uncertain response
  -- returns the original row and never leaks a nonce belonging to another user.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || message_nonce::text, 0));
  select * into result from public.messages
    where author_id = auth.uid() and client_nonce = message_nonce;
  if found then return result; end if;
  if (select count(*) from public.messages
      where author_id = auth.uid() and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'rate limit';
  end if;
  insert into public.messages(help_request_id, author_id, client_nonce, body)
    values(case_id, auth.uid(), message_nonce, trim(message_body)) returning * into result;
  return result;
end $$;
revoke all on function public.send_message(uuid,text,uuid) from public;
grant execute on function public.send_message(uuid,text,uuid) to authenticated;

-- Writes must use the narrow RPC above; owner/author/case fields are never client writable.
revoke insert on public.messages from authenticated;
drop policy message_insert on public.messages;

create function public.set_staff_role(target_user uuid, target_role public.staff_role, enabled boolean, reason_text text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  if length(trim(reason_text)) < 3 then raise exception 'reason required'; end if;
  if not exists(select 1 from auth.users where id = target_user) then raise exception 'user not found'; end if;
  if enabled then
    insert into public.staff_roles(user_id, role, granted_by) values(target_user,target_role,auth.uid())
      on conflict (user_id,role) do nothing;
  else
    delete from public.staff_roles where user_id=target_user and role=target_role;
  end if;
  insert into public.audit_events(actor_id,action,object_type,object_id,reason)
    values(auth.uid(),case when enabled then 'STAFF_ROLE_GRANTED' else 'STAFF_ROLE_REVOKED' end,
      'user',target_user,left(reason_text,500));
end $$;
revoke all on function public.set_staff_role(uuid,public.staff_role,boolean,text) from public;
grant execute on function public.set_staff_role(uuid,public.staff_role,boolean,text) to authenticated;

-- Prevent direct publication changes even from an accidentally broader table grant.
create function public.enforce_catalog_review() returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.published_at is not null or new.review_status = 'VERIFIED')
     and coalesce(auth.role(),'') <> 'service_role' and not public.is_admin() then
    raise exception 'admin required to publish catalog data';
  end if;
  return new;
end $$;
create trigger organizations_review_guard before insert or update on public.organizations
  for each row execute function public.enforce_catalog_review();
create trigger locations_review_guard before insert or update on public.service_locations
  for each row execute function public.enforce_catalog_review();
