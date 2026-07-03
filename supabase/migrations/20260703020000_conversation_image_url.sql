-- Custom group-conversation photo shown as the conversation icon in Messages.
-- Only the group's creator can set it (existing "Creator can update conversation"
-- RLS policy already gates UPDATE to created_by = auth.uid()).
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS image_url TEXT;
