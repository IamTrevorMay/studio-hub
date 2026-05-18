-- Move the "timeline" nav item into the "post_production" folder,
-- positioned right after "post_show" (Clipping Tool).
DO $$
DECLARE
  _config   jsonb;
  _items    jsonb;
  _new      jsonb := '[]'::jsonb;
  _timeline jsonb := NULL;
  _entry    jsonb;
  _i        int;
BEGIN
  SELECT config INTO _config FROM nav_config LIMIT 1;
  IF _config IS NULL OR _config->'items' IS NULL THEN RETURN; END IF;
  _items := _config->'items';

  -- First pass: find + remove the timeline entry, set its folderId
  FOR _i IN 0 .. jsonb_array_length(_items) - 1 LOOP
    _entry := _items->_i;
    IF _entry->>'type' = 'item' AND _entry->>'key' = 'timeline' THEN
      _timeline := jsonb_set(_entry, '{folderId}', '"post_production"'::jsonb);
    END IF;
  END LOOP;

  -- If timeline wasn't in the saved config yet, build a fresh entry
  IF _timeline IS NULL THEN
    _timeline := '{"type":"item","key":"timeline","label":"Timeline","folderId":"post_production"}'::jsonb;
  END IF;

  -- Second pass: rebuild items, inserting timeline right after post_show
  FOR _i IN 0 .. jsonb_array_length(_items) - 1 LOOP
    _entry := _items->_i;
    -- Skip the old timeline entry (we'll re-insert it after post_show)
    IF _entry->>'type' = 'item' AND _entry->>'key' = 'timeline' THEN
      CONTINUE;
    END IF;
    _new := _new || jsonb_build_array(_entry);
    -- Insert timeline right after post_show
    IF _entry->>'type' = 'item' AND _entry->>'key' = 'post_show' THEN
      _new := _new || jsonb_build_array(_timeline);
    END IF;
  END LOOP;

  UPDATE nav_config SET config = jsonb_set(_config, '{items}', _new);
END $$;
