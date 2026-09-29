-- Requester-declared home conditions and volunteer compatibility matching.
-- ESIA identity verification is deliberately separate from place/visit safety.

alter table public.help_request_safety
  add column home_visit_requested boolean not null default false,
  add column household_members varchar(1000) not null default '',
  add column dogs_present boolean not null default false,
  add column cats_present boolean not null default false,
  add column animals_note varchar(1000) not null default '',
  add column smoking_present boolean not null default false,
  add column allergen_note varchar(1000) not null default '',
  add column access_note varchar(1000) not null default '',
  add column other_visit_note varchar(1500) not null default '',
  add column trusted_contact varchar(240) not null default '',
  add column video_call_possible boolean not null default false,
  add column video_call_completed_at timestamptz,
  add column video_call_completed_by uuid references auth.users on delete set null,
  add column video_call_note varchar(500),
  add column requester_declared_at timestamptz;

alter table public.help_request_safety
  add constraint help_request_safety_household_check
    check(not home_visit_requested or length(trim(household_members)) between 2 and 1000),
  add constraint help_request_safety_animals_check
    check(not home_visit_requested or length(trim(animals_note)) between 2 and 1000),
  add constraint help_request_safety_allergens_check
    check(not home_visit_requested or length(trim(allergen_note)) between 2 and 1000),
  add constraint help_request_safety_access_check
    check(not home_visit_requested or length(trim(access_note)) between 2 and 1000),
  add constraint help_request_safety_other_note_check
    check(length(trim(other_visit_note)) <= 1500),
  add constraint help_request_safety_trusted_contact_check
    check(length(trim(trusted_contact)) <= 240),
  add constraint help_request_safety_video_note_check
    check(video_call_note is null or length(trim(video_call_note)) between 3 and 500),
  add constraint help_request_safety_video_possible_check
    check(not video_call_possible or home_visit_requested),
  add constraint help_request_safety_video_completed_check
    check(video_call_completed_at is null or home_visit_requested);

comment on column public.help_request_safety.household_members is
  'Private requester-declared information; never part of public request projections.';
comment on column public.help_request_safety.trusted_contact is
  'Private coordination contact; never part of public request projections.';

alter table public.volunteer_profiles
  add column avoid_dogs boolean not null default false,
  add column avoid_cats boolean not null default false,
  add column avoid_smoke boolean not null default false,
  add column visit_limitations varchar(1000) not null default '';

alter table public.volunteer_profiles
  add constraint volunteer_profiles_visit_limitations_check
    check(length(trim(visit_limitations)) <= 1000);

create or replace function public.create_help_request(payload jsonb, consent_version text)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  rid uuid;
  home_required boolean;
  safety_ack boolean;
  dogs boolean;
  cats boolean;
  smoking boolean;
  video_possible boolean;
  household text;
  animal_notes text;
  allergen_notes text;
  access_notes text;
  other_notes text;
  trusted text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then raise exception 'invalid payload'; end if;
  if coalesce(payload->>'category','') not in (
    'PREGNANCY','FAMILY','HOUSING','FOOD_GOODS',
    'LEGAL_DOCUMENTS','WORK_EDUCATION','OTHER'
  ) then raise exception 'invalid category'; end if;
  if length(trim(coalesce(payload->>'country',''))) not between 2 and 80 then raise exception 'invalid country'; end if;
  if length(trim(coalesce(payload->>'city',''))) not between 2 and 120 then raise exception 'invalid city'; end if;
  if length(trim(coalesce(payload->>'description',''))) not between 20 and 5000 then raise exception 'invalid description'; end if;
  if coalesce(payload->>'urgency','') not in ('NORMAL','SOON','URGENT') then raise exception 'invalid urgency'; end if;
  if length(coalesce(payload->>'contact_window','')) > 120 then raise exception 'invalid contact window'; end if;
  if length(coalesce(payload->>'external_contact','')) > 200 then raise exception 'invalid external contact'; end if;

  home_required := coalesce((payload->>'home_visit_required')::boolean,false);
  safety_ack := coalesce((payload->>'visit_safety_acknowledged')::boolean,false);
  dogs := coalesce((payload->>'dogs_present')::boolean,false);
  cats := coalesce((payload->>'cats_present')::boolean,false);
  smoking := coalesce((payload->>'smoking_present')::boolean,false);
  video_possible := coalesce((payload->>'video_call_possible')::boolean,false);
  household := trim(coalesce(payload->>'visit_household_members',''));
  animal_notes := trim(coalesce(payload->>'visit_animals_notes',''));
  allergen_notes := trim(coalesce(payload->>'visit_allergen_notes',''));
  access_notes := trim(coalesce(payload->>'visit_access_notes',''));
  other_notes := trim(coalesce(payload->>'visit_other_notes',''));
  trusted := trim(coalesce(payload->>'visit_trusted_contact',''));

  if home_required then
    if safety_ack is not true
       or length(household) not between 2 and 1000
       or length(animal_notes) not between 2 and 1000
       or length(allergen_notes) not between 2 and 1000
       or length(access_notes) not between 2 and 1000
       or length(other_notes) > 1500
       or length(trusted) > 240 then
      raise exception 'home visit safety details required';
    end if;
  elsif video_possible then
    raise exception 'video call is only valid for a home visit';
  end if;

  if (select count(*) from public.help_requests where owner_id=auth.uid() and created_at>now()-interval '1 hour')>=5 then
    raise exception 'rate limit';
  end if;

  insert into public.help_requests(
    owner_id,category,country,city,description,urgency,
    can_message,can_call,contact_window,external_contact
  ) values(
    auth.uid(),trim(payload->>'category'),trim(payload->>'country'),trim(payload->>'city'),
    trim(payload->>'description'),trim(payload->>'urgency'),
    coalesce((payload->>'can_message')::boolean,true),
    coalesce((payload->>'can_call')::boolean,false),
    coalesce(payload->>'contact_window',''),coalesce(payload->>'external_contact','')
  ) returning id into rid;

  if home_required then
    insert into public.help_request_safety(
      help_request_id,beneficiary_is_requester,beneficiary_consent_status,
      home_visit_approved,recorded_by,recorded_at,note,home_visit_requested,
      household_members,dogs_present,cats_present,animals_note,smoking_present,
      allergen_note,access_note,other_visit_note,trusted_contact,video_call_possible,
      requester_declared_at
    ) values(
      rid,true,'NOT_REQUIRED',false,auth.uid(),now(),
      'requester declared home-visit conditions',true,household,dogs,cats,
      animal_notes,smoking,allergen_notes,access_notes,other_notes,trusted,
      video_possible,now()
    );
  end if;

  insert into public.consents(user_id,help_request_id,kind,text_version)
  values(auth.uid(),rid,'REQUEST_PROCESSING',consent_version);
  return rid;
