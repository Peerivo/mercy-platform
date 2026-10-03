-- Disposable CI fixture only. This is NOT a production migration or a replay of
-- the nine production migrations. It provides the exact catalog/access shape
-- needed by the activation preflight, with synthetic content and no real data.
-- Public fixed values below are test inputs, never deployment credentials.
create role authenticator login noinherit password 'menaion-ci-old-password-only';
create role service_role nologin noinherit bypassrls;
grant service_role to authenticator;
create role menaion_feedback_submit nologin noinherit;
create role menaion_feedback_writer nologin noinherit;
create role menaion_rest_authenticator nologin noinherit;
grant service_role, menaion_feedback_submit to menaion_rest_authenticator;
grant connect on database living_menaion to authenticator, menaion_rest_authenticator;

create schema living_menaion;
create schema menaion_feedback;
create schema menaion_feedback_private;
revoke all on schema living_menaion, menaion_feedback, menaion_feedback_private from public;
grant usage on schema living_menaion to service_role;
grant usage on schema menaion_feedback, menaion_feedback_private to menaion_feedback_submit;
grant usage on schema menaion_feedback_private to menaion_feedback_writer;

create table living_menaion.liturgical_day_editions (id bigint primary key, title text not null);
create table living_menaion.pronunciation_entries (
  id bigint primary key,
  canonical_token text not null,
  status text not null check (status in ('draft', 'published'))
);
create table menaion_feedback_private.rate_buckets (
  bucket text primary key,
  attempts integer not null
);
alter table living_menaion.liturgical_day_editions enable row level security;
alter table living_menaion.pronunciation_entries enable row level security;
alter table menaion_feedback_private.rate_buckets enable row level security;
revoke all on all tables in schema living_menaion, menaion_feedback_private from public;
grant select, insert, update, delete on all tables in schema living_menaion to service_role;
insert into living_menaion.liturgical_day_editions values (1, 'synthetic-ci-content');
insert into living_menaion.pronunciation_entries values (1, 'synthetic-ci-word', 'draft');

-- The same role/audience/expiry and invalid-before-writes contract as the real
-- feedback RPC. Deliberately refuses every valid submission: this fixture cannot
-- establish production feedback-write correctness and is never used to do so.
create function menaion_feedback_private.submit_correction(
  corrected_word text, civil_date text, client_hash text
) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  claims jsonb := nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb;
  word text := pg_catalog.btrim(corrected_word);
begin
  if pg_catalog.current_setting('role', true) is distinct from 'menaion_feedback_submit'
     or claims ->> 'role' is distinct from 'menaion_feedback_submit'
     or claims ->> 'aud' is distinct from 'menaion-feedback'
     or pg_catalog.jsonb_typeof(claims -> 'exp') is distinct from 'number' then
    raise insufficient_privilege using message = 'Feedback credentials required';
  end if;
  if (claims ->> 'exp')::numeric <= extract(epoch from pg_catalog.clock_timestamp()) then
    raise insufficient_privilege using message = 'Feedback credentials expired';
  end if;
  if word is null or pg_catalog.char_length(word) not between 1 and 80
     or word !~ '^[А-ЯЁа-яё]+(-[А-ЯЁа-яё]+)*$'
     or pg_catalog.char_length(pg_catalog.regexp_replace(word, '[^А-ЯЁ]', '', 'g')) <> 1
     or pg_catalog.char_length(pg_catalog.regexp_replace(word, '[^АЕЁИОУЫЭЮЯ]', '', 'g')) <> 1
     or client_hash is null or client_hash !~ '^[a-f0-9]{64}$' then
    return 'invalid';
  end if;
  if civil_date is not null and civil_date <> '' then
    if civil_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return 'invalid'; end if;
    begin
      if pg_catalog.to_char(civil_date::date, 'YYYY-MM-DD') <> civil_date then return 'invalid'; end if;
    exception when datetime_field_overflow or invalid_datetime_format then
      return 'invalid';
    end;
  end if;
  raise exception 'Synthetic integration fixture accepts invalid probes only';
end;
$$;
alter function menaion_feedback_private.submit_correction(text, text, text) owner to menaion_feedback_writer;
revoke all on function menaion_feedback_private.submit_correction(text, text, text) from public;
grant execute on function menaion_feedback_private.submit_correction(text, text, text) to menaion_feedback_submit;
create function menaion_feedback.submit_pronunciation_correction(
  corrected_word text, civil_date text, client_hash text
) returns text language sql security invoker set search_path = ''
as $$ select menaion_feedback_private.submit_correction(corrected_word, civil_date, client_hash); $$;
revoke all on function menaion_feedback.submit_pronunciation_correction(text, text, text) from public;
grant execute on function menaion_feedback.submit_pronunciation_correction(text, text, text) to menaion_feedback_submit;

-- Synthetic ledger entry supports the real read-only inspector. It is not proof
-- of production predecessor history, which the separate migration workflow owns.
create table public.living_menaion_schema_migrations (version text primary key, checksum text not null);
insert into public.living_menaion_schema_migrations values (
  '20261002184929', '15265e48dcbf87b24b7aed34c296c2a4a83cbba132a5e33bffc0cfdd9469444c'
);
