-- Run this migration before deploying the upgraded Worker.
ALTER TABLE events ADD COLUMN event_type TEXT NOT NULL DEFAULT 'pageview';
ALTER TABLE events ADD COLUMN event_target TEXT;
ALTER TABLE events ADD COLUMN previous_path TEXT;
ALTER TABLE events ADD COLUMN is_returning INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_events_type_seen_at ON events(event_type, seen_at);
CREATE INDEX IF NOT EXISTS idx_events_path_seen_at ON events(page_path, seen_at);
CREATE INDEX IF NOT EXISTS idx_events_previous_path_seen_at ON events(previous_path, seen_at);
