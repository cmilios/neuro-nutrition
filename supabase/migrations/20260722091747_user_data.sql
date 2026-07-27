-- user_data: one row per authenticated user, holding their profile, meal plan,
-- and milestones as JSON. Row Level Security ensures a user can only read/write
-- their own row (auth.uid() = user_id).

create table if not exists public.user_data (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  profile     jsonb,
  meal_plan   jsonb,
  milestones  jsonb default '[]'::jsonb,
  updated_at  timestamptz default now()
);

alter table public.user_data enable row level security;

-- Policies (drop-if-exists so this migration is re-runnable).
drop policy if exists "Users can read own data"   on public.user_data;
drop policy if exists "Users can insert own data" on public.user_data;
drop policy if exists "Users can update own data" on public.user_data;
drop policy if exists "Users can delete own data" on public.user_data;

create policy "Users can read own data"
  on public.user_data for select
  using (auth.uid() = user_id);

create policy "Users can insert own data"
  on public.user_data for insert
  with check (auth.uid() = user_id);

create policy "Users can update own data"
  on public.user_data for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own data"
  on public.user_data for delete
  using (auth.uid() = user_id);
