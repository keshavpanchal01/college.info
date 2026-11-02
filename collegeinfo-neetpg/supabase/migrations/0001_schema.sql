-- Apply this migration to the Supabase project's SQL Editor.
-- No client-side table policies are granted. All privileged writes are performed by the Cloudflare Pages Function.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[A-Za-z0-9_]{3,30}$')
);
create unique index if not exists profiles_username_ci_unique on public.profiles (lower(username));

create table if not exists public.payment_orders (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  razorpay_order_id text not null unique,
  razorpay_payment_id text unique,
  amount integer not null check (amount = 100),
  currency text not null default 'INR' check (currency = 'INR'),
  status text not null default 'created' check (status in ('created','captured','failed')),
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
create index if not exists payment_orders_user_id_idx on public.payment_orders(user_id);

create table if not exists public.premium_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  source text not null check (source = 'razorpay'),
  razorpay_order_id text not null unique references public.payment_orders(razorpay_order_id),
  razorpay_payment_id text not null unique references public.payment_orders(razorpay_payment_id),
  granted_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.payment_orders enable row level security;
alter table public.premium_entitlements enable row level security;

-- Deliberately no anon/authenticated policies: browser clients cannot read or write
-- profiles, payment records, or entitlement state. The Worker uses the service role.
revoke all on public.profiles from anon, authenticated;
revoke all on public.payment_orders from anon, authenticated;
revoke all on public.premium_entitlements from anon, authenticated;
grant all on public.profiles to service_role;
grant all on public.payment_orders to service_role;
grant all on public.premium_entitlements to service_role;
grant usage, select on all sequences in schema public to service_role;
