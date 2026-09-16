-- Ideas sent to the Slate now stay on the Ideas board (like Up Next → Add
-- Project already did for Projects) so the send can be undone. The link mirrors
-- write_ideas.project_id: ON DELETE SET NULL, so removing the queue item (or
-- its beat sheet, which cascades) frees the idea again.
ALTER TABLE write_ideas
  ADD COLUMN IF NOT EXISTS film_queue_item_id UUID REFERENCES film_queue_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS write_ideas_film_queue_item_id_idx
  ON write_ideas(film_queue_item_id) WHERE film_queue_item_id IS NOT NULL;
