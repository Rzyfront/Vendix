import {
  Injectable,
  Logger,
  Inject,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import {
  RDSClient,
  DescribeDBSnapshotsCommand,
  CreateDBSnapshotCommand,
  DeleteDBSnapshotCommand,
  DescribeDBInstancesCommand,
} from '@aws-sdk/client-rds';
import {
  RDS_DB_IDENTIFIER,
  AWS_REGION_DEFAULT,
} from '../../monitoring/constants/cloudwatch.constants';

interface SnapshotInfo {
  id: string;
  type: 'automated' | 'manual';
  status: string;
  created_at: string | null;
  size_gb: number;
  engine: string;
  engine_version: string;
}

interface BackupStatus {
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

@Injectable()
export class RdsBackupService {
  private readonly logger = new Logger(RdsBackupService.name);
  private readonly rdsClient: RDSClient;

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {
    this.rdsClient = new RDSClient({
      region: process.env.AWS_REGION || AWS_REGION_DEFAULT,
    });
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    const cacheKey = 'backups:snapshots:list';
    const cached = await this.cache.get<SnapshotInfo[]>(cacheKey);
    if (cached) return cached;

    try {
      const [automated, manual] = await Promise.all([
        this.rdsClient.send(
          new DescribeDBSnapshotsCommand({
            DBInstanceIdentifier: RDS_DB_IDENTIFIER,
            SnapshotType: 'automated',
          }),
        ),
        this.rdsClient.send(
          new DescribeDBSnapshotsCommand({
            DBInstanceIdentifier: RDS_DB_IDENTIFIER,
            SnapshotType: 'manual',
          }),
        ),
      ]);

      const mapSnapshots = (
        snapshots: any[],
        type: 'automated' | 'manual',
      ): SnapshotInfo[] =>
        (snapshots || []).map((s) => ({
          id: s.DBSnapshotIdentifier || '',
          type,
          status: s.Status || 'unknown',
          created_at: s.SnapshotCreateTime
            ? s.SnapshotCreateTime.toISOString()
            : null,
          size_gb: s.AllocatedStorage || 0,
          engine: s.Engine || '',
          engine_version: s.EngineVersion || '',
        }));

      const result = [
        ...mapSnapshots(automated.DBSnapshots || [], 'automated'),
        ...mapSnapshots(manual.DBSnapshots || [], 'manual'),
      ].sort((a, b) => {
        if (!a.created_at || !b.created_at) return 0;
        return b.created_at.localeCompare(a.created_at);
      });

      await this.cache.set(cacheKey, result, 60000);

      return result;
    } catch (error) {
      this.logger.error('Failed to list RDS snapshots', error);
      throw error;
    }
  }

  async getStatus(): Promise<BackupStatus> {
    const cacheKey = 'backups:status';
    const cached = await this.cache.get<BackupStatus>(cacheKey);
    if (cached) return cached;

    try {
      const [instanceResult, snapshots] = await Promise.all([
        this.rdsClient.send(
          new DescribeDBInstancesCommand({
            DBInstanceIdentifier: RDS_DB_IDENTIFIER,
          }),
        ),
        this.listSnapshots(),
      ]);

      const instance = instanceResult.DBInstances?.[0];
      if (!instance) {
        throw new NotFoundException('RDS instance not found');
      }

      const lastBackup = snapshots.length > 0 ? snapshots[0] : null;

      const result: BackupStatus = {
        last_backup: lastBackup
          ? {
              id: lastBackup.id,
              created_at: lastBackup.created_at,
              type: lastBackup.type,
            }
          : null,
        pitr: {
          earliest: instance.LatestRestorableTime
            ? new Date(
                instance.LatestRestorableTime.getTime() -
                  (instance.BackupRetentionPeriod || 7) * 24 * 60 * 60 * 1000,
              ).toISOString()
            : null,
          latest: instance.LatestRestorableTime
            ? instance.LatestRestorableTime.toISOString()
            : null,
        },
        retention_days: instance.BackupRetentionPeriod || 0,
        instance: {
          id: instance.DBInstanceIdentifier || RDS_DB_IDENTIFIER,
          class: instance.DBInstanceClass || '',
          engine: `${instance.Engine || ''} ${instance.EngineVersion || ''}`.trim(),
          storage_gb: instance.AllocatedStorage || 0,
          status: instance.DBInstanceStatus || 'unknown',
        },
      };

      await this.cache.set(cacheKey, result, 60000);

      return result;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to get backup status', error);
      throw error;
    }
  }

  async createSnapshot(name: string): Promise<SnapshotInfo> {
    const snapshotId = `vendix-manual-${name}-${Date.now()}`;

    try {
      const result = await this.rdsClient.send(
        new CreateDBSnapshotCommand({
          DBInstanceIdentifier: RDS_DB_IDENTIFIER,
          DBSnapshotIdentifier: snapshotId,
        }),
      );

      const snapshot = result.DBSnapshot;
      if (!snapshot) {
        throw new BadRequestException('Failed to create snapshot');
      }

      // Invalidate cache
      await this.cache.del('backups:snapshots:list');
      await this.cache.del('backups:status');

      return {
        id: snapshot.DBSnapshotIdentifier || snapshotId,
        type: 'manual',
        status: snapshot.Status || 'creating',
        created_at: snapshot.SnapshotCreateTime
          ? snapshot.SnapshotCreateTime.toISOString()
          : new Date().toISOString(),
        size_gb: snapshot.AllocatedStorage || 0,
        engine: snapshot.Engine || '',
        engine_version: snapshot.EngineVersion || '',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`Failed to create snapshot: ${snapshotId}`, error);
      throw error;
    }
  }

  async deleteSnapshot(snapshotId: string): Promise<void> {
    // First verify the snapshot exists and is manual
    try {
      const result = await this.rdsClient.send(
        new DescribeDBSnapshotsCommand({
          DBSnapshotIdentifier: snapshotId,
        }),
      );

      const snapshot = result.DBSnapshots?.[0];
      if (!snapshot) {
        throw new NotFoundException(`Snapshot '${snapshotId}' not found`);
      }

      if (snapshot.SnapshotType === 'automated') {
        throw new ForbiddenException(
          'Cannot delete automated snapshots. Only manual snapshots can be deleted.',
        );
      }

      await this.rdsClient.send(
        new DeleteDBSnapshotCommand({
          DBSnapshotIdentifier: snapshotId,
        }),
      );

      // Invalidate cache
      await this.cache.del('backups:snapshots:list');
      await this.cache.del('backups:status');
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      this.logger.error(`Failed to delete snapshot: ${snapshotId}`, error);
      throw error;
    }
  }
}
