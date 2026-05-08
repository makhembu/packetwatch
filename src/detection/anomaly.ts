import { getDb } from '../db/init.js';
import { computeBaseline, getBaseline } from './baseline.js';
import { Anomaly, AnomalySeverity, SourceType, MetricType } from '../types.js';

const ZSCORE_THRESHOLD = Number(process.env.ANOMALY_ZSCORE_THRESHOLD) || 2.5;
const MIN_SAMPLES = Number(process.env.ANOMALY_BASELINE_MIN_SAMPLES) || 10;

function severityFromZScore(z: number): AnomalySeverity {
  const absZ = Math.abs(z);
  if (absZ >= 4) return 'critical';
  if (absZ >= 3) return 'high';
  if (absZ >= 2.5) return 'medium';
  return 'low';
}

export function detectAnomaliesForMetric(source: SourceType, metricType: MetricType): Anomaly[] {
  const db = getDb();
  const anomalies: Anomaly[] = [];

  let baseline = getBaseline(source, metricType);
  if (!baseline || baseline.sampleCount < MIN_SAMPLES) {
    baseline = computeBaseline(source, metricType);
  }

  if (baseline.sampleCount < MIN_SAMPLES || baseline.stddev === 0) {
    db.close();
    return anomalies;
  }

  const recentMetrics = db.prepare(
    "SELECT * FROM metrics WHERE source = ? AND metric_type = ? AND collected_at >= datetime('now', '-1 hour') ORDER BY collected_at DESC"
  ).all(source, metricType) as any[];

  const existingAnomalies = new Set(
    (db.prepare(
      "SELECT metric_id FROM anomalies WHERE metric_type = ? AND detected_at >= datetime('now', '-1 hour')"
    ).all(metricType) as any[]).map(r => r.metric_id)
  );

  const insert = db.prepare(`
    INSERT OR IGNORE INTO anomalies (id, metric_id, baseline_id, source, metric_type, observed_value, expected_mean, z_score, severity, direction, detected_at, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), '[]')
  `);

  const tx = db.transaction(() => {
    for (const metric of recentMetrics) {
      if (existingAnomalies.has(metric.id)) continue;

      const zScore = (metric.value - baseline!.mean) / baseline!.stddev;

      if (Math.abs(zScore) >= ZSCORE_THRESHOLD) {
        const id = `anom_${metric.id.slice(0, 8)}_${Date.now().toString(36)}`;
        const severity = severityFromZScore(zScore);
        const direction: 'above' | 'below' = zScore > 0 ? 'above' : 'below';

        insert.run(
          id, metric.id, baseline!.id, source, metricType,
          metric.value, baseline!.mean, Math.round(zScore * 100) / 100,
          severity, direction
        );

        anomalies.push({
          id,
          metricId: metric.id,
          baselineId: baseline!.id,
          source,
          metricType,
          observedValue: metric.value,
          expectedMean: baseline!.mean,
          zScore: Math.round(zScore * 100) / 100,
          severity,
          direction,
          detected_at: new Date().toISOString(),
          acknowledged: 0,
          tags: [],
        });
      }
    }
  });

  tx();
  db.close();
  return anomalies;
}

export function runFullDetection(): { anomalies: number; baselinesComputed: number } {
  const db = getDb();
  const sources = db.prepare('SELECT DISTINCT source FROM metrics').all() as { source: string }[];
  const types = db.prepare('SELECT DISTINCT metric_type FROM metrics').all() as { metric_type: string }[];
  db.close();

  let totalAnomalies = 0;
  for (const s of sources) {
    for (const t of types) {
      const results = detectAnomaliesForMetric(s.source as SourceType, t.metric_type as MetricType);
      totalAnomalies += results.length;
      if (results.length > 0) {
        console.log(`[packetwatch] ${s.source}/${t.metric_type}: ${results.length} anomalies`);
      }
    }
  }

  console.log(`[packetwatch] Detection complete: ${totalAnomalies} anomalies found across ${sources.length * types.length} metric-source pairs`);
  return { anomalies: totalAnomalies, baselinesComputed: sources.length * types.length };
}

if (process.argv[1]?.endsWith('anomaly.ts') || process.argv[1]?.endsWith('anomaly.js')) {
  const result = runFullDetection();
  console.log(`Total: ${result.anomalies} anomalies, ${result.baselinesComputed} baselines`);
}
