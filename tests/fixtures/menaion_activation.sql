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

-- Synthetic complete historical ledger supports the real read-only inspector.
-- These pinned hashes are public test inputs, not proof of live deployment.
create table public.living_menaion_schema_migrations (version text primary key, checksum text not null);
insert into public.living_menaion_schema_migrations values
  ('20260916193000', '3b34be574e02d0a15ad4c7e2d2b73dcc5b78b55b5bac8d303462eca299f31c9c'),
  ('20260917094000', 'c2cabd0b8fed228e9214117a3fbfe768df1d96724dc0614f9dd4da38ba9704cf'),
  ('20260917224000', '0c67674026043a80021df34bbbb824aee842afe37fb8eea88f21ff5d0e7c1e45'),
  ('20260917231000', '0a3be17f25f9e423c773c232eafb8e036c42ff7ce82401dcb771c5a3a3ab5551'),
  ('20260918022500', 'aa8be3c8305818638d6a77e5602adaf95ac8ed1ff5af6e1a10fd41ef8ab480e4'),
  ('20260918213000', 'c93038b2dddfbf75b38374dca8c850f036874ed67248550a31848b17a2eddaf6'),
  ('20260927140000', 'd6ffce4f79c96d24c88759edbff989373a96364871027f87e8c7bafff2905761'),
  ('20260929193000', '6f945a29618a646d1f1e3d8c3be89fbbab1883fec8bc0e911b7494e9df19bddc'),
  ('20261002184929', '15265e48dcbf87b24b7aed34c296c2a4a83cbba132a5e33bffc0cfdd9469444c');
