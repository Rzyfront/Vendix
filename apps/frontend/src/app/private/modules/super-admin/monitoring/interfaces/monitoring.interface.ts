export type TimeRange = '1h' | '6h' | '24h' | '7d';
export type MetricStatus = 'healthy' | 'warning' | 'critical';

export interface TimeSeriesPoint {
  timestamp: string;
  value: number;
}

export interface MetricGroup {
  datapoints: TimeSeriesPoint[];
  latest: number;
  unit: string;
}

export interface MonitoringOverview {
  ec2: { cpuUtilization: number; status: MetricStatus };
  rds: {
    cpuUtilization: number;
    connections: number;
    freeStorageGB: number;
    freeMemoryMB: number;
  };
  server: {
    uptime: number;
    memoryUsedPercent: number;
    loadAverage: number[];
    disk: {
      size: string;
      used: string;
      available: string;
      usePercent: string;
    } | null;
  };
  timestamp: string;
}

export interface Ec2MetricsResponse {
  cpu: {
    utilization: MetricGroup;
    creditBalance: MetricGroup;
    creditUsage: MetricGroup;
  };
  network: { bytesIn: MetricGroup; bytesOut: MetricGroup };
  disk: {
    readOps: MetricGroup;
    writeOps: MetricGroup;
    readBytes: MetricGroup;
    writeBytes: MetricGroup;
  };
  status: { checkFailed: MetricGroup };
}

export interface RdsMetricsResponse {
  cpu: { utilization: MetricGroup };
  connections: { active: MetricGroup };
  storage: { freeSpace: MetricGroup; freeMemory: MetricGroup };
  iops: { read: MetricGroup; write: MetricGroup };
  latency: { read: MetricGroup; write: MetricGroup };
}

export interface ProcessInfo {
  pid: number;
  uptime: number;
  cpuUser: number;
  cpuSystem: number;
  memoryRss: number;
  memoryHeapTotal: number;
  memoryHeapUsed: number;
  memoryExternal: number;
  memoryArrayBuffers: number;
  nodeVersion: string;
  platform: string;
  arch: string;
}

export interface RedisInfo {
  usedMemory: string;
  usedMemoryBytes: number;
  connectedClients: number;
  opsPerSec: number;
  totalSystemMemory: string;
  maxMemory: string;
  evictionPolicy: string;
  keyspaceHits: number;
  keyspaceMisses: number;
  uptimeInSeconds: number;
  redisVersion: string;
}

export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export interface AppMetrics {
  heap: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
    arrayBuffers: number;
  };
  queues: QueueStats[];
  process: ProcessInfo;
  redis: RedisInfo | null;
}

export interface ServerInfo {
  hostname: string;
  platform: string;
  arch: string;
  uptime: number;
  processUptime: number;
  loadAverage: number[];
  totalMemory: number;
  freeMemory: number;
  cpuCount: number;
  cpuModel: string;
  nodeVersion: string;
  pid: number;
  disk: { filesystem: string; size: string; used: string; available: string; usePercent: string; mountedOn: string } | null;
  memory: { total: number; free: number; used: number; usedPercent: number };
}
