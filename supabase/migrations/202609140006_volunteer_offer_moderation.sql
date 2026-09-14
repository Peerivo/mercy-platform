alter table public.volunteer_offers add column country varchar(80) not null default 'Не указана';
alter table public.volunteer_offers add constraint volunteer_offer_location_check check (online or length(trim(city)) >= 2);
create index volunteer_offers_owner_page_idx on public.volunteer_offers(owner_id,created_at desc,id);
create index volunteer_offers_moderation_page_idx on public.volunteer_offers(review_status,created_at,id);
alter table public.consents drop constraint consents_kind_check;
alter table public.consents add constraint consents_kind_check check(kind in('REQUEST_PROCESSING','VOLUNTEER_OFFER','EXTERNAL_CONTACT','IDENTITY_INTEGRATION'));
alter table public.consents add column volunteer_offer_id uuid references public.volunteer_offers on delete cascade;
alter table public.consents add constraint consent_subject_check check ((kind='REQUEST_PROCESSING' and help_request_id is not null and volunteer_offer_id is null) or (kind='VOLUNTEER_OFFER' and volunteer_offer_id is not null and help_request_id is null) or (kind in('EXTERNAL_CONTACT','IDENTITY_INTEGRATION')));
revoke insert on public.volunteer_offers from authenticated;
drop policy offer_self_insert on public.volunteer_offers;

create function public.create_volunteer_offer(payload jsonb,consent_version text) returns uuid language plpgsql security definer set search_path=''
as $$declare offer_id uuid; is_online boolean;
begin
 if auth.uid() is null then raise exception 'authentication required'; end if;
 if jsonb_typeof(payload) <> 'object' or consent_version <> 'volunteer-offer-v1' then raise exception 'invalid payload'; end if;
 is_online := coalesce((payload->>'online')::boolean,false);
 if not (coalesce(payload->>'category','') in ('THINGS','TRANSPORT','FOOD','CHILDCARE','EDUCATION_WORK','OTHER')) or length(trim(coalesce(payload->>'country',''))) not between 2 and 80 or length(trim(coalesce(payload->>'city',''))) not between 0 and 120 or (not is_online and length(trim(coalesce(payload->>'city',''))) < 2) or length(trim(coalesce(payload->>'description',''))) not between 20 and 3000 or length(trim(coalesce(payload->>'contact_method',''))) not between 2 and 200 then raise exception 'invalid offer'; end if;
 if (select count(*) from public.volunteer_offers where owner_id=auth.uid() and created_at>now()-interval '1 hour')>=5 then raise exception 'rate limit'; end if;
 insert into public.volunteer_offers(owner_id,category,country,city,online,description,contact_method) values(auth.uid(),trim(payload->>'category'),trim(payload->>'country'),trim(payload->>'city'),is_online,trim(payload->>'description'),trim(payload->>'contact_method')) returning id into offer_id;
 insert into public.consents(user_id,volunteer_offer_id,kind,text_version) values(auth.uid(),offer_id,'VOLUNTEER_OFFER',consent_version);
 return offer_id;
end$$;
revoke all on function public.create_volunteer_offer(jsonb,text) from public,anon;
grant execute on function public.create_volunteer_offer(jsonb,text) to authenticated;

create function public.moderate_volunteer_offer(offer_id uuid,new_status public.review_status,reason_text text) returns void language plpgsql security definer set search_path=''
as $$declare old_status public.review_status;
begin
 if not public.is_admin() then raise exception 'admin required'; end if;
 if length(trim(coalesce(reason_text,''))) not between 3 and 500 then raise exception 'reason required'; end if;
 select review_status into old_status from public.volunteer_offers where id=offer_id for update;
 if old_status is null then raise exception 'offer not found'; end if;
 if old_status <> 'PENDING' or new_status not in ('VERIFIED','REJECTED') then raise exception 'invalid transition'; end if;
 update public.volunteer_offers set review_status=new_status where id=offer_id;
 insert into public.audit_events(actor_id,action,object_type,object_id,reason) values(auth.uid(),'VOLUNTEER_OFFER_'||new_status::text,'volunteer_offer',offer_id,left(trim(reason_text),500));
end$$;
revoke all on function public.moderate_volunteer_offer(uuid,public.review_status,text) from public,anon;
grant execute on function public.moderate_volunteer_offer(uuid,public.review_status,text) to authenticated;
