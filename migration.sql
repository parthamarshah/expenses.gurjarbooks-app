-- ─── TABLES ──────────────────────────────────────────────────────────────────
create table if not exists public.trips (
  id          text        primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  name        text        not null,
  budget      int         not null default 0,
  created_at  timestamptz not null default now(),
  pinned      bool        not null default false,
  archived    bool        not null default false
);

create table if not exists public.expenses (
  id          text        primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  amount      int         not null,
  note        text        not null default '',
  category    text        not null default 'personal',
  pay_mode    text        not null default 'bank',
  date        timestamptz not null default now(),
  trip_id     text        references public.trips(id) on delete set null
);

-- ─── ROW LEVEL SECURITY ───────────────────────────────────────────────────────
alter table public.trips    enable row level security;
alter table public.expenses enable row level security;

create policy "trips_all"    on public.trips    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "expenses_all" on public.expenses for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─── REALTIME ─────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.expenses;
alter publication supabase_realtime add table public.trips;
