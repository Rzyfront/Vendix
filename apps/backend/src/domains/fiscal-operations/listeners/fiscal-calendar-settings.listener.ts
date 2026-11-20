import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  FISCAL_DATA_UPDATED_EVENT,
  FiscalCalendarSummary,
  FiscalDataUpdatedEvent,
} from '@common/constants/fiscal-data-events';
import { FiscalContextResolverService } from '../services/fiscal-context-resolver.service';
import { FiscalCalendarRemindersService } from '../services/fiscal-calendar-reminders.service';

/**
 * Calendario tributario (F1/F3): al guardar los datos fiscales genera las
 * obligaciones de la ventana y sus recordatorios en la bitácora. Nunca rompe
 * el guardado: cualquier fallo se registra y vuelve como `status: 'error'`.
 */
@Injectable()
export class FiscalCalendarSettingsListener {
  private readonly logger = new Logger(FiscalCalendarSettingsListener.name);

  constructor(
    private readonly contextResolver: FiscalContextResolverService,
    private readonly calendar: FiscalCalendarRemindersService,
  ) {}

  @OnEvent(FISCAL_DATA_UPDATED_EVENT)
  async handle(event: FiscalDataUpdatedEvent): Promise<FiscalCalendarSummary> {
    try {
      const context = await this.contextResolver.resolveForTenant({
        organization_id: event.organization_id,
        store_id: event.store_id,
      });
      return await this.calendar.onFiscalDataSaved(context, {
        previous_periodicity: event.previous_fiscal_data?.vat_periodicity,
        saver_user_id: event.user_id,
        decision: event.vat_calendar_change ?? null,
      });
    } catch (error) {
      this.logger.error(
        `Fiscal calendar after fiscal_data save failed (org ${event.organization_id}, store ${event.store_id ?? '-'}): ${(error as Error).message}`,
        (error as Error).stack,
      );
      return {
        status: 'error',
        periodicity: null,
        obligations: 0,
        reminders_created: 0,
        reminders_scheduled: 0,
        pending_confirmation: 0,
        replaced: null,
        message:
          'Los datos se guardaron, pero no pudimos crear los recordatorios del calendario tributario. Lo intentaremos de nuevo automáticamente.',
      };
    }
  }
}
