-- Phase 2: get_kpi_summary — one call returns the decision-row KPIs for a window
-- plus two deltas, generalizing the Weekly Report's WoW + trailing-4-week math
-- to any window length.
--
-- For the selected window it also computes the immediately-preceding window of
-- the same length ("prev") and the average of the 4 preceding windows ("base4").
-- The client derives the two deltas (vs prev, vs trailing-4 average) and the
-- efficiency ratios (views/post, blended RPM).
--
-- Reach / efficiency / audience metrics come from daily_platform_rollups (which
-- already exposes posts_published + followers_gained). Revenue is summed from
-- revenue_events directly so the figure is COMPLETE — it includes YouTube ad
-- revenue, merch, subscriptions, and non-platform/company revenue (null
-- platform_account_id) that the per-platform rollup intentionally omits.
--
-- SECURITY INVOKER (the default) on purpose: revenue_events is admin-gated by
-- RLS, so a non-admin caller simply gets 0 revenue rather than a leak.
--
-- Account filter semantics: when p_account_ids is null the result spans all
-- accounts AND includes company/unattributed revenue; when a filter is given,
-- only those accounts' rollup rows and revenue rows are counted.

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
      ON re.occurred_at::date BETWEEN w.ws AND w.we
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