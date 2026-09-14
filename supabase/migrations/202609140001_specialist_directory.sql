-- Mercy-owned specialist directory v1. Network synchronization is intentionally absent.
create type public.specialist_publication_status as enum ('DRAFT','PENDING','PUBLISHED','REJECTED','BLOCKED');
create type public.qualification_status as enum ('UNVERIFIED','PENDING','VERIFIED','REJECTED');

create table public.specialist_profiles(
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique default auth.uid() references auth.users on delete cascade,
  display_name varchar(120) not null,
  description varchar(3000) not null default '',
  country varchar(80) not null,
  city varchar(120) not null,
  travel_area varchar(300) not null default '',
  specializations text[] not null default '{}',
  services text[] not null default '{}',
  languages text[] not null default '{}',
  work_formats text[] not null default '{}',
  contact_details varchar(500) not null default '',
  show_contacts boolean not null default false,
  publication_status public.specialist_publication_status not null default 'DRAFT',
  qualification_status public.qualification_status not null default 'UNVERIFIED',
  network_identity_id varchar(255),
  network_linked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  check(length(trim(display_name)) between 2 and 120),
  check(length(description)<=3000 and length(country) between 2 and 80 and length(city) between 2 and 120),
  check(cardinality(specializations)<=20 and cardinality(services)<=30 and cardinality(languages)<=20 and cardinality(work_formats)<=10),
  check(network_identity_id is null or network_linked_at is not null)
);
create index specialist_directory_order_idx on public.specialist_profiles(publication_status,display_name,id);
create index specialist_directory_country_city_idx on public.specialist_profiles(country,city) where publication_status='PUBLISHED';

create table public.qualification_requirements(
  id uuid primary key default gen_random_uuid(), country varchar(80) not null, service_category varchar(120) not null,
  requirement_text varchar(2000) not null, active boolean not null default true, created_at timestamptz not null default now(),
  unique(country,service_category)
);
create table public.qualification_documents(
  id uuid primary key default gen_random_uuid(), specialist_id uuid not null references public.specialist_profiles on delete cascade,
  storage_path varchar(500) not null unique, category varchar(120) not null, uploaded_at timestamptz not null default now()
);
create table public.specialist_status_events(
  id bigint generated always as identity primary key, specialist_id uuid not null references public.specialist_profiles on delete cascade,
  actor_id uuid not null references auth.users, publication_status public.specialist_publication_status,
  qualification_status public.qualification_status, reason varchar(500) not null, created_at timestamptz not null default now(),
  check(publication_status is not null or qualification_status is not null)
);

alter table public.specialist_profiles enable row level security;
alter table public.qualification_requirements enable row level security;
alter table public.qualification_documents enable row level security;
alter table public.specialist_status_events enable row level security;
revoke all on public.specialist_profiles,public.qualification_requirements,public.qualification_documents,public.specialist_status_events from anon,authenticated;
grant select on public.specialist_profiles to authenticated;
create policy specialist_owner_read on public.specialist_profiles for select to authenticated using(account_id=auth.uid() or public.is_admin());
grant select on public.qualification_documents to authenticated;
create policy qualification_document_read on public.qualification_documents for select to authenticated using(
  exists(select 1 from public.specialist_profiles p where p.id=specialist_id and (p.account_id=auth.uid() or public.is_admin()))
);
grant select on public.specialist_status_events to authenticated;
create policy specialist_event_read on public.specialist_status_events for select to authenticated using(
  public.is_admin() or exists(select 1 from public.specialist_profiles p where p.id=specialist_id and p.account_id=auth.uid())
);
grant select on public.qualification_requirements to authenticated;
create policy qualification_requirement_staff_read on public.qualification_requirements for select to authenticated using(public.is_admin());

