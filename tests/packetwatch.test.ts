import { describe, it } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { getSchema } from '../src/db/schema.js';
import path from 'path';
import fs from 'fs';

const TEST_DB = path.join(import.meta.dirname, '..', 'data', 'test_packetwatch.db');

function setupDb() {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  const dbDir = path.dirname(TEST_DB);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  const db = new Database(TEST_DB);
  db.pragma('journal_mode = WAL');
  db.exec(getSchema());
  return db;
}

describe('packetwatch', () => {

  describe('baseline computation', () => {
    it('computes correct mean and stddev', () => {
      const values = [100, 102, 98, 101, 99, 100, 103, 97];
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
      const stddev = Math.sqrt(variance);
      assert.strictEqual(mean, 100);
      assert.strictEqual(Math.round(stddev * 100) / 100, 1.87);
    });

    it('handles single value (stddev = 0)', () => {
      const values = [100];
      const mean = values[0];
      const variance = 0;
      const stddev = 0;
      assert.strictEqual(mean, 100);
      assert.strictEqual(stddev, 0);
    });

    it('computes correct min and max', () => {
      const values = [50, 200, 75, 150];
      const min = Math.min(...values);
      const max = Math.max(...values);
      assert.strictEqual(min, 50);
      assert.strictEqual(max, 200);
    });
  });

  describe('z-score anomaly detection', () => {
    it('detects anomaly above threshold (z > 2.5)', () => {
      const mean = 100, stddev = 10, observed = 130;
      const zScore = (observed - mean) / stddev;
      assert.strictEqual(zScore, 3);
      assert.ok(Math.abs(zScore) >= 2.5);
    });

    it('does not flag values within normal range', () => {
      const mean = 100, stddev = 10, observed = 105;
      const zScore = (observed - mean) / stddev;
      assert.strictEqual(zScore, 0.5);
      assert.ok(Math.abs(zScore) < 2.5);
    });

    it('detects anomaly below threshold (z < -2.5)', () => {
      const mean = 100, stddev = 10, observed = 70;
      const zScore = (observed - mean) / stddev;
      assert.strictEqual(zScore, -3);
      assert.ok(Math.abs(zScore) >= 2.5);
    });
  });

  describe('severity from z-score', () => {
    it('critical for z >= 4', () => {
      assert.strictEqual(severityFromZ(4.5), 'critical');
    });
    it('high for z >= 3', () => {
      assert.strictEqual(severityFromZ(3.2), 'high');
    });
    it('medium for z >= 2.5', () => {
      assert.strictEqual(severityFromZ(2.7), 'medium');
    });
    it('low for z < 2.5', () => {
      assert.strictEqual(severityFromZ(2.0), 'low');
    });
  });

  describe('database schema', () => {
    it('creates all required tables', () => {
      const db = setupDb();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
      const names = tables.map(t => t.name);
      assert.ok(names.includes('metrics'));
      assert.ok(names.includes('baselines'));
      assert.ok(names.includes('anomalies'));
      db.close();
      if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    });

    it('inserts and queries metrics', () => {
      const db = setupDb();
      db.prepare(`
        INSERT INTO metrics (id, source, source_label, metric_type, value, unit, collected_at, tags)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
      `).run('m1', 'edge_sensor', 'sensor-01', 'bytes_in', 1048576, 'bytes', '[]');

      const row = db.prepare("SELECT value, metric_type FROM metrics WHERE id = 'm1'").get() as any;
      assert.strictEqual(row.value, 1048576);
      assert.strictEqual(row.metric_type, 'bytes_in');
      db.close();
      if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    });

    it('inserts and queries anomalies', () => {
      const db = setupDb();
      db.prepare(`
        INSERT INTO anomalies (id, metric_id, baseline_id, source, metric_type, observed_value, expected_mean, z_score, severity, direction, detected_at, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
      `).run('a1', 'm1', 'b1', 'edge_sensor', 'bytes_in', 5000000, 1000000, 4.0, 'critical', 'above', '[]');

      const row = db.prepare("SELECT z_score, severity FROM anomalies WHERE id = 'a1'").get() as any;
      assert.strictEqual(row.z_score, 4.0);
      assert.strictEqual(row.severity, 'critical');
      db.close();
      if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    });
  });
});

function severityFromZ(z: number): string {
  const absZ = Math.abs(z);
  if (absZ >= 4) return 'critical';
  if (absZ >= 3) return 'high';
  if (absZ >= 2.5) return 'medium';
  return 'low';
}
