do $$
declare
  cutover_succeeded boolean;
begin
  if public.get_weekly_plan_rollout_state() = 'legacy' then
    update public.weekly_plan_rollout
    set state = 'maintenance', updated_at = clock_timestamp()
    where singleton and state = 'legacy';
  end if;

  if public.get_weekly_plan_rollout_state() = 'maintenance' then
    select public.migrate_legacy_weekly_plans()
    into cutover_succeeded;
    if cutover_succeeded is distinct from true then
      raise exception
        'Weekly Plan cutover aborted and restored legacy service; fix the source and retry this migration';
    end if;
  end if;

  if public.get_weekly_plan_rollout_state() <> 'authoritative' then
    raise exception 'Weekly Plan cutover did not reach authoritative state';
  end if;
end
$$;
