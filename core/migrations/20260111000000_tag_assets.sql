-- Add asset fields for custom emoji rendering
ALTER TABLE tags
    ADD COLUMN IF NOT EXISTS asset_url TEXT,
    ADD COLUMN IF NOT EXISTS asset_mime TEXT;
