import { Hono } from 'hono';
import { getDb } from '../db/init.js';
import { computeBaseline, computeAllBaselines } from '../detection/baseline.js';
import { detectAnomaliesForMetric, runFullDetection } from '../detection/anomaly.js';
import { SourceType, MetricType } from '../types.js';

export const api = new Hono();

function generateId(): string {
  return `met_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

api.get('/health', (c) => {
  const db = getDb();
  try {
    const metrics = (db.prepare('SELECT COUNT(*) as c FROM metrics').get() as { c: number }).c;
    const anomalies = (db.prepare('SELECT COUNT(*) as c FROM anomalies').get() as { c: number }).c;
    db.close();
    return c.json({ status: 'ok', metrics, anomalies, uptime: process.uptime() });
  } catch (err) {
    db.close();
    return c.json({ status: 'error', error: String(err) }, 500);
  }
});

api.post('/metrics', async (c) => {
  const body = await c.req.json() as {
    source: SourceType;
    sourceLabel?: string;
    metricType: MetricType;
    value: number;
    unit?: string;
    tags?: string[];
  };

  if (!body.source || !body.metricType || body.value === undefined) {
    return c.json({ error: 'source, metricType, and value are required' }, 400);
  }

  const id = generateId();
  const db = getDb();
  db.prepare(`
    INSERT INTO metrics (id, source, source_label, metric_type, value, unit, collected_at, tags)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
  `).run(
    id, body.source, body.sourceLabel || '', body.metricType,
    body.value, body.unit || '', JSON.stringify(body.tags || [])
  );
  db.close();

  return c.json({ id, status: 'recorded' }, 201);
});

api.post('/metrics/batch', async (c) => {
  const body = await c.req.json() as {
    metrics: { source: SourceType; sourceLabel?: string; metricType: MetricType; value: number; unit?: string; tags?: string[] }[];
  };

  if (!body.metrics || !Array.isArray(body.metrics) || body.metrics.length === 0) {
    return c.json({ error: 'metrics array is required' }, 400);
  }

  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO metrics (id, source, source_label, metric_type, value, unit, collected_at, tags)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
  `);

  const tx = db.transaction(() => {
    for (const m of body.metrics) {
      insert.run(generateId(), m.source, m.sourceLabel || '', m.metricType, m.value, m.unit || '', JSON.stringify(m.tags || []));
    }
  });

  tx();
  db.close();
  return c.json({ status: 'recorded', count: body.metrics.length }, 201);
});

api.get('/metrics', (c) => {
  const db = getDb();
  const source = c.req.query('source');
  const type = c.req.query('type');
  const since = c.req.query('since');
  const limit = Math.min(Number(c.req.query('limit')) || 100, 1000);
  const offset = Number(c.req.query('offset')) || 0;

  let where = 'WHERE 1=1';
  const params: unknown[] = [];

  if (source) { where += ' AND source = ?'; params.push(source); }
  if (type) { where += ' AND metric_type = ?'; params.push(type); }
  if (since) { where += ' AND collected_at >= ?'; params.push(since); }

  const total = (db.prepare(`SELECT COUNT(*) as c FROM metrics ${where}`).get(...params) as { c: number }).c;
  const rows = db.prepare(`SELECT * FROM metrics ${where} ORDER BY collected_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

  db.close();
  return c.json({ metrics: rows, total, query: { source, type, since, limit, offset } });
});

api.post('/baselines/compute', (c) => {
  const baselines = computeAllBaselines();
  return c.json({ message: 'Baselines computed', count: baselines.length });
});

api.get('/baselines', (c) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM baselines ORDER BY computed_at DESC').all();
  db.close();
  return c.json(rows);
});

api.get('/baselines/:source/:type', (c) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM baselines WHERE source = ? AND metric_type = ?').get(
    c.req.param('source'), c.req.param('type')
  );
  db.close();
  if (!row) return c.json({ error: 'Baseline not found' }, 404);
  return c.json(row);
});

api.post('/detect/run', (c) => {
  const results = runFullDetection();
  return c.json({ message: 'Detection complete', ...results });
});

api.post('/detect/:source/:type', (c) => {
  const anomalies = detectAnomaliesForMetric(
    c.req.param('source') as SourceType,
    c.req.param('type') as MetricType
  );
  return c.json({ source: c.req.param('source'), metricType: c.req.param('type'), anomalies, count: anomalies.length });
});

api.get('/anomalies', (c) => {
  const db = getDb();
  const severity = c.req.query('severity');
  const acknowledged = c.req.query('acknowledged');
  const source = c.req.query('source');
  const limit = Math.min(Number(c.req.query('limit')) || 50, 500);
  const offset = Number(c.req.query('offset')) || 0;

  let where = 'WHERE 1=1';
  const params: unknown[] = [];

  if (severity) { where += ' AND severity = ?'; params.push(severity); }
  if (acknowledged === 'true') { where += ' AND acknowledged = 1'; }
  else if (acknowledged === 'false') { where += ' AND acknowledged = 0'; }
  if (source) { where += ' AND source = ?'; params.push(source); }

  const total = (db.prepare(`SELECT COUNT(*) as c FROM anomalies ${where}`).get(...params) as { c: number }).c;
  const rows = db.prepare(`SELECT * FROM anomalies ${where} ORDER BY z_score DESC, detected_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  db.close();

  return c.json({ anomalies: rows, total, query: { severity, acknowledged, source, limit, offset } });
});

api.post('/anomalies/:id/acknowledge', (c) => {
  const db = getDb();
  db.prepare('UPDATE anomalies SET acknowledged = 1 WHERE id = ?').run(c.req.param('id'));
  db.close();
  return c.json({ status: 'acknowledged' });
});

api.get('/dashboard', (c) => {
  const db = getDb();

  const totalMetrics = (db.prepare('SELECT COUNT(*) as c FROM metrics').get() as { c: number }).c;
  const totalAnomalies = (db.prepare('SELECT COUNT(*) as c FROM anomalies').get() as { c: number }).c;
  const openAnomalies = (db.prepare('SELECT COUNT(*) as c FROM anomalies WHERE acknowledged = 0').get() as { c: number }).c;
  const severityCounts = db.prepare('SELECT severity, COUNT(*) as count FROM anomalies GROUP BY severity ORDER BY count DESC').all();
  const topSources = db.prepare('SELECT source, COUNT(*) as count FROM anomalies GROUP BY source ORDER BY count DESC LIMIT 10').all();
  const recentAnomalies = db.prepare("SELECT * FROM anomalies WHERE acknowledged = 0 ORDER BY z_score DESC LIMIT 20").all();
  const baselineCount = (db.prepare('SELECT COUNT(*) as c FROM baselines').get() as { c: number }).c;

  db.close();

  return c.json({
    metrics: { total: totalMetrics, bySource: topSources },
    anomalies: {
      total: totalAnomalies,
      open: openAnomalies,
      bySeverity: severityCounts,
      recent: recentAnomalies,
    },
    baselines: { total: baselineCount },
  });
});
