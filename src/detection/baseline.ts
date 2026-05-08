import { getDb } from '../db/init.js';
import { Baseline, SourceType, MetricType } from '../types.js';

export function computeBaseline(source: SourceType, metricType: MetricType, windowHours: number = 24): Baseline {
  const db = getDb();
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  const rows = db.prepare(
    'SELECT value FROM metrics WHERE source = ? AND metric_type = ? AND collected_at >= ? ORDER BY collected_at'
  ).all(source, metricType, cutoff) as { value: number }[];

  db.close();

  const values = rows.map(r => r.value);
  const sampleCount = values.length;

  if (sampleCount === 0) {
    return {
      id: `bl_${source}_${metricType}_${Date.now().toString(36)}`,
      source,
      metricType,
      mean: 0,
      stddev: 0,
      min: 0,
      max: 0,
      sampleCount: 0,
      windowHours,
      computed_at: new Date().toISOString(),
    };
  }

  const mean = values.reduce((a, b) => a + b, 0) / sampleCount;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / sampleCount;
  const stddev = Math.sqrt(variance);
  const min = Math.min(...values);
  const max = Math.max(...values);

  const id = `bl_${source}_${metricType}_${Date.now().toString(36)}`;
  const computed_at = new Date().toISOString();

  const db2 = getDb();
  db2.prepare(`
    INSERT INTO baselines (id, source, metric_type, mean, stddev, min, max, sample_count, window_hours, computed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source, metric_type) DO UPDATE SET
      mean = excluded.mean,
      stddev = excluded.stddev,
      min = excluded.min,
      max = excluded.max,
      sample_count = excluded.sample_count,
      computed_at = excluded.computed_at
  `).run(id, source, metricType, mean, stddev, min, max, sampleCount, windowHours, computed_at);
  db2.close();

  return { id, source, metricType, mean, stddev, min, max, sampleCount, windowHours, computed_at };
}

export function getBaseline(source: SourceType, metricType: MetricType): Baseline | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM baselines WHERE source = ? AND metric_type = ?'
  ).get(source, metricType) as any;
  db.close();

  if (!row) return null;

  return {
    id: row.id,
    source: row.source,
    metricType: row.metric_type,
    mean: row.mean,
    stddev: row.stddev,
    min: row.min,
    max: row.max,
    sampleCount: row.sample_count,
    windowHours: row.window_hours,
    computed_at: row.computed_at,
  };
}

export function computeAllBaselines(windowHours?: number): Baseline[] {
  const db = getDb();
  const sources = db.prepare('SELECT DISTINCT source FROM metrics').all() as { source: string }[];
  const types = db.prepare('SELECT DISTINCT metric_type FROM metrics').all() as { metric_type: string }[];
  db.close();

  const baselines: Baseline[] = [];
  for (const s of sources) {
    for (const t of types) {
      baselines.push(computeBaseline(s.source as SourceType, t.metric_type as MetricType, windowHours));
    }
  }
  return baselines;
}
