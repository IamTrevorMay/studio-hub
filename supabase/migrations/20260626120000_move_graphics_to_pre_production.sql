-- Move the "graphics" nav item into the "pre_production" folder,
-- positioned right after "screenwriter".
DO $$
DECLARE
  _config   jsonb;
  _items    jsonb;
  _new      jsonb := '[]'::jsonb;
  _graphics jsonb := NULL;
  _entry    jsonb;
  _i        int;
BEGIN
  SELECT config INTO _config FROM nav_config LIMIT 1;
  IF _config IS NULL OR _config->'items' IS NULL THEN RETURN; END IF;
  _items := _config->'items';

  -- First pass: find + remove the graphics entry, set its folderId
  FOR _i IN 0 .. jsonb_array_length(_items) - 1 LOOP
    _entry := _items->_i;
    IF _entry->>'type' = 'item' AND _entry->>'key' = 'graphics' THEN
      _graphics := jsonb_set(_entry, '{folderId}', '"pre_production"'::jsonb);
    END IF;
  END LOOP;

  -- If graphics wasn't in the saved config yet, build a fresh entry
  IF _graphics IS NULL THEN
    _graphics := '{"type":"item","key":"graphics","label":"Graphics","folderId":"pre_production"}'::jsonb;
  END IF;

  -- Second pass: rebuild items, inserting graphics right after screenwriter
  FOR _i IN 0 .. jsonb_array_length(_items) - 1 LOOP
    _entry := _items->_i;
    -- Skip the old graphics entry (we'll re-insert it after screenwriter)
    IF _entry->>'type' = 'item' AND _entry->>'key' = 'graphics' THEN
      CONTINUE;
    END IF;
    _new := _new || jsonb_build_array(_entry);
    -- Insert graphics right after screenwriter
    IF _entry->>'type' = 'item' AND _entry->>'key' = 'screenwriter' THEN
      _new := _new || jsonb_build_array(_graphics);
    END IF;
  END LOOP;

  UPDATE nav_config SET config = jsonb_set(_config, '{items}', _new);
END $$;
