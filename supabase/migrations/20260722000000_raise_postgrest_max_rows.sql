-- Raise the PostgREST row cap from the default 1000 to 50000.
--
-- Why: several analytics reads (Content Health scoring + the per-format
-- "vs prior 14d" KPIs) fetch per-video daily rows with `.limit(50000)` and
-- aggregate client-side. With the 1000-row cap, only the ~10 most recent dates
-- came back, so the trailing/prior comparison window was always empty (every
-- "vs prior 14d" delta read against 0) and lifetime score aggregates were
-- silently truncated. The app's queries already carry explicit `.limit(50000)`
-- bounds, so 50000 matches their intent while still capping unbounded reads.
--
-- statement_timeout (8s for authenticated) still bounds runaway queries.

ALTER ROLE authenticator SET pgrst.db_max_rows = '50000';
NOTIFY pgrst, 'reload config';
