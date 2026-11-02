-- collegeinfo.neetpg — run once in Supabase Dashboard → SQL Editor → New query → Run.
-- All reads/writes of these tables happen ONLY through the Cloudflare Worker using the
-- Supabase secret key. Browsers (publishable key) get no access at all.

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  created_at  timestamptz not null default now()
);
-- usernames are unique, case-insensitively
create unique index if not exists profiles_username_lower_key on public.profiles (lower(username));

create table if not exists public.payments (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  razorpay_order_id    text not null unique,
  razorpay_payment_id  text unique,                       -- unique => one payment can never be used twice
  amount               integer not null check (amount > 0), -- in paise
  currency             text not null default 'INR',
  status               text not null default 'created' check (status in ('created','paid','failed')),
  created_at           timestamptz not null default now(),
  paid_at              timestamptz
);
create index if not exists payments_user_id_idx on public.payments (user_id);

create table if not exists public.entitlements (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  premium     boolean not null default false,
  payment_id  text unique,
  granted_at  timestamptz not null default now()
);

-- Lock everything down: RLS on, no policies, no grants for browser roles.
alter table public.profiles     enable row level security;
alter table public.payments     enable row level security;
alter table public.entitlements enable row level security;
revoke all on public.profiles, public.payments, public.entitlements from anon, authenticated;
