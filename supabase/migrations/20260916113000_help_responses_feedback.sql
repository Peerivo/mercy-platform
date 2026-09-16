-- Direct private responses to a concrete help request, plus public feedback intake.

create table public.help_request_responses(
  id uuid primary key default gen_random_uuid(),
  help_request_id uuid not null references public.help_requests on delete cascade,
  responder_id uuid not null references auth.users on delete cascade,
  message varchar(1500) not null check(length(trim(message)) between 10 and 1500),
  contact_method varchar(200) not null check(length(trim(contact_method)) between 2 and 200),
  status varchar(20) not null default 'PENDING' check(status in('PENDING','WITHDRAWN')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(help_request_id,responder_id)
);

create index help_request_responses_request_idx
  on public.help_request_responses(help_request_id,created_at desc,id);
create index help_request_responses_responder_idx
  on public.help_request_responses(responder_id,created_at desc,id);

alter table public.help_request_responses enable row level security;
revoke all on public.help_request_responses from public,anon,authenticated;
grant select on public.help_request_responses to authenticated;

create policy help_response_read on public.help_request_responses
for select to authenticated
using(
  responder_id = auth.uid()
  or public.can_access_case(help_request_id,auth.uid())
);

alter table public.consents drop constraint consent_subject_check;
alter table public.consents drop constraint consents_kind_check;
alter table public.consents
  add column help_response_id uuid references public.help_request_responses on delete cascade;
alter table public.consents
  add constraint consents_kind_check
  check(kind in('REQUEST_PROCESSING','VOLUNTEER_OFFER','HELP_RESPONSE','EXTERNAL_CONTACT','IDENTITY_INTEGRATION'));
alter table public.consents
  add constraint consent_subject_check check (
    (kind='REQUEST_PROCESSING' and help_request_id is not null and volunteer_offer_id is null and help_response_id is null)
    or (kind='VOLUNTEER_OFFER' and volunteer_offer_id is not null and help_request_id is null and help_response_id is null)
    or (kind='HELP_RESPONSE' and help_response_id is not null and help_request_id is null and volunteer_offer_id is null)
    or (kind in('EXTERNAL_CONTACT','IDENTITY_INTEGRATION') and help_request_id is null and volunteer_offer_id is null and help_response_id is null)
  );

create function public.respond_to_help_request(
  case_id uuid,
  payload jsonb,
  consent_version text
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  response_id uuid;
  request_owner uuid;
  request_state public.request_status;
  response_message text := trim(coalesce(payload->>'message',''));
  response_contact text := trim(coalesce(payload->>'contact_method',''));
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if case_id is null or jsonb_typeof(payload) <> 'object' or consent_version <> 'help-response-v1' then
    raise exception 'invalid payload';
  end if;
  if length(response_message) not between 10 and 1500 or length(response_contact) not between 2 and 200 then
    raise exception 'invalid response';
  end if;

  select owner_id,status into request_owner,request_state
  from public.help_requests
  where id=case_id
  for update;

  if request_owner is null then raise exception 'request not found'; end if;
  if request_owner = auth.uid() then raise exception 'owner cannot respond'; end if;
  if request_state in ('RESOLVED','CLOSED') then raise exception 'request is completed'; end if;
  if (select count(*) from public.help_request_responses where responder_id=auth.uid() and created_at>now()-interval '1 hour') >= 10 then
    raise exception 'rate limit';
  end if;

  insert into public.help_request_responses(help_request_id,responder_id,message,contact_method)
  values(case_id,auth.uid(),response_message,response_contact)
  on conflict(help_request_id,responder_id) do update
    set message=excluded.message,
        contact_method=excluded.contact_method,
        status='PENDING',
        updated_at=now()
  returning id into response_id;

  insert into public.consents(user_id,help_response_id,kind,text_version)
  values(auth.uid(),response_id,'HELP_RESPONSE',consent_version);

  return response_id;
end$$;

revoke all on function public.respond_to_help_request(uuid,jsonb,text) from public,anon;
grant execute on function public.respond_to_help_request(uuid,jsonb,text) to authenticated;

create table public.feedback_messages(
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete set null,
  reply_email varchar(320),
  page_path varchar(500),
  message varchar(3000) not null check(length(trim(message)) between 3 and 3000),
  created_at timestamptz not null default now()
);

alter table public.feedback_messages enable row level security;
revoke all on public.feedback_messages from public,anon,authenticated;

create function public.submit_feedback(
  message_text text,
  reply_email text default null,
  page_path text default null
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  feedback_id uuid;
  clean_email text := nullif(trim(coalesce(reply_email,'')),'');
  clean_page text := nullif(left(trim(coalesce(page_path,'')),500),'');
  clean_message text := trim(coalesce(message_text,''));
begin
  if length(clean_message) not between 3 and 3000 then raise exception 'invalid feedback'; end if;
  if clean_email is not null and (length(clean_email) > 320 or position('@' in clean_email) < 2) then
    raise exception 'invalid email';
  end if;

  insert into public.feedback_messages(user_id,reply_email,page_path,message)
  values(auth.uid(),clean_email,clean_page,clean_message)
  returning id into feedback_id;

  return feedback_id;
end$$;

revoke all on function public.submit_feedback(text,text,text) from public;
grant execute on function public.submit_feedback(text,text,text) to anon,authenticated;
