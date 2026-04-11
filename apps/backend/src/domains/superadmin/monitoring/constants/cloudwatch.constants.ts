export const EC2_INSTANCE_ID_DEFAULT = 'i-097972b9868de9cd8';
export const RDS_DB_IDENTIFIER_DEFAULT = 'vendix-db';
export const AWS_REGION_DEFAULT = 'us-east-1';

export type Granularity = '1m' | '5m' | '15m' | '1h';
export type Period = '1h' | '6h' | '24h' | '7d';

export function periodToSeconds(granularity: Granularity): number {
  const map: Record<Granularity, number> = {
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '1h': 3600,
  };
  return map[granularity];
}

export function periodToStartTime(period: Period): Date {
  const now = new Date();
  const map: Record<Period, number> = {
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  };
  return new Date(now.getTime() - map[period]);
}

export function autoGranularity(period: Period): Granularity {
  const map: Record<Period, Granularity> = {
    '1h': '1m',
    '6h': '5m',
    '24h': '15m',
    '7d': '1h',
  };
  return map[period];
}

export const EC2_METRICS = [
  { name: 'CPUUtilization', unit: 'Percent' },
  { name: 'CPUCreditBalance', unit: 'Count' },
  { name: 'CPUCreditUsage', unit: 'Count' },
  { name: 'NetworkIn', unit: 'Bytes' },
  { name: 'NetworkOut', unit: 'Bytes' },
  { name: 'EBSReadOps', unit: 'Count' },
  { name: 'EBSWriteOps', unit: 'Count' },
  { name: 'EBSReadBytes', unit: 'Bytes' },
  { name: 'EBSWriteBytes', unit: 'Bytes' },
  { name: 'StatusCheckFailed', unit: 'Count' },
] as const;

export const RDS_METRICS = [
  { name: 'CPUUtilization', unit: 'Percent' },
  { name: 'DatabaseConnections', unit: 'Count' },
  { name: 'FreeStorageSpace', unit: 'Bytes' },
  { name: 'FreeableMemory', unit: 'Bytes' },
  { name: 'ReadIOPS', unit: 'Count/Second' },
  { name: 'WriteIOPS', unit: 'Count/Second' },
  { name: 'ReadLatency', unit: 'Seconds' },
  { name: 'WriteLatency', unit: 'Seconds' },
] as const;

/** Cache TTLs for monitoring endpoints (milliseconds) */
export const CACHE_TTL_OVERVIEW = 120_000;        // 2 min — CloudWatch data doesn't change fast
export const CACHE_TTL_INFRASTRUCTURE = 120_000;   // 2 min — EC2/RDS detailed metrics
export const CACHE_TTL_APP = 15_000;               // 15s — app metrics are more volatile
export const CACHE_TTL_PERFORMANCE = 10_000;       // 10s — near real-time performance data
export const CACHE_TTL_SERVER = 300_000;            // 5 min — server info is nearly static

/** @deprecated Use specific TTL constants instead */
export const MONITORING_CACHE_TTL = 60 * 1000;
