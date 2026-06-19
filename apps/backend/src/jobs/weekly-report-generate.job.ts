import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WeeklyReportService } from '../domains/store/weekly-report/weekly-report.service';

@Injectable()
export class WeeklyReportGenerateJob {
  private readonly logger = new Logger(WeeklyReportGenerateJob.name);

  constructor(private readonly service: WeeklyReportService) {}

  /**
   * Genera el reporte semanal "Tu Semana en Vendix" para todas las tiendas
   * activas cada domingo a las 07:00 hora Colombia (UTC-05:00) → 12:00 UTC.
   *
   * El servicio calcula por tienda la ventana de la semana cerrada
   * (la que terminó justo antes de este domingo 07:00) y persiste el
   * snapshot en `store_weekly_reports`. Luego emite una notificación
   * `weekly_report` por tienda (SSE + push).
   */
  @Cron('0 12 * * 0')
  async handleWeeklyReportGeneration() {
    this.logger.log('Starting weekly report generation (Sun 12:00 UTC = 07:00 CO)');
    const startedAt = Date.now();
    try {
      const result = await this.service.generateForAllActiveStores();
      this.logger.log(
        `Weekly report generation finished in ${Date.now() - startedAt}ms: ${result.generated} generated, ${result.skipped} skipped`,
      );
    } catch (err) {
      this.logger.error(
        `Weekly report generation failed: ${err?.message}`,
        err?.stack,
      );
    }
  }
}
