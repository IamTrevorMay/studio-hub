-- Add Twitter and Threads platform types
ALTER TYPE platform_type ADD VALUE IF NOT EXISTS 'twitter';
ALTER TYPE platform_type ADD VALUE IF NOT EXISTS 'threads';

-- Create platform accounts
INSERT INTO platform_accounts (account_name, platform, external_id, is_active)
VALUES
  ('IamTrevorMay Twitter', 'twitter', 'iamtrevormay', true),
  ('IamTrevorMay Threads', 'threads', 'iamtrevormay', true)
ON CONFLICT DO NOTHING;
