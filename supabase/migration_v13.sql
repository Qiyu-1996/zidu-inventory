-- v13: Store structured order source metadata for production reporting.
-- This keeps reports from depending only on parsing the human-readable order number.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'web_admin';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel_meta JSONB DEFAULT '{}'::jsonb;

UPDATE orders
SET source = COALESCE(source, 'web_admin'),
    channel_meta = COALESCE(channel_meta, '{}'::jsonb);