create function public.save_specialist_profile(payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare sid uuid; changed boolean;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if length(trim(payload->>'display_name')) not between 2 and 120 or length(payload->>'description')>3000
    or length(payload->>'country') not between 2 and 80 or length(payload->>'city') not between 2 and 120 then raise exception 'invalid profile'; end if;
  if jsonb_typeof(payload->'specializations')<>'array' or jsonb_array_length(payload->'specializations')>20
    or jsonb_typeof(payload->'services')<>'array' or jsonb_array_length(payload->'services')>30
    or jsonb_typeof(payload->'languages')<>'array' or jsonb_array_length(payload->'languages')>20
    or jsonb_typeof(payload->'work_formats')<>'array' or jsonb_array_length(payload->'work_formats')>10 then raise exception 'invalid lists'; end if;
  select id, (country is distinct from payload->>'country' or specializations is distinct from array(select jsonb_array_elements_text(payload->'specializations')) or services is distinct from array(select jsonb_array_elements_text(payload->'services'))) into sid,changed from public.specialist_profiles where account_id=auth.uid() for update;
  if sid is null then
    insert into public.specialist_profiles(account_id,display_name,description,country,city,travel_area,specializations,services,languages,work_formats,contact_details,show_contacts)
    values(auth.uid(),trim(payload->>'display_name'),coalesce(payload->>'description',''),trim(payload->>'country'),trim(payload->>'city'),coalesce(payload->>'travel_area',''),array(select left(trim(value),120) from jsonb_array_elements_text(payload->'specializations')),array(select left(trim(value),120) from jsonb_array_elements_text(payload->'services')),array(select left(trim(value),80) from jsonb_array_elements_text(payload->'languages')),array(select left(trim(value),80) from jsonb_array_elements_text(payload->'work_formats')),left(coalesce(payload->>'contact_details',''),500),coalesce((payload->>'show_contacts')::boolean,false)) returning id into sid;
  else
    update public.specialist_profiles set display_name=trim(payload->>'display_name'),description=coalesce(payload->>'description',''),country=trim(payload->>'country'),city=trim(payload->>'city'),travel_area=left(coalesce(payload->>'travel_area',''),300),specializations=array(select left(trim(value),120) from jsonb_array_elements_text(payload->'specializations')),services=array(select left(trim(value),120) from jsonb_array_elements_text(payload->'services')),languages=array(select left(trim(value),80) from jsonb_array_elements_text(payload->'languages')),work_formats=array(select left(trim(value),80) from jsonb_array_elements_text(payload->'work_formats')),contact_details=left(coalesce(payload->>'contact_details',''),500),show_contacts=coalesce((payload->>'show_contacts')::boolean,false),publication_status=case when publication_status='PUBLISHED' then 'PENDING' else publication_status end,qualification_status=case when changed then 'UNVERIFIED' else qualification_status end,published_at=case when publication_status='PUBLISHED' then null else published_at end,updated_at=now() where id=sid;
    if changed then insert into public.specialist_status_events(specialist_id,actor_id,qualification_status,reason) values(sid,auth.uid(),'UNVERIFIED','Verified fields changed'); end if;
  end if;
  return sid;
end$$;
create function public.submit_specialist_profile() returns void language plpgsql security definer set search_path='' as $$
declare sid uuid; begin update public.specialist_profiles set publication_status='PENDING',updated_at=now() where account_id=auth.uid() and publication_status in('DRAFT','REJECTED') returning id into sid; if sid is null then raise exception 'profile cannot be submitted'; end if; insert into public.specialist_status_events(specialist_id,actor_id,publication_status,reason) values(sid,auth.uid(),'PENDING','Submitted by owner'); end$$;
create function public.review_specialist(specialist uuid,new_publication public.specialist_publication_status,new_qualification public.qualification_status,reason_text text) returns void language plpgsql security definer set search_path='' as $$
declare medical_without_rule boolean; begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  if new_publication not in('PUBLISHED','REJECTED','BLOCKED') or length(trim(reason_text)) not between 3 and 500 then raise exception 'invalid review'; end if;
  select new_qualification='VERIFIED' and exists(select 1 from unnest(p.services) s where lower(s) like 'medical:%') and not exists(select 1 from public.qualification_requirements r where r.active and r.country=p.country and r.service_category=any(p.services)) into medical_without_rule from public.specialist_profiles p where p.id=specialist for update;
  if medical_without_rule then raise exception 'medical qualification requirements are not configured'; end if;
  update public.specialist_profiles set publication_status=new_publication,qualification_status=new_qualification,published_at=case when new_publication='PUBLISHED' then now() else null end,updated_at=now() where id=specialist;
  if not found then raise exception 'profile not found'; end if;
  insert into public.specialist_status_events(specialist_id,actor_id,publication_status,qualification_status,reason) values(specialist,auth.uid(),new_publication,new_qualification,left(trim(reason_text),500));
end$$;
revoke all on function public.save_specialist_profile(jsonb),public.submit_specialist_profile(),public.review_specialist(uuid,public.specialist_publication_status,public.qualification_status,text) from public;
grant execute on function public.save_specialist_profile(jsonb),public.submit_specialist_profile(),public.review_specialist(uuid,public.specialist_publication_status,public.qualification_status,text) to authenticated;

create view public.published_specialists with (security_invoker=false) as select id,display_name,description,country,city,travel_area,specializations,services,languages,work_formats,qualification_status,case when show_contacts then contact_details else null end contact_details,published_at from public.specialist_profiles where publication_status='PUBLISHED';
revoke all on public.published_specialists from public; grant select on public.published_specialists to anon,authenticated;
create function public.search_specialists(search_text text default '',country_filter text default '',city_filter text default '',language_filter text default '',verified_only boolean default false,result_limit int default 20,result_offset int default 0)
returns setof public.published_specialists language sql stable security definer set search_path='' as $$
  select p.id,p.display_name,p.description,p.country,p.city,p.travel_area,p.specializations,p.services,p.languages,p.work_formats,p.qualification_status,case when p.show_contacts then p.contact_details else null end,p.published_at
  from public.specialist_profiles p where p.publication_status='PUBLISHED'
    and (search_text='' or p.display_name ilike '%'||search_text||'%' or exists(select 1 from unnest(p.specializations||p.services) value where value ilike '%'||search_text||'%'))
    and (country_filter='' or lower(p.country)=lower(country_filter)) and (city_filter='' or lower(p.city)=lower(city_filter))
    and (language_filter='' or exists(select 1 from unnest(p.languages) value where lower(value)=lower(language_filter)))
    and (not verified_only or p.qualification_status='VERIFIED')
  order by lower(p.display_name),p.id limit least(greatest(result_limit,1),50) offset greatest(result_offset,0)
$$;
revoke all on function public.search_specialists(text,text,text,text,boolean,int,int) from public;
grant execute on function public.search_specialists(text,text,text,text,boolean,int,int) to anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('qualification-documents','qualification-documents',false,10485760,array['application/pdf','image/jpeg','image/png']) on conflict(id) do nothing;
create policy qualification_storage_owner_insert on storage.objects for insert to authenticated with check(bucket_id='qualification-documents' and (storage.foldername(name))[1]=auth.uid()::text);
create policy qualification_storage_authorized_read on storage.objects for select to authenticated using(bucket_id='qualification-documents' and ((storage.foldername(name))[1]=auth.uid()::text or public.is_admin()));
