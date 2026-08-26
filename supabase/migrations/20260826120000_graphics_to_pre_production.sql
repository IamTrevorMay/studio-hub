-- Move the "graphics" nav item out of the Beta folder and into the
-- "pre_production" folder, positioned right after "screenwriter".
--
-- Re-applies 20260626120000_move_graphics_to_pre_production.sql, which a later
-- Edit Nav save clobbered (the editor persisted the whole items array back
-- without graphics). Edit Nav is gone now, so this is the only writer.
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

  -- First pass: find any existing graphics entry and re-point its folderId
  FOR _i IN 0 .. jsonb_array_length(_items) - 1 LOOP
    _entry := _items->_i;
    IF _entry->>'type' = 'item' AND _entry->>'key' = 'graphics' THEN
      _graphics := jsonb_set(_entry, '{folderId}', '"pre_production"'::jsonb);
    END IF;
  END LOOP;

  -- Not in the saved config yet (current state) — build a fresh entry
  IF _graphics IS NULL THEN
    _graphics := '{"type":"item","key":"graphics","label":"Graphics","folderId":"pre_production"}'::jsonb;
  END IF;

  -- Second pass: rebuild items, inserting graphics right after screenwriter
  FOR _i IN 0 .. jsonb_array_length(_items) - 1 LOOP
    _entry := _items->_i;
    IF _entry->>'type' = 'item' AND _entry->>'key' = 'graphics' THEN
      CONTINUE;
    END IF;
    _new := _new || jsonb_build_array(_entry);
    IF _entry->>'type' = 'item' AND _entry->>'key' = 'screenwriter' THEN
      _new := _new || jsonb_build_array(_graphics);
    END IF;
  END LOOP;

  UPDATE nav_config SET config = jsonb_set(_config, '{items}', _new);
END $$;
