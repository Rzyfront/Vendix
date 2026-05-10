import { Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { SettingsMigratorService } from '../../store/settings/migrations/settings-migrator.service';

export interface SettingsSyncError {
  storeId: number;
  message: string;
}

export interface SettingsSyncResult {
  totalScanned: number;
  totalMigrated: number;
  errors: SettingsSyncError[];
}

const BATCH_SIZE = 50;

/**
 * Super-admin batch synchronization for store_settings rows.
 *
 * Iterates all `store_settings` in cursor-paginated batches, runs the
 * `SettingsMigratorService` against each row, and persists the migrated
 * value when the migrator reports `changed=true`. Errors are accumulated
 * per-row and reported back rather than failing the whole job.
 */
@Injectable()
export class SettingsSyncService {
  private readonly logger = new Logger(SettingsSyncService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly migrator: SettingsMigratorService,
  ) {}

  async syncAllStores(): Promise<SettingsSyncResult> {
    const errors: SettingsSyncError[] = [];
    let totalScanned = 0;
    let totalMigrated = 0;
    let cursorStoreId: number | null = null;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batch = await this.prisma.store_settings.findMany({
        take: BATCH_SIZE,
        ...(cursorStoreId !== null
          ? { skip: 1, cursor: { store_id: cursorStoreId } }
          : {}),
        orderBy: { store_id: 'asc' },
        select: { store_id: true, settings: true },
      });

      if (batch.length === 0) break;

      for (const row of batch) {
        totalScanned += 1;
        try {
          const result = this.migrator.migrate(row.settings ?? {});
          if (result.changed) {
            await this.prisma.store_settings.update({
              where: { store_id: row.store_id },
              data: {
                settings: result.migrated,
                updated_at: new Date(),
              },
            });
            totalMigrated += 1;
            this.logger.log(
              `[SettingsSync] migrated store ${row.store_id}: v${result.fromVersion}->v${result.toVersion}`,
            );
          }
        } catch (err: any) {
          const message = err?.message ?? String(err);
          this.logger.error(
            `[SettingsSync] failed store ${row.store_id}: ${message}`,
          );
          errors.push({ storeId: row.store_id, message });
        }
      }

      cursorStoreId = batch[batch.length - 1].store_id;

      if (batch.length < BATCH_SIZE) break;
    }

    return { totalScanned, totalMigrated, errors };
  }
}
