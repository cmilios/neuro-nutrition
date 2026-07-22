-- Durable, operator-only attribution for every billable provider call.
-- The Edge Function inserts with the server-side service role; public clients
-- receive no table or view privileges and no RLS policies grant row access.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ai_usage_reader') then
    create role ai_usage_reader nologin noinherit;
  end if;
end;
$$;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, ai_usage_reader;

create table public.ai_usage_records (
  id                         bigint generated always as identity primary key,
  call_id                    uuid not null unique,
  user_id                    uuid not null references auth.users (id) on delete restrict,
  action                     text not null check (action in ('plan', 'meal')),
  attempt                    integer not null check (attempt > 0),
  provider                   text not null,
  model                      text not null,
  provider_response_id       text,
  provider_request_id        text,
  input_tokens               bigint check (input_tokens is null or input_tokens >= 0),
  cached_input_tokens        bigint check (cached_input_tokens is null or cached_input_tokens >= 0),
  cache_write_input_tokens   bigint check (cache_write_input_tokens is null or cache_write_input_tokens >= 0),
  output_tokens              bigint check (output_tokens is null or output_tokens >= 0),
  reasoning_output_tokens    bigint check (reasoning_output_tokens is null or reasoning_output_tokens >= 0),
  total_tokens               bigint check (total_tokens is null or total_tokens >= 0),
  raw_usage                  jsonb,
  outcome                    text not null check (outcome in ('success', 'failure')),
  validation_codes           text[],
  error_code                 text,
  estimated_cost_usd         numeric(18, 12) check (
    estimated_cost_usd is null or estimated_cost_usd >= 0
  ),
  pricing_version            text,
  pricing_snapshot           jsonb,
  created_at                 timestamptz not null default now()
);

comment on table public.ai_usage_records is
  'Immutable operator-only ledger of billable AI provider calls.';

create index ai_usage_records_user_created_at_idx
  on public.ai_usage_records (user_id, created_at desc);

create unique index ai_usage_records_provider_response_id_idx
  on public.ai_usage_records (provider, provider_response_id)
  where provider_response_id is not null;

alter table public.ai_usage_records enable row level security;

revoke all on table public.ai_usage_records from public, anon, authenticated, service_role, ai_usage_reader;
revoke all on sequence public.ai_usage_records_id_seq from public, anon, authenticated, service_role;
grant insert on table public.ai_usage_records to service_role;
grant select (call_id) on table public.ai_usage_records to service_role;
grant usage, select on sequence public.ai_usage_records_id_seq to service_role;
grant usage on schema public to ai_usage_reader;
grant select on table public.ai_usage_records to ai_usage_reader;

create policy "AI usage readers can read records"
on public.ai_usage_records
for select
to ai_usage_reader
using (true);

create or replace function private.prevent_ai_usage_record_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'AI Usage Records are immutable';
end;
$$;

revoke all on function private.prevent_ai_usage_record_mutation()
  from public, anon, authenticated;
grant execute on function private.prevent_ai_usage_record_mutation()
  to service_role;

create trigger prevent_ai_usage_record_mutation
before update or delete on public.ai_usage_records
for each row execute function private.prevent_ai_usage_record_mutation();

create trigger prevent_ai_usage_record_truncation
before truncate on public.ai_usage_records
for each statement execute function private.prevent_ai_usage_record_mutation();

create view public.ai_usage_by_user
with (security_invoker = true)
as
select
  user_id,
  count(*)::bigint as call_count,
  count(*) filter (where outcome = 'success')::bigint as successful_call_count,
  count(*) filter (where outcome = 'failure')::bigint as failed_call_count,
  count(estimated_cost_usd)::bigint as priced_call_count,
  coalesce(sum(input_tokens), 0)::bigint as input_tokens,
  coalesce(sum(cached_input_tokens), 0)::bigint as cached_input_tokens,
  coalesce(sum(cache_write_input_tokens), 0)::bigint as cache_write_input_tokens,
  coalesce(sum(output_tokens), 0)::bigint as output_tokens,
  coalesce(sum(reasoning_output_tokens), 0)::bigint as reasoning_output_tokens,
  coalesce(sum(total_tokens), 0)::bigint as total_tokens,
  sum(estimated_cost_usd) as estimated_cost_usd,
  min(created_at) as first_call_at,
  max(created_at) as latest_call_at
from public.ai_usage_records
group by user_id;

comment on view public.ai_usage_by_user is
  'Read-only operator rollup of AI calls, measured tokens, and estimated cost by user.';

revoke all on table public.ai_usage_by_user from public, anon, authenticated, service_role;
grant select on table public.ai_usage_by_user to ai_usage_reader;
