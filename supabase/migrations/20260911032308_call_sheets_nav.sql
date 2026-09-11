-- Place the new "call_sheets" page in the Pre-Production folder, right after
-- the Beat Sheet page ("production"). Same shape as
-- 20260826120000_graphics_to_pre_production.sql — migrations are the only
-- nav_config writer since Edit Nav was removed.
DO $$
DECLARE
  _config jsonb;
  _items  jsonb;
  _new    jsonb := '[]'::jsonb;
  _cs     jsonb := NULL;
  _entry  jsonb;
  _i      int;
  _placed boolean := false;
BEGIN
  SELECT config INTO _config FROM nav_config LIMIT 1;
  IF _config IS NULL OR _config->'items' IS NULL THEN RETURN; END IF;
  _items := _config->'items';

  -- First pass: re-point any existing call_sheets entry.
  FOR _i IN 0 .. jsonb_array_length(_items) - 1 LOOP
    _entry := _items->_i;
    IF _entry->>'type' = 'item' AND _entry->>'key' = 'call_sheets' THEN
      _cs := jsonb_set(_entry, '{folderId}', '"pre_production"'::jsonb);
    END IF;
  END LOOP;

  IF _cs IS NULL THEN
    _cs := '{"type":"item","key":"call_sheets","label":"Call Sheets","folderId":"pre_production"}'::jsonb;
  END IF;

  -- Second pass: rebuild, inserting call_sheets right after production.
  FOR _i IN 0 .. jsonb_array_length(_items) - 1 LOOP
    _entry := _items->_i;
    IF _entry->>'type' = 'item' AND _entry->>'key' = 'call_sheets' THEN
      CONTINUE;
    END IF;
    _new := _new || jsonb_build_array(_entry);
    IF _entry->>'type' = 'item' AND _entry->>'key' = 'production' THEN
      _new := _new || jsonb_build_array(_cs);
      _placed := true;
    END IF;
  END LOOP;

  -- No production entry in the saved config: append at the end. useNavConfig
  -- appends code-catalog items missing from the DB anyway; this keeps the
  -- folder placement either way.
  IF NOT _placed THEN
    _new := _new || jsonb_build_array(_cs);
  END IF;

  UPDATE nav_config SET config = jsonb_set(_config, '{items}', _new);
END $$;
