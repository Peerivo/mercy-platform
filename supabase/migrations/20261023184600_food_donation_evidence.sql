-- Mercy Food donation evidence: private files, two-person attestation, idempotent dispatch.
-- This migration is applied only through the reviewed GitHub Actions migration pipeline.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mercy-food-evidence','mercy-food-evidence',false,5242880,ARRAY['application/pdf','image/jpeg','image/png'])
on conflict (id) do update
  set public=false, file_size_limit=5242880,
      allowed_mime_types=ARRAY['application/pdf','image/jpeg','image/png'];

create table if not exists public.food_donation_evidence (
  id uuid primary key default gen_random_uuid(),
  offer_id text not null check (offer_id ~ '^offer_lot_[a-z0-9_-]{3,80}$'),
  reservation_id text not null unique check (reservation_id ~ '^reservation_[a-z0-9_-]{3,100}$'),
  document_path text not null unique check (document_path ~ '^evidence/[a-f0-9-]{36}[.](pdf|png|jpg)$'),
  document_sha256 text not null check (document_sha256 ~ '^[a-f0-9]{64}$'),
  document_mime text not null check (document_mime in ('application/pdf','image/jpeg','image/png')),
  evidence_ref text not null unique check (evidence_ref ~ '^evidence_fulfillment_[a-f0-9]{32}$'),
  quantity_picked_up integer not null check (quantity_picked_up between 0 and 200),
  quantity_delivered integer not null check (quantity_delivered between 0 and quantity_picked_up),
  submitted_by uuid not null references auth.users(id),
  submitted_at timestamptz not null default now(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','SENDING','SENT','REJECTED')),
  processing_started_at timestamptz,
  dispatched_at timestamptz,
  event_id text not null unique check (event_id ~ '^event_mercy_evidence_[a-f0-9]{32}$'),
  constraint evidence_approval_state check (
    (status in ('PENDING','REJECTED') and approved_by is null and approved_at is null)
    or (status in ('APPROVED','SENDING','SENT') and approved_by is not null and approved_at is not null
        and approved_by <> submitted_by)
  )
);

create index if not exists food_donation_evidence_status_created_idx on public.food_donation_evidence(status, submitted_at);
alter table public.food_donation_evidence enable row level security;
revoke all on public.food_donation_evidence from public, anon, authenticated;
grant select, insert, update on public.food_donation_evidence to service_role;
-- No anon/authenticated policies: evidence access is only through server actions
-- after checking the current authoritative staff role and the reviewer identity.
