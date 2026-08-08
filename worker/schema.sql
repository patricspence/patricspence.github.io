CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seen_at TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  page_path TEXT NOT NULL,
  referrer_host TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  browser_type TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_seen_at ON events(seen_at);
CREATE INDEX IF NOT EXISTS events_page_path ON events(page_path);
CREATE INDEX IF NOT EXISTS events_referrer_host ON events(referrer_host);
