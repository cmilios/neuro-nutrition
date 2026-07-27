update public.weekly_plan_rollout
set state = 'maintenance', updated_at = clock_timestamp()
where singleton and state = 'legacy';

do $$
begin
  if public.get_weekly_plan_rollout_state() <> 'maintenance' then
    raise exception 'Weekly Plan rollout could not enter maintenance';
  end if;
end
$$;
