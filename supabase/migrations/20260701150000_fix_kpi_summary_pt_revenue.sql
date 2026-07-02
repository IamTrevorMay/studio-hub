-- Fix get_kpi_summary revenue windowing to use the Pacific calendar.
--
-- revenue_events.occurred_at is timestamptz; `occurred_at::date` casts in the
-- DB session timezone (UTC), so a charge at e.g. Jun 30 8pm PT (Jul 1 03:00 UTC)
-- bucketed into the next day/window. The window bounds (ws/we) are PT calendar
-- dates derived from the client's PT-anchored p_start/p_end, so compare against
-- the PT calendar date of the event instead. daily_platform_rollups.date is
-- already a PT-bucketed plain date, so the reach/efficiency join is unchanged.

CREATE OR REPLACE FUNCTION public.get_kpi_summary(
  p_start date,
  p_end date,
  p_account_ids uuid[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  WITH params AS (
    SELECT GREATEST((p_end - p_start) + 1, 1) AS len
  ),
  windows AS (
    SELECT i,
           (p_start - (i * (SELECT len FROM params)))::date AS ws,
           (p_end   - (i * (SELECT len FROM params)))::date AS we
    FROM generate_series(0, 4) AS i
  ),
  roll AS (
    SELECT w.i,
           COALESCE(sum(r.total_views), 0)       AS views,
           COALESCE(sum(r.posts_published), 0)   AS posts,
           COALESCE(sum(r.followers_gained), 0)  AS followers_gained
    FROM windows w
    LEFT JOIN daily_platform_rollups r
      ON r.date BETWEEN w.ws AND w.we
     AND (p_account_ids IS NULL OR r.platform_account_id = ANY(p_account_ids))
    GROUP BY w.i
  ),
  rev AS (
    SELECT w.i,
           COALESCE(sum(COALESCE(re.net_amount_cents, re.amount_cents)), 0) AS revenue_cents
    FROM windows w
    LEFT JOIN revenue_events re
      ON (re.occurred_at AT TIME ZONE 'America/Los_Angeles')::date BETWEEN w.ws AND w.we
     AND (p_account_ids IS NULL OR re.platform_account_id = ANY(p_account_ids))
    GROUP BY w.i
  ),
  merged AS (
    SELECT roll.i, roll.views, roll.posts, roll.followers_gained, rev.revenue_cents
    FROM roll JOIN rev USING (i)
  )
  SELECT jsonb_build_object(
    'window', jsonb_build_object('start', p_start, 'end', p_end,
                                 'len_days', (SELECT len FROM params)),
    'current', (SELECT to_jsonb(m) - 'i' FROM merged m WHERE i = 0),
    'prev',    (SELECT to_jsonb(m) - 'i' FROM merged m WHERE i = 1),
    'base4',   (SELECT jsonb_build_object(
                  'views', avg(views), 'posts', avg(posts),
                  'followers_gained', avg(followers_gained),
                  'revenue_cents', avg(revenue_cents))
                FROM merged WHERE i BETWEEN 1 AND 4)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_kpi_summary(date, date, uuid[]) TO anon, authenticated, service_role;
