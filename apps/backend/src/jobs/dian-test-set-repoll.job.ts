import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { RequestContextService } from '../common/context/request-context.service';
import { DianTestService } from '../domains/store/invoicing/dian-config/dian-test.service';
import { analyzeTestSetWait } from '../domains/store/invoicing/dian-config/test-set-wait.util';

/** Minimum gap between two automatic GetStatusZip calls for the same batch. */
const POLL_INTERVAL_FRESH_MS = 10 * 60 * 1000;
const POLL_INTERVAL_AGED_MS = 30 * 60 * 1000;
/** Batches younger than this are re-polled on the short interval. */
const FRESH_BATCH_MS = 60 * 60 * 1000;

/**
 * Re-polls DIAN for habilitación batches that are still waiting on a verdict.
 *
 * `SendTestSetAsync` is asynchronous, so `run-test-set` returns with the batch
 * queued and the verdict pending. Before this job existed, the only way to learn
 * the verdict was for a human to open the DIAN tab and press "consultar" — which
 * is exactly how a tenant ends up believing the habilitación hangs forever, when
 * in fact nobody was asking.
 *
 * It deliberately stops polling once the wait is `stalled`: past that point DIAN
 * has demonstrated it will not answer for this ZipKey, and continuing would be
 * an unbounded background loop against an external service. Resolving a stalled
 * batch requires a decision (diagnose per document, or discard and re-send),
 * which is a human's call, surfaced in the UI.
 */
@Injectable()
export class DianTestSetRepollJob {
  private readonly logger = new Logger(DianTestSetRepollJob.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly dianTestService: DianTestService,
  ) {}

  @Cron('*/10 * * * *')
  async handleRepoll() {
    try {
      // Unscoped on purpose: a cron has no tenant. The per-config context is
      // synthesized below before touching any scoped service.
      const configs = await this.prisma
        .withoutScope()
        .dian_configurations.findMany({
          where: { enablement_status: 'testing' },
          select: {
            id: true,
            organization_id: true,
            store_id: true,
            name: true,
            last_test_result: true,
          },
        });

      const now = Date.now();
      const due = configs.filter((config) =>
        this.isDueForRepoll(config.last_test_result, now),
      );

      if (due.length === 0) {
        this.logger.debug('No DIAN test-set batches due for re-poll');
        return;
      }

      this.logger.log(
        `Re-polling ${due.length} DIAN test-set batch(es) awaiting verdict`,
      );

      for (const config of due) {
        try {
          const result = await RequestContextService.run(
            {
              organization_id: config.organization_id,
              store_id: config.store_id ?? undefined,
              is_super_admin: true,
              is_owner: false,
              roles: ['super_admin'],
              permissions: [],
              app_type: 'VENDIX_ADMIN',
            },
            () => this.dianTestService.checkTestSetStatus(config.id),
          );

          this.logger.log(
            `[DIAN test-set] config=${config.id} (${config.name}) ` +
              `state=${result.wait?.state ?? 'unknown'} success=${result.success}`,
          );
        } catch (error) {
          // One tenant's expired certificate or revoked credentials must not
          // stop the sweep for everyone else.
          this.logger.error(
            `Re-poll failed for DIAN config ${config.id}: ${error.message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `DIAN test-set re-poll sweep failed: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * A batch is due when it is genuinely still processing AND enough time passed
   * since the last poll. Backing off with age keeps a long-queued batch from
   * generating a SOAP call every ten minutes for hours.
   */
  private isDueForRepoll(lastTestResult: unknown, now: number): boolean {
    const wait = analyzeTestSetWait(lastTestResult, now);
    if (wait.state !== 'processing') return false;

    const result = (lastTestResult ?? {}) as Record<string, any>;
    const lastPollAt = result.rechecked_at ?? result.executed_at ?? null;
    if (!lastPollAt) return true;

    const since = now - new Date(lastPollAt).getTime();
    if (!Number.isFinite(since)) return true;

    const interval =
      (wait.waiting_ms ?? 0) < FRESH_BATCH_MS
        ? POLL_INTERVAL_FRESH_MS
        : POLL_INTERVAL_AGED_MS;

    return since >= interval;
  }
}
