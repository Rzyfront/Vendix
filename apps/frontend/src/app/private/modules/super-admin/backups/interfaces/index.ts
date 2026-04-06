export interface BackupStatus {
  last_backup: {
    id: string;
    created_at: string | null;
    type: 'automated' | 'manual';
  } | null;
  pitr: {
    earliest: string | null;
    latest: string | null;
  };
  retention_days: number;
  instance: {
    id: string;
    class: string;
    engine: string;
    storage_gb: number;
    status: string;
  };
}

export interface SnapshotInfo {
  id: string;
  type: 'automated' | 'manual';
  status: string;
  created_at: string | null;
  size_gb: number;
  engine: string;
  engine_version: string;
}
