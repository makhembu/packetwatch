import { serve } from '@hono/node-server';
import { api } from './api/routes.js';
import { initDb } from './db/init.js';
import { Hono } from 'hono';

const app = new Hono();

app.route('/', api);

app.get('/', (c) => {
  return c.json({
    name: 'PacketWatch — Network Anomaly Detection',
    version: '1.0.0',
    description: 'Behavioral baselines, z-score anomaly detection, and edge-collected metrics analysis',
    docs: {
      health: 'GET /health',
      ingestMetric: 'POST /metrics { source, metricType, value }',
      batchIngest: 'POST /metrics/batch { metrics: [...] }',
      getMetrics: 'GET /metrics?source=&type=&since=&limit=&offset=',
      computeBaselines: 'POST /baselines/compute',
      getBaselines: 'GET /baselines',
      getBaseline: 'GET /baselines/:source/:type',
      runDetection: 'POST /detect/run',
      detectMetric: 'POST /detect/:source/:type',
      getAnomalies: 'GET /anomalies?severity=&acknowledged=&source=',
      acknowledge: 'POST /anomalies/:id/acknowledge',
      dashboard: 'GET /dashboard',
    },
    exampleEdgeAgent: {
      curl: 'curl -X POST http://localhost:3003/metrics -H "Content-Type: application/json" -d \'{"source":"edge_sensor","metricType":"bytes_in","value":1048576,"unit":"bytes"}\'',
    },
  });
});

const PORT = Number(process.env.PORT) || 3003;

initDb();

console.log(`[packetwatch] Starting server on port ${PORT}`);
serve({ fetch: app.fetch, port: PORT });

export default app;
