-- 北海道サウナ手帳：利用者の現地レポート
-- Cloudflare D1 の SQL Console で最初に一度だけ実行してください。

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  facility_id TEXT NOT NULL,
  facility_name TEXT NOT NULL,
  visit_date TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('男性', '女性', '共用', '不明')),
  sauna_temp INTEGER CHECK (sauna_temp IS NULL OR (sauna_temp BETWEEN 0 AND 130)),
  water_temp INTEGER CHECK (water_temp IS NULL OR (water_temp BETWEEN 0 AND 40)),
  crowd TEXT NOT NULL DEFAULT '' CHECK (crowd IN ('', '空いていた', '普通', '混雑していた')),
  tags_json TEXT NOT NULL DEFAULT '[]',
  comment TEXT NOT NULL DEFAULT '',
  nickname TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT,
  reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_reports_facility_status_visit
  ON reports (facility_id, status, visit_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reports_status_created
  ON reports (status, created_at DESC);
