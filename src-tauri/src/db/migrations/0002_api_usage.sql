CREATE TABLE IF NOT EXISTS api_usage_logs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  task_id TEXT,
  run_id TEXT,
  endpoint TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  cost_usd REAL,
  success INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_credentials_provider_label
  ON provider_credentials(provider, label);