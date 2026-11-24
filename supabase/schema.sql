-- Future server-side integration. No public anonymous access to client records.
create table public.intakes (
 id uuid primary key default gen_random_uuid(),
 created_at timestamptz not null default now(),
 path text not null check (path in ('H-1B','EB-1A','O-1','探索方向')),
 contact_name text not null,
 contact_email text not null,
 answers jsonb not null default '{}'::jsonb,
 consent_version text not null,
 consent_at timestamptz not null,
 review_status text not null default 'pending' check (review_status in ('pending','reviewing','follow_up','closed'))
);
alter table public.intakes enable row level security;
-- Intentionally no anon/authenticated policies. Use a validated server endpoint
-- with service role for submission, and authenticated staff authorization for review.
