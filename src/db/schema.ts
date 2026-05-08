const SCHEMA = `
CREATE TABLE IF NOT EXISTS metrics (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_label TEXT NOT NULL DEFAULT '',
  metric_type TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  collected_at TEXT NOT NULL,
  tags TEXT DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_metrics_type ON metrics(metric_type);
CREATE INDEX IF NOT EXISTS idx_metrics_source ON metrics(source);
CREATE INDEX IF NOT EXISTS idx_metrics_collected ON metrics(collected_at);
CREATE INDEX IF NOT EXISTS idx_metrics_type_collected ON metrics(metric_type, collected_at);

CREATE TABLE IF NOT EXISTS baselines (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  mean REAL NOT NULL,
  stddev REAL NOT NULL DEFAULT 0,
  min REAL NOT NULL,
  max REAL NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  window_hours INTEGER NOT NULL DEFAULT 24,
  computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_baselines_source_type ON baselines(source, metric_type);

CREATE TABLE IF NOT EXISTS anomalies (
  id TEXT PRIMARY KEY,
  metric_id TEXT NOT NULL,
  baseline_id TEXT NOT NULL,
  source TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  observed_value REAL NOT NULL,
  expected_mean REAL NOT NULL,
  z_score REAL NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK(severity IN ('low','medium','high','critical')),
  direction TEXT NOT NULL CHECK(direction IN ('above','below')),
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  acknowledged INTEGER NOT NULL DEFAULT 0,
  tags TEXT DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_anomalies_severity ON anomalies(severity);
CREATE INDEX IF NOT EXISTS idx_anomalies_acknowledged ON anomalies(acknowledged);
CREATE INDEX IF NOT EXISTS idx_anomalies_detected ON anomalies(detected_at);
CREATE INDEX IF NOT EXISTS idx_anomalies_type ON anomalies(metric_type);
`;

export function getSchema(): string {
  return SCHEMA;
}
