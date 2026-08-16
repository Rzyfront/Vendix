import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InvoiceRetryQueueService } from '../domains/store/invoicing/services/invoice-retry-queue.service';

@Injectable()
export class InvoiceRetryJob {
  private readonly logger = new Logger(InvoiceRetryJob.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly event_emitter: EventEmitter2,
    private readonly retry_queue: InvoiceRetryQueueService,
  ) {}

  /**
   * Runs every 5 minutes to process the invoice retry queue.
   * Picks pending items whose next_retry_at has passed and emits retry events.
   */
  @Cron('*/5 * * * *')
  async handleRetryQueue() {
    this.logger.log('Processing invoice retry queue...');

    try {
      const now = new Date();

      // PRIMERO recuperar los huérfanos, y sólo después seleccionar.
      //
      // Este ciclo marca la fila `processing` y emite un evento que no espera.
      // Si el proceso muere entre las dos cosas, la fila se queda en
      // `processing` para siempre: la selección de abajo sólo mira `pending`, y
      // `enqueue()` se niega a crear otra mientras vea una viva. El documento
      // deja de reintentarse sin que nada lo delate — la venta figura como «en
      // cola» indefinidamente. Ir primero hace que lo recuperado entre en ESTE
      // ciclo y no espere cinco minutos más.
      await this.retry_queue
        .reclaimStaleProcessing()
        .catch((error) =>
          this.logger.error(
            `Failed to reclaim stale 'processing' retry items: ${error.message}`,
          ),
        );

      const pending_items = await this.prisma.invoice_retry_queue.findMany({
        where: {
          status: 'pending',
          next_retry_at: { lte: now },
        },
        include: {
          invoice: {
            select: {
              id: true,
              invoice_number: true,
              store_id: true,
              organization_id: true,
              status: true,
            },
          },
        },
        take: 20, // Process in batches
        orderBy: { next_retry_at: 'asc' },
      });

      if (pending_items.length === 0) {
        this.logger.debug('No pending retry items');
        return;
      }

      this.logger.log(`Found ${pending_items.length} invoice(s) to retry`);

      for (const item of pending_items) {
        try {
          // Mark as processing
          await this.prisma.invoice_retry_queue.update({
            where: { id: item.id },
            data: { status: 'processing', updated_at: now },
          });

          // Emit retry event — the invoice flow will handle the actual retry
          this.event_emitter.emit('invoice.retry', {
            retry_queue_id: item.id,
            invoice_id: item.invoice_id,
            invoice_number: item.invoice.invoice_number,
            store_id: item.invoice.store_id,
            organization_id: item.invoice.organization_id,
            attempt: item.attempts + 1,
            max_attempts: item.max_attempts,
          });

          this.logger.log(
            `Emitted retry event for invoice ${item.invoice.invoice_number} (attempt ${item.attempts + 1}/${item.max_attempts})`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to process retry item ${item.id}: ${error.message}`,
          );

          // Mark back as pending so it can be retried
          await this.prisma.invoice_retry_queue.update({
            where: { id: item.id },
            data: { status: 'pending', updated_at: now },
          });
        }
      }
    } catch (error) {
      this.logger.error(
        `Invoice retry queue processing failed: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Cada 30 min: devuelve a la cola los documentos expedidos bajo contingencia
   * que siguen dentro de sus 48 h.
   *
   * ## Por qué hace falta un segundo cron y no basta el de arriba
   *
   * Porque cuando la cadencia reglamentada (5 intentos × 2 min, Anexo §12.4) se
   * agota sobre una indisponibilidad de la DIAN, `markFailed` deja la fila en
   * `contingency` — TERMINAL para la cola. El cron de arriba sólo recoge
   * `pending`, así que a partir de ese momento nadie volvía a intentarlo: el
   * documento se quedaba con su `contingency_deadline` corriendo y vencía en
   * silencio. La obligación de 48 h estaba anotada en la fila, pero el sistema
   * dejaba de perseguirla a los diez minutos.
   *
   * ## Por qué 30 min
   *
   * Un ciclo completo de reintentos dura ~10 min, y `enqueue()` no duplica
   * mientras haya una fila viva. Con 30 min cada barrido encuentra la anterior
   * ya terminada y abre una nueva: ~96 ciclos repartidos en las 48 h, sin
   * amontonar intentos contra un servicio que ya se sabe caído.
   */
  @Cron('*/30 * * * *')
  async handleContingencySweep() {
    try {
      const { requeued, expired } = await this.retry_queue.resweepContingency();
      if (requeued > 0 || expired > 0) {
        this.logger.log(
          `Contingency sweep finished: ${requeued} re-queued, ${expired} past their 48 h deadline`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Contingency sweep failed: ${error.message}`,
        error.stack,
      );
    }
  }
}
