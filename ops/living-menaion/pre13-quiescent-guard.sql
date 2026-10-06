-- Proposed installer guard; not a standalone migration and not applied remotely.
-- Use only when migration13 is absent, after prerequisites10+12 and before13,
-- inside the SAME installation transaction. Both admission writers must already
-- be paused and their in-flight calls drained; the lock alone cannot prove that.
-- On rejection, wait for original expiry. Do not delete or reset counters.
do $$
begin
  perform pg_catalog.pg_advisory_xact_lock(194819, 1);
  if exists (
    select from menaion_feedback_private.rate_buckets
      where expires_at > pg_catalog.clock_timestamp()
  ) then
    raise check_violation using message = 'PRE13_LIVE_RATE_COUNTERS';
  end if;
end;
$$;
