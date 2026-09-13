-- Make idempotent message delivery conflict-safe and serialize the per-author quota.
create or replace function public.send_message(case_id uuid, message_body text, message_nonce uuid)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  normalized_body text;
  result public.messages;
begin
  if caller_id is null then
    raise exception 'authentication required';
  end if;
  if case_id is null or message_nonce is null or message_body is null then
    raise exception 'invalid message';
  end if;

  normalized_body := trim(message_body);
  if length(normalized_body) not between 1 and 4000 then
    raise exception 'invalid message';
  end if;

  -- One transaction at a time may inspect and consume this author's quota,
  -- regardless of which nonce is used by concurrent requests.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text, 0)
  );

  -- Access is deliberately checked before returning an idempotent result: a
  -- former coordinator must not recover message data through an old nonce.
  if not public.can_access_case(case_id, caller_id) then
    raise exception 'access denied';
  end if;

  select * into result
  from public.messages
  where author_id = caller_id and client_nonce = message_nonce;

  if found then
    if result.help_request_id <> case_id or result.body <> normalized_body then
      -- Do not include any field from the existing private row in this error.
      raise exception 'message nonce conflict';
    end if;
    return result;
  end if;

  if (select count(*) from public.messages
      where author_id = caller_id
        and created_at > pg_catalog.now() - interval '1 minute') >= 20 then
    raise exception 'rate limit';
  end if;

  insert into public.messages(help_request_id, author_id, client_nonce, body)
  values (case_id, caller_id, message_nonce, normalized_body)
  returning * into result;
  return result;
end
$$;

revoke all on function public.send_message(uuid,text,uuid) from public, anon;
grant execute on function public.send_message(uuid,text,uuid) to authenticated;