end;
$$;

revoke all on function public.create_help_request(jsonb,text) from public,anon;
grant execute on function public.create_help_request(jsonb,text) to authenticated;

create or replace function public.set_help_request_safety(
  case_id uuid,
  requester_is_beneficiary boolean,
  consent_status public.beneficiary_consent_status,
  allow_home_visit boolean,
  reason_text text
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  caller uuid := auth.uid();
  clean_reason text := trim(coalesce(reason_text,''));
  caller_admin boolean := private.is_admin(caller);
  caller_curator boolean := private.has_active_esia(caller)
    and private.has_mercy_role('CURATOR'::public.mercy_role,caller);
  normalized_consent public.beneficiary_consent_status;
  existing public.help_request_safety%rowtype;
begin
  if caller is null or not (caller_admin or (caller_curator and private.is_active_coordinator(case_id,caller))) then
    raise exception 'case curator required';
  end if;
  if length(clean_reason) not between 3 and 500 then raise exception 'reason required'; end if;
  if not exists(select 1 from public.help_requests where id=case_id) then raise exception 'request not found'; end if;

  select * into existing from public.help_request_safety where help_request_id=case_id for update;

  if allow_home_visit and (existing.help_request_id is null or not existing.home_visit_requested) then
    raise exception 'requester home-visit conditions required';
  end if;

  normalized_consent := case
    when requester_is_beneficiary then 'NOT_REQUIRED'::public.beneficiary_consent_status
    else consent_status
  end;
  if not requester_is_beneficiary and normalized_consent='NOT_REQUIRED' then
    raise exception 'beneficiary consent required';
  end if;
  if allow_home_visit and normalized_consent not in ('NOT_REQUIRED','CONFIRMED') then
    raise exception 'home visit requires beneficiary consent';
  end if;

  if existing.help_request_id is null then
    insert into public.help_request_safety(
      help_request_id,beneficiary_is_requester,beneficiary_consent_status,
      home_visit_approved,recorded_by,recorded_at,note
    ) values(case_id,requester_is_beneficiary,normalized_consent,false,caller,now(),clean_reason);
  else
    update public.help_request_safety
    set beneficiary_is_requester=requester_is_beneficiary,
        beneficiary_consent_status=normalized_consent,
        home_visit_approved=allow_home_visit,
        recorded_by=caller,recorded_at=now(),note=clean_reason
    where help_request_id=case_id;
  end if;

  insert into public.audit_events(actor_id,action,object_type,object_id,reason)
  values(caller,'CASE_SAFETY_RECORDED','help_request',case_id,'beneficiary consent/home-visit gate updated');
end;
$$;

create function public.confirm_home_visit_video_call(case_id uuid, completed boolean, reason_text text)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  caller uuid := auth.uid();
  clean_reason text := trim(coalesce(reason_text,''));
  caller_admin boolean := private.is_admin(caller);
  caller_curator boolean := private.has_active_esia(caller)
    and private.has_mercy_role('CURATOR'::public.mercy_role,caller);
  safety public.help_request_safety%rowtype;
begin
  if caller is null or not (caller_admin or (caller_curator and private.is_active_coordinator(case_id,caller))) then
    raise exception 'case curator required';
  end if;
  if length(clean_reason) not between 3 and 500 then raise exception 'reason required'; end if;
  select * into safety from public.help_request_safety where help_request_id=case_id for update;
  if safety.help_request_id is null or not safety.home_visit_requested then
    raise exception 'home visit safety details required';
  end if;
  if completed and not safety.video_call_possible then
    raise exception 'video call was not declared possible';
  end if;

  update public.help_request_safety
  set video_call_completed_at=case when completed then now() else null end,
      video_call_completed_by=case when completed then caller else null end,
      video_call_note=clean_reason,recorded_by=caller,recorded_at=now()
  where help_request_id=case_id;

  insert into public.audit_events(actor_id,action,object_type,object_id,reason)
  values(caller,'HOME_VISIT_VIDEO_CHECK_UPDATED','help_request',case_id,'pre-visit video-call state updated');
end;
$$;

create function public.current_case_visit_safety(case_id uuid)
returns table(
  home_visit_requested boolean,
  household_members text,
  dogs_present boolean,
  cats_present boolean,
  animals_note text,
  smoking_present boolean,
  allergen_note text,
  access_note text,
  other_visit_note text,
  trusted_contact text,
  video_call_possible boolean,
  video_call_completed_at timestamptz,
  beneficiary_consent_status public.beneficiary_consent_status,
  home_visit_approved boolean
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null or not (private.is_admin(caller) or private.can_access_case(case_id,caller)) then
    raise exception 'access denied';
  end if;
  return query
  select s.home_visit_requested,s.household_members::text,s.dogs_present,s.cats_present,
         s.animals_note::text,s.smoking_present,s.allergen_note::text,s.access_note::text,
         s.other_visit_note::text,s.trusted_contact::text,s.video_call_possible,
         s.video_call_completed_at,s.beneficiary_consent_status,s.home_visit_approved
  from public.help_request_safety s
  where s.help_request_id=case_id;
end;
$$;

create function public.staff_volunteer_visit_limitations(target_user uuid)
returns table(avoid_dogs boolean, avoid_cats boolean, avoid_smoke boolean, visit_limitations text)
language plpgsql
stable
security definer
set search_path=''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null or not (
    private.is_admin(caller)
    or (private.has_active_esia(caller) and private.has_mercy_role('CURATOR'::public.mercy_role,caller))
  ) then raise exception 'curator required'; end if;
  return query
  select vp.avoid_dogs,vp.avoid_cats,vp.avoid_smoke,vp.visit_limitations::text
  from public.volunteer_profiles vp
  where vp.user_id=target_user
    and private.has_mercy_role('VOLUNTEER'::public.mercy_role,target_user)
    and private.has_active_esia(target_user);
end;
$$;

create function public.update_volunteer_visit_limitations(
  target_user uuid,
  avoid_dogs_value boolean,
  avoid_cats_value boolean,
  avoid_smoke_value boolean,
  limitations_text text,
  reason_text text
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  caller uuid := auth.uid();
  clean_limitations text := trim(coalesce(limitations_text,''));
  clean_reason text := trim(coalesce(reason_text,''));
begin
  if caller is null or not (
    private.is_admin(caller)
    or (private.has_active_esia(caller) and private.has_mercy_role('CURATOR'::public.mercy_role,caller))
  ) then raise exception 'curator required'; end if;
  if length(clean_limitations) > 1000 then raise exception 'invalid limitations'; end if;
  if length(clean_reason) not between 3 and 500 then raise exception 'reason required'; end if;
  if not private.has_active_esia(target_user)
     or not private.has_mercy_role('VOLUNTEER'::public.mercy_role,target_user) then
    raise exception 'verified volunteer required';
  end if;

  update public.volunteer_profiles
  set avoid_dogs=coalesce(avoid_dogs_value,false),avoid_cats=coalesce(avoid_cats_value,false),
      avoid_smoke=coalesce(avoid_smoke_value,false),visit_limitations=clean_limitations,
      updated_by=caller,updated_at=now()
  where user_id=target_user;
  if not found then raise exception 'volunteer profile not found'; end if;

  insert into public.audit_events(actor_id,action,object_type,object_id,reason)
  values(caller,'VOLUNTEER_VISIT_LIMITS_UPDATED','user',target_user,'home-visit compatibility limits updated');
end;
$$;

create or replace function public.assign_volunteer_to_case(
  case_id uuid,
  target_volunteer uuid,
  assignment_mode public.volunteer_assignment_mode,
  task_text text,
  companion_user uuid default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  caller uuid := auth.uid();
  clean_task text := trim(coalesce(task_text,''));
  caller_admin boolean := private.is_admin(caller);
  caller_curator boolean := private.has_active_esia(caller)
    and private.has_mercy_role('CURATOR'::public.mercy_role,caller);
  companion uuid := companion_user;
  safety public.help_request_safety%rowtype;
  volunteer public.volunteer_profiles%rowtype;
  result_id uuid;
begin
  if caller is null or not (caller_admin or (caller_curator and private.is_active_coordinator(case_id,caller))) then
    raise exception 'case curator required';
  end if;
  if length(clean_task) not between 3 and 500 then raise exception 'task required'; end if;
  if not exists(select 1 from public.help_requests where id=case_id and status not in ('RESOLVED','CLOSED')) then
    raise exception 'active request required';
  end if;
  if not private.has_active_esia(target_volunteer)
     or not private.has_mercy_role('VOLUNTEER'::public.mercy_role,target_volunteer) then
    raise exception 'active verified volunteer required';
  end if;

  select * into volunteer from public.volunteer_profiles where user_id=target_volunteer;
  if volunteer.user_id is null or volunteer.service_status<>'ACTIVE' then
    raise exception 'active verified volunteer required';
  end if;
  if exists(select 1 from public.volunteer_incidents where volunteer_id=target_volunteer and status<>'RESOLVED') then
    raise exception 'volunteer has open incident';
  end if;

  if assignment_mode='HOME_PAIRED' then
    select * into safety from public.help_request_safety where help_request_id=case_id;
    if safety.help_request_id is null
       or not safety.home_visit_requested
       or not safety.home_visit_approved
       or safety.beneficiary_consent_status not in ('NOT_REQUIRED','CONFIRMED') then
      raise exception 'home visit safety gate is not satisfied';
    end if;
    if volunteer.home_visit_clearance<>'CLEARED' then raise exception 'home visit clearance required'; end if;

    if safety.dogs_present and volunteer.avoid_dogs then
      raise exception 'volunteer-home safety incompatibility: dogs';
    end if;
    if safety.cats_present and volunteer.avoid_cats then
      raise exception 'volunteer-home safety incompatibility: cats';
    end if;
    if safety.smoking_present and volunteer.avoid_smoke then
      raise exception 'volunteer-home safety incompatibility: smoke';
    end if;
    if safety.video_call_possible and safety.video_call_completed_at is null then
      raise exception 'pre-visit video call required';
    end if;

    companion := coalesce(companion,caller);
    if companion=target_volunteer or not private.has_active_esia(companion) then
      raise exception 'verified companion required';
    end if;
    if companion<>caller
       and not (
         private.has_mercy_role('VOLUNTEER'::public.mercy_role,companion)
         and exists(select 1 from public.volunteer_profiles where user_id=companion and service_status='ACTIVE')
       ) then
      raise exception 'active companion required';
    end if;
  elsif companion is not null then
    raise exception 'companion is only valid for paired home visits';
  end if;

  if exists(
    select 1 from public.volunteer_case_assignments
    where help_request_id=case_id and volunteer_id=target_volunteer
      and completed_at is null and revoked_at is null
  ) then raise exception 'volunteer already assigned'; end if;

  insert into public.volunteer_case_assignments(
    help_request_id,volunteer_id,assigned_by,assignment_mode,task_summary,companion_user_id
  ) values(case_id,target_volunteer,caller,assignment_mode,clean_task,companion)
  returning id into result_id;

  insert into public.audit_events(actor_id,action,object_type,object_id,reason)
  values(caller,'VOLUNTEER_ASSIGNED','help_request',case_id,'verified volunteer assigned after safety matching');
  return result_id;
end;
$$;

revoke all on function public.confirm_home_visit_video_call(uuid,boolean,text) from public,anon;
revoke all on function public.current_case_visit_safety(uuid) from public,anon;
revoke all on function public.staff_volunteer_visit_limitations(uuid) from public,anon;
revoke all on function public.update_volunteer_visit_limitations(uuid,boolean,boolean,boolean,text,text) from public,anon;
revoke all on function public.assign_volunteer_to_case(uuid,uuid,public.volunteer_assignment_mode,text,uuid) from public,anon;

grant execute on function public.confirm_home_visit_video_call(uuid,boolean,text) to authenticated;
grant execute on function public.current_case_visit_safety(uuid) to authenticated;
grant execute on function public.staff_volunteer_visit_limitations(uuid) to authenticated;
grant execute on function public.update_volunteer_visit_limitations(uuid,boolean,boolean,boolean,text,text) to authenticated;
grant execute on function public.assign_volunteer_to_case(uuid,uuid,public.volunteer_assignment_mode,text,uuid) to authenticated;
