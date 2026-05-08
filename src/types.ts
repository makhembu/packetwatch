export type MetricType = 'bytes_in' | 'bytes_out' | 'packets_in' | 'packets_out' | 'connections' | 'dns_queries' | 'latency_ms' | 'jitter_ms' | 'tls_handshakes' | 'http_requests';

export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical';

export type SourceType = 'edge_sensor' | 'cloudflare_analytics' | 'vpn_gateway' | 'dns_server' | 'load_balancer';

export interface NetworkMetric {
  id: string;
  source: SourceType;
  sourceLabel: string;
  metricType: MetricType;
  value: number;
  unit: string;
  collected_at: string;
  tags: string[];
}

export interface Baseline {
  id: string;
  source: SourceType;
  metricType: MetricType;
  mean: number;
  stddev: number;
  min: number;
  max: number;
  sampleCount: number;
  windowHours: number;
  computed_at: string;
}

export interface Anomaly {
  id: string;
  metricId: string;
  baselineId: string;
  source: SourceType;
  metricType: MetricType;
  observedValue: number;
  expectedMean: number;
  zScore: number;
  severity: AnomalySeverity;
  direction: 'above' | 'below';
  detected_at: string;
  acknowledged: number;
  tags: string[];
}

export interface TimestampedValue {
  value: number;
  collected_at: string;
}
