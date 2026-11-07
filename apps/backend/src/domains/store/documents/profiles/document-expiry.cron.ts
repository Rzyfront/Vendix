import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { storeAllowsFlows } from '../../workflows/engine/workflow-industry';
import { DocumentExpiryService, EXPIRY_ALERT_DAYS } from './document-expiry.service';

/**
 * P4.6: daily expiry alerts. Runs in the worker; for each store with a file
 * profile expiring soon it alerts inside the store context (its own time zone
 * decides "today"). A repeated run is a no-op: the alert is claimed per file
 * and expiry date. One failing store never stops the rest.
 */
@Injectable()
export class DocumentExpiryCron {
  private readonly logger = new Logger(DocumentExpiryCron.name);
  private running = false;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly expiry: DocumentExpiryService,
  ) {}

  /** 06:00 every day. */
  @Cron('0 6 * * *')
  async handle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce(new Date());
    } catch (e) {
      this.logger.error(`Document expiry alerts failed: ${(e as Error)?.message}`);
    } finally {
      this.running = false;
    }
  }

  /** Returns how many files were alerted across stores. */
  async runOnce(now: Date): Promise<number> {
    const db = this.prisma.withoutScope() as any;
    // Wide on purpose (time zones differ by up to a day); each store narrows it.
    const gte = new Date(now.getTime() - 2 * 86_400_000);
    const lte = new Date(now.getTime() + (EXPIRY_ALERT_DAYS + 2) * 86_400_000);
    const rows: Array<{ store_id: number }> = await db.document_file_profiles.findMany({
      where: { valid_until: { gte, lte } },
      select: { store_id: true },
    });
    let alerted = 0;
    for (const storeId of new Set(rows.map((r) => r.store_id))) {
      try {
        if (!(await storeAllowsFlows(db, storeId))) continue;
        const store = await db.stores.findFirst({
          where: { id: storeId },
          select: { organization_id: true },
        });
        if (!store) continue;
        alerted += await RequestContextService.runIsolated(
          {
            store_id: storeId,
            organization_id: store.organization_id,
            is_super_admin: false,
            is_owner: false,
          },
          () => this.expiry.alertDue(now),
        );
      } catch (e) {
        this.logger.warn(`Expiry alerts of store ${storeId} failed: ${(e as Error)?.message}`);
      }
    }
    return alerted;
  }
}
