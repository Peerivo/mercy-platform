-- Keep message retries case-bound and serialize the per-author rolling quota.
create or replace function public.send_message(case_id uuid, message_body text, message_nonce uuid)
returns public.messages
language plpgsql security definer set search_path = ''
as $$
declare
  result public.messages;
  normalized_body text := trim(message_body);
begin
  if auth.uid() is null or not public.can_access_case(case_id, auth.uid()) then
    raise exception 'access denied';
  end if;
  if length(normalized_body) not between 1 and 4000 then
    raise exception 'invalid message';
  end if;

  -- All new messages by an author share a transaction lock, making the rolling
  -- count and insert atomic even when concurrent requests use different nonces.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

  select * into result
  from public.messages
  where author_id = auth.uid() and client_nonce = message_nonce;

  if found then
    if result.help_request_id <> case_id or result.body <> normalized_body then
      raise exception 'message nonce conflict';
    end if;
    return result;
  end if;

  if (select count(*) from public.messages
      where author_id = auth.uid() and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'rate limit';
  end if;

  insert into public.messages(help_request_id, author_id, client_nonce, body)
    values(case_id, auth.uid(), message_nonce, normalized_body)
    returning * into result;
  return result;
end $$;

revoke all on function public.send_message(uuid,text,uuid) from public;
grant execute on function public.send_message(uuid,text,uuid) to authenticated;
