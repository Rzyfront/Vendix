import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { RequestContextService } from '../../../../../common/context/request-context.service';
import { AutoEntryService, AutoEntryEventData } from '../auto-entry.service';
import {
  ACCOUNTING_ENTRY_RETRY_QUEUE,
  AccountingEntryRetryJob,
  AccountingEntryFailureService,
} from '../accounting-entry-failure.service';

/**
 * Reintenta asientos automáticos fallidos. Reejecuta `postAutoEntry` con el
 * payload crudo guardado. El re-post es idempotente (createAutoEntry salta si
 * ya existe un asiento para el mismo `source_type/source_id/entity`), así que
 * un reintento nunca duplica. El re-throw en el catch deja que BullMQ aplique
 * el backoff exponencial hasta agotar `attempts`.
 */
@Processor(ACCOUNTING_ENTRY_RETRY_QUEUE)
export class AccountingEntryRetryProcessor extends WorkerHost {
  private readonly logger = new Logger(AccountingEntryRetryProcessor.name);

  constructor(
    private readonly auto_entry_service: AutoEntryService,
    private readonly failure_service: AccountingEntryFailureService,
  ) {
    super();
  }

  async process(job: Job<AccountingEntryRetryJob>): Promise<void> {
    const { failure_id } = job.data;
    const failure = await this.failure_service.findOne(failure_id);
    if (!failure) {
      this.logger.warn(`Retry job for missing failure #${failure_id}; skipping`);
      return;
    }
    if (failure.resolved_at) {
      // Ya se resolvió (p.ej. por un reintento manual o el evento original).
      return;
    }

    const payload = this.revive(
      failure.event_payload as unknown as AutoEntryEventData,
    );

    try {
      await RequestContextService.run(
        {
          is_super_admin: false,
          is_owner: false,
          store_id: payload.store_id,
          organization_id: payload.organization_id,
          user_id: payload.user_id,
          request_id: `accounting-retry-${failure_id}`,
        },
        () => this.auto_entry_service.postAutoEntry(payload),
      );
      await this.failure_service.markResolved(failure_id);
      this.logger.log(
        `Auto-entry failure #${failure_id} resolved on retry ` +
          `(${payload.source_type}#${payload.source_id ?? '?'})`,
      );
    } catch (error: any) {
      await this.failure_service.recordAttempt(failure_id, error as Error);
      this.logger.error(
        `Retry of auto-entry failure #${failure_id} failed: ${error.message}`,
      );
      throw error; // BullMQ aplica backoff / agota attempts
    }
  }

  /**
   * El payload viaja por JSON en la cola/BD, así que `entry_date` llega como
   * string ISO. Se rehidrata a `Date` para que la búsqueda del período fiscal
   * (`start_date lte / end_date gte`) opere con un valor temporal real.
   */
  private revive(payload: AutoEntryEventData): AutoEntryEventData {
    const raw = payload as unknown as { entry_date?: unknown };
    if (typeof raw.entry_date === 'string') {
      return { ...payload, entry_date: new Date(raw.entry_date) };
    }
    return payload;
  }
}
