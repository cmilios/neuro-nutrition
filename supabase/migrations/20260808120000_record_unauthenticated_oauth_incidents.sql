-- OAuth sign-in failures are reported from views that have no session: the
-- provider callback returning an error, session restoration failing, and the
-- redirect failing to start. Those paths ran as `anon`, which could neither
-- execute the reporter nor satisfy the context contract, so every one of them
-- was discarded before it reached an operator surface.
--
-- This migration makes signed-out OAuth incidents recordable and aligns the
-- stored context with the contract the client actually sends.

-- 1. Attribute-free incidents. A signed-out OAuth failure has no user to
--    attribute, so `user_id` becomes optional. The foreign key still holds for
--    every authenticated incident.
alter table public.weekly_plan_client_incidents
  alter column user_id drop not null;

-- 2. The event_type allow-list, restated in full so this migration repairs the
--    constraint whether or not 20260805120000 has been applied.
alter table public.weekly_plan_client_incidents
  drop constraint weekly_plan_client_incidents_event_type_check;

alter table public.weekly_plan_client_incidents
  add constraint weekly_plan_client_incidents_event_type_check
  check (event_type in (
    'authoritative_load_failure',
    'authoritative_refetch_failure',
    'realtime_recovery_succeeded',
    'realtime_recovery_failure',
    'unknown_command_outcome',
    'revision_mismatch',
    'forced_reload_failure',
    'oauth_auth_failure'
  ));

-- 3. The context allow-list must match `CONTEXT_KEYS` in
--    services/clientIncidentTelemetry.ts exactly. It previously omitted
--    `lifecycleStage`, `releaseIdentifier` and `timestamp`, so the OAuth
--    payload failed this check constraint on every insert. The list stays
--    closed and every value stays a short string, so the privacy guarantee is
--    unchanged: tokens, authorization codes, emails and raw provider text still
--    cannot be stored under any key.
create or replace function private.is_privacy_limited_client_context(
  p_context jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  entry record;
begin
  if jsonb_typeof(p_context) <> 'object' or pg_column_size(p_context) > 2048 then
    return false;
  end if;
  for entry in select * from jsonb_each(p_context)
  loop
    if entry.key not in (
        'provider',
        'phase',
        'lifecycleStage',
        'operation',
        'authorityStatus',
        'errorCode',
        'releaseIdentifier',
        'timestamp'
      )
      or jsonb_typeof(entry.value) <> 'string'
      or length(entry.value #>> '{}') > 80
    then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- Keeps the anonymous rate-limit probe below cheap as the table grows.
create index if not exists weekly_plan_client_incidents_anonymous_recent_idx
  on public.weekly_plan_client_incidents (created_at desc)
  where user_id is null;

-- 4. Signed-out reporting, deliberately narrow.
create or replace function public.record_weekly_plan_client_incident(
  p_event_type text,
  p_context jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_recent_anonymous integer;
begin
  if v_user_id is null then
    -- Only the OAuth sign-in failure paths legitimately report without a
    -- session. Every other event type still requires authentication.
    if p_event_type <> 'oauth_auth_failure' then
      raise exception 'Authentication is required';
    end if;

    select count(*) into v_recent_anonymous
    from public.weekly_plan_client_incidents
    where user_id is null
      and created_at >= now() - interval '1 minute';

    -- Granting `anon` execute opens an unauthenticated write path, so bound it.
    -- Past the cap the incident is dropped rather than rejected: telemetry is
    -- best-effort and must never surface an error into a sign-in recovery path.
    -- Trade-off: a flood can crowd out genuine signal for that minute, which is
    -- preferable to unbounded anonymous inserts.
    if v_recent_anonymous >= 100 then
      return;
    end if;
  end if;

  insert into public.weekly_plan_client_incidents (user_id, event_type, context)
  values (v_user_id, p_event_type, coalesce(p_context, '{}'::jsonb));
end;
$$;

revoke all on function public.record_weekly_plan_client_incident(text, jsonb)
  from public;
grant execute on function public.record_weekly_plan_client_incident(text, jsonb)
  to anon, authenticated;
