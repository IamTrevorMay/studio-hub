-- Nightly prune: keep max 50 versions per sheet, delete anything older than 30 days beyond that
SELECT cron.schedule(
  'nightly-prune-beat-versions',
  '0 8 * * *',
  $$
    DELETE FROM beat_sheet_versions
    WHERE id IN (
      SELECT v.id
      FROM beat_sheet_versions v
      WHERE v.created_at < now() - interval '30 days'
        AND v.id NOT IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY sheet_id ORDER BY created_at DESC) AS rn
            FROM beat_sheet_versions
          ) ranked
          WHERE rn <= 50
        )
    );
  $$
);
