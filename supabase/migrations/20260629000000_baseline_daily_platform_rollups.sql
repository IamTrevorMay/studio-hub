-- Baseline snapshot of the daily_platform_rollups materialized view, its indexes,
-- grants, and refresh function, captured verbatim from the live database on
-- 2026-06-29. The early analytics migrations in this repo are empty stubs (the
-- schema was applied directly to remote), so this file is the first committed
-- record of the matview's actual definition. It is the rollback anchor for the
-- Phase 1 engagement-weighting rebuild.
--
-- This migration is idempotent and re-applies the CURRENT (pre-fix) definition.
-- Apply order: this file, then 20260629000001_weighted_engagement_rollups.sql.

DROP MATERIALIZED VIEW IF EXISTS daily_platform_rollups;

CREATE MATERIALIZED VIEW daily_platform_rollups AS
SELECT d.date,
    pa.id AS platform_account_id,
    pa.platform,
    pa.account_name,
    COALESCE(pdm.views, 0::bigint)::numeric AS total_views,
    CASE
        WHEN pdm.likes IS NOT NULL THEN pdm.likes::numeric
        ELSE COALESCE(cm_agg.total_likes, 0::numeric)
    END AS total_likes,
    CASE
        WHEN pdm.comments IS NOT NULL THEN pdm.comments::numeric
        ELSE COALESCE(cm_agg.total_comments, 0::numeric)
    END AS total_comments,
    CASE
        WHEN pdm.shares IS NOT NULL THEN pdm.shares::numeric
        ELSE COALESCE(cm_agg.total_shares, 0::numeric)
    END AS total_shares,
    COALESCE(cm_agg.avg_engagement_rate, 0::numeric) AS avg_engagement_rate,
    CASE
        WHEN pdm.watch_time_seconds IS NOT NULL THEN pdm.watch_time_seconds
        ELSE COALESCE(cm_agg.total_watch_time_seconds, 0::numeric)
    END AS total_watch_time_seconds,
    COALESCE(cm_agg.posts_published, 0::bigint) AS posts_published,
    COALESCE(aud.followers_total, 0::bigint) AS followers_eod,
    COALESCE(aud.followers_gained, 0) AS followers_gained,
    COALESCE(rev_agg.revenue_cents, 0::bigint) AS revenue_cents,
    COALESCE(rev_agg.transaction_count, 0::bigint) AS revenue_transactions
   FROM generate_series(CURRENT_DATE - '730 days'::interval, CURRENT_DATE::timestamp without time zone, '1 day'::interval) d(date)
     CROSS JOIN platform_accounts pa
     LEFT JOIN LATERAL ( SELECT count(DISTINCT ci.id) AS posts_published,
            sum(cm_latest.views) AS total_views,
            sum(cm_latest.likes) AS total_likes,
            sum(cm_latest.comments) AS total_comments,
            sum(cm_latest.shares) AS total_shares,
            avg(cm_latest.engagement_rate) AS avg_engagement_rate,
            sum(cm_latest.watch_time_seconds) AS total_watch_time_seconds
           FROM content_items ci
             JOIN LATERAL ( SELECT cm.views,
                    cm.likes,
                    cm.comments,
                    cm.shares,
                    cm.engagement_rate,
                    cm.watch_time_seconds
                   FROM content_metrics cm
                  WHERE cm.content_item_id = ci.id
                  ORDER BY cm.captured_at DESC
                 LIMIT 1) cm_latest ON true
          WHERE ci.platform_account_id = pa.id AND ci.published_at::date = d.date) cm_agg ON true
     LEFT JOIN platform_daily_metrics pdm ON pdm.platform_account_id = pa.id AND pdm.date = d.date
     LEFT JOIN audience_snapshots aud ON aud.platform_account_id = pa.id AND aud.date = d.date
     LEFT JOIN LATERAL ( SELECT sum(re.net_amount_cents) AS revenue_cents,
            count(*) AS transaction_count
           FROM revenue_events re
          WHERE re.occurred_at::date = d.date AND re.platform_account_id = pa.id) rev_agg ON true
  WHERE pa.is_active = true AND (pdm.id IS NOT NULL OR aud.id IS NOT NULL OR cm_agg.posts_published > 0 OR rev_agg.revenue_cents > 0);

-- Unique index is REQUIRED for REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX idx_daily_platform_rollups_unique
  ON daily_platform_rollups USING btree (date, platform_account_id);
CREATE INDEX idx_daily_platform_rollups_date
  ON daily_platform_rollups USING btree (date);

GRANT ALL ON daily_platform_rollups TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refresh_daily_platform_rollups()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY daily_platform_rollups;
END;
$function$;
