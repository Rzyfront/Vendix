import { Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';

/**
 * Retry cadence for a DIAN "demora" (Anexo Técnico 1.9 §12.4): retransmit at
 * 2 min, then 4 more attempts every 2 min. Five attempts total, ~10 min.
 *
 * The previous `[5, 30, 120]` (5 min / 30 min / 2 h) was an invented exponential
 * curve: it stretched a reglamented 10-minute window into two and a half hours,
 * so a document sat "retrying" long past the point where the Anexo says
 * contingency should have been declared.
 */
const TIMEOUT_BACKOFF_MINUTES = [2, 2, 2, 2, 2];

/**
 * Attempts for the timeout cadence. Matches TIMEOUT_BACKOFF_MINUTES.length so
 * the two cannot drift.
 */
const TIMEOUT_MAX_ATTEMPTS = TIMEOUT_BACKOFF_MINUTES.length;

/**
 * Anexo §12.2: once the reglamented retries are exhausted the document may be
 * expedited under contingency, and the DIAN must receive it within 48 h.
 */
export const CONTINGENCY_DEADLINE_HOURS = 48;

/**
 * Cuánto puede llevar una fila en `processing` antes de considerarla huérfana.
 *
 * `InvoiceRetryJob` marca la fila `processing` y emite un evento que NO espera.
 * Si el proceso se cae entre esas dos cosas —un deploy, un OOM, un reinicio del
 * contenedor— la fila queda en `processing` para siempre: el cron sólo busca
 * `pending`, y `enqueue()` se niega a crear una nueva porque ya ve una viva. El
 * documento queda ni reintentado ni reencolable, y nadie se entera.
 *
 * 15 min es holgado contra el ciclo real: el cron corre cada 5 min y un intento
 * completo (leer, firmar, SOAP a la DIAN, persistir) se mide en segundos. Una
 * fila que lleva 15 min en `processing` no está trabajando, está huérfana.
 */
export const STALE_PROCESSING_MINUTES = 15;

/** Queue statuses. `contingency` is terminal for the queue but not for the doc. */
export const RETRY_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  /** Retries exhausted on an availability failure → expedited under Type 04. */
  CONTINGENCY: 'contingency',
} as const;

export interface InvoiceRetryStatus {
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  next_retry_at: Date;
}

@Injectable()
export class InvoiceRetryQueueService {
  private readonly logger = new Logger(InvoiceRetryQueueService.name);

  constructor(private readonly prisma: GlobalPrismaService) {}

  /**
   * Enqueue a failed invoice for retry with exponential backoff.
   *
   * @returns `true` si creó una fila nueva; `false` si ya había un reintento
   * vivo o si la escritura falló. Lo devuelve —antes no devolvía nada— para
   * que `resweepContingency` pueda contar reencolados de verdad en vez de
   * intentos de reencolar. Ningún llamador previo lee el resultado.
   */
  async enqueue(
    invoice_id: number,
    org_id: number,
    store_id: number,
    error: string,
  ): Promise<boolean> {
    try {
      // Check if already in queue and pending
      const existing = await this.prisma.invoice_retry_queue.findFirst({
        where: {
          invoice_id,
          status: { in: [RETRY_STATUS.PENDING, RETRY_STATUS.PROCESSING] },
        },
      });

      if (existing) {
        this.logger.debug(
          `Invoice ${invoice_id} already in retry queue (status: ${existing.status})`,
        );
        return false;
      }

      const next_retry_at = new Date();
      next_retry_at.setMinutes(
        next_retry_at.getMinutes() + TIMEOUT_BACKOFF_MINUTES[0],
      );

      await this.prisma.invoice_retry_queue.create({
        data: {
          org_id,
          store_id,
          invoice_id,
          attempts: 0,
          max_attempts: TIMEOUT_MAX_ATTEMPTS,
          last_error: error,
          next_retry_at,
          status: RETRY_STATUS.PENDING,
        },
      });

      this.logger.log(
        `Invoice ${invoice_id} enqueued for retry. Next attempt at ${next_retry_at.toISOString()}`,
      );
      return true;
    } catch (err) {
      this.logger.error(
        `Failed to enqueue invoice ${invoice_id}: ${err.message}`,
      );
      return false;
    }
  }

  /**
   * Deja constancia de un documento que NO se pudo emitir y que ningún
   * reintento automático va a arreglar.
   *
   * ## Por qué `failed` y no `pending`
   *
   * El caso que trae acá es la prevalidación: al documento le falta un dato
   * —identificación del adquiriente, resolución vencida, una línea sin
   * impuesto— y eso no lo cura el tiempo. Encolarlo como `pending` gastaría
   * cinco intentos contra la DIAN sabiendo que van a fallar, y peor: el
   * indicador del POS los leería como «se reintentará solo» y le diría al
   * cajero que espere algo que no va a pasar.
   *
   * Lo que sí hace falta es que el fallo EXISTA en algún sitio consultable. Sin
   * esta fila, una venta cuya factura se quedó en `draft` sobrevive únicamente
   * como una línea de log: no aparece en `getQueueStats()`, ni en el
   * `retry_status` del listado de facturas, ni en el estado que devuelve el
   * POS. La reemisión —desde el botón del POS o desde la superficie fiscal—
   * sigue disponible; lo que se registra es que hace falta.
   *
   * Idempotente por documento: si ya hay una fila viva (`pending`/`processing`)
   * no la pisa —esa describe un reintento en curso, que es información más
   * fresca—, y si ya hay una `failed` la actualiza en vez de acumular filas.
   */
  async recordBlocked(
    invoice_id: number,
    org_id: number,
    store_id: number,
    reason: string,
  ): Promise<void> {
    try {
      const existing = await this.prisma.invoice_retry_queue.findFirst({
        where: { invoice_id },
        orderBy: { updated_at: 'desc' },
      });

      // Un reintento vivo describe mejor la situación que un bloqueo: se deja
      // correr y su propio desenlace escribirá el estado final.
      if (
        existing &&
        [RETRY_STATUS.PENDING, RETRY_STATUS.PROCESSING].includes(
          existing.status as 'pending' | 'processing',
        )
      ) {
        return;
      }

      const last_error = reason.slice(0, 2000);

      if (existing && existing.status === RETRY_STATUS.FAILED) {
        await this.prisma.invoice_retry_queue.update({
          where: { id: existing.id },
          data: { last_error, updated_at: new Date() },
        });
        return;
      }

      await this.prisma.invoice_retry_queue.create({
        data: {
          org_id,
          store_id,
          invoice_id,
          attempts: 0,
          max_attempts: TIMEOUT_MAX_ATTEMPTS,
          last_error,
          // La columna es NOT NULL y no hay reintento programado. `now()` la
          // satisface sin mentir: el selector del cron filtra por
          // `status: 'pending'`, así que una fila `failed` nunca se recoge por
          // muy vencida que esté esta fecha.
          next_retry_at: new Date(),
          status: RETRY_STATUS.FAILED,
        },
      });

      this.logger.warn(
        `Invoice ${invoice_id} recorded as blocked (no automatic retry): ${last_error}`,
      );
    } catch (err) {
      // Registrar el fallo no puede ser a su vez un fallo que se propague: el
      // llamador es el carril del POS sobre una venta YA cobrada.
      this.logger.error(
        `Failed to record blocked invoice ${invoice_id}: ${err.message}`,
      );
    }
  }

  /**
   * Devuelve a `pending` las filas que quedaron colgadas en `processing`.
   *
   * Cierra el agujero descrito en `STALE_PROCESSING_MINUTES`: sin esto, un
   * reinicio a mitad de un intento deja el documento fuera del alcance del cron
   * (que sólo lee `pending`) Y fuera del alcance de `enqueue()` (que se niega a
   * duplicar mientras vea una fila viva). El documento no se reintenta nunca
   * más y ninguna pantalla lo delata: sigue figurando como «en cola».
   *
   * No consume un intento: el intento anterior no llegó a juzgarse, así que
   * contarlo acortaría la ventana reglamentada de reintentos por un problema
   * de infraestructura nuestro, no de la DIAN.
   *
   * @returns cuántas filas se recuperaron.
   */
  async reclaimStaleProcessing(
    older_than_minutes = STALE_PROCESSING_MINUTES,
  ): Promise<number> {
    const cutoff = new Date(Date.now() - older_than_minutes * 60 * 1000);

    const { count } = await this.prisma.invoice_retry_queue.updateMany({
      where: {
        status: RETRY_STATUS.PROCESSING,
        updated_at: { lt: cutoff },
      },
      data: {
        status: RETRY_STATUS.PENDING,
        // Reintentable ya: el reloj de espera lo cumplió la fila mientras
        // estaba colgada.
        next_retry_at: new Date(),
        updated_at: new Date(),
      },
    });

    if (count > 0) {
      this.logger.warn(
        `Reclaimed ${count} invoice retry item(s) stuck in 'processing' for more than ${older_than_minutes} min`,
      );
    }

    return count;
  }

  /**
   * Mark a retry as successful and remove from queue.
   */
  async markSuccess(retry_queue_id: number): Promise<void> {
    await this.prisma.invoice_retry_queue.update({
      where: { id: retry_queue_id },
      data: { status: 'completed', updated_at: new Date() },
    });
  }

  /**
   * Mark a retry as failed. If max attempts reached, mark as failed permanently.
   * Otherwise, schedule next retry with exponential backoff.
   */
  async markFailed(
    retry_queue_id: number,
    error: string,
    /**
     * True when the failure is a DIAN availability problem (`contingency_eligible`
     * from the SOAP client). Only then may exhausting the retries lead to
     * contingency; a rejected or malformed document must terminate as `failed`,
     * because contingency is not an escape hatch for an invalid document.
     */
    contingency_eligible = false,
  ): Promise<void> {
    const item = await this.prisma.invoice_retry_queue.findUnique({
      where: { id: retry_queue_id },
    });

    if (!item) return;

    const new_attempts = item.attempts + 1;

    if (new_attempts >= item.max_attempts) {
      const terminal_status = contingency_eligible
        ? RETRY_STATUS.CONTINGENCY
        : RETRY_STATUS.FAILED;

      await this.prisma.invoice_retry_queue.update({
        where: { id: retry_queue_id },
        data: {
          status: terminal_status,
          attempts: new_attempts,
          last_error: error,
          updated_at: new Date(),
        },
      });

      if (contingency_eligible) {
        await this.declareContingency(item.invoice_id, error);
      }

      this.logger.warn(
        `Invoice ${item.invoice_id} exhausted all ${item.max_attempts} retry attempts → ${terminal_status}`,
      );
      return;
    }

    // Fixed 2-minute cadence (Anexo §12.4), not an exponential curve.
    const backoff_index = Math.min(
      new_attempts,
      TIMEOUT_BACKOFF_MINUTES.length - 1,
    );
    const next_retry_at = new Date();
    next_retry_at.setMinutes(
      next_retry_at.getMinutes() + TIMEOUT_BACKOFF_MINUTES[backoff_index],
    );

    await this.prisma.invoice_retry_queue.update({
      where: { id: retry_queue_id },
      data: {
        status: RETRY_STATUS.PENDING,
        attempts: new_attempts,
        last_error: error,
        next_retry_at,
        updated_at: new Date(),
      },
    });

    this.logger.log(
      `Invoice ${item.invoice_id} retry ${new_attempts}/${item.max_attempts} failed. Next attempt at ${next_retry_at.toISOString()}`,
    );
  }

  /**
   * Marks a document as expedited under DIAN contingency (Anexo §12.2, Type 04).
   *
   * What this means fiscally: the invoice was legitimately delivered to the
   * acquirer WITHOUT prior DIAN validation, keeping its original prefix and
   * number, and the issuer now owes the DIAN a transmission within 48 h. That is
   * why the transmission status becomes `contingency` and not `error`: the
   * document is valid and deliverable, it simply has an outstanding obligation.
   *
   * Idempotent: a document already under contingency keeps its original deadline,
   * because the 48 h run from the FIRST declaration, not from the latest retry.
   */
  async declareContingency(invoice_id: number, reason: string): Promise<void> {
    const invoice = await this.prisma.invoices.findUnique({
      where: { id: invoice_id },
      select: { id: true, contingency_type: true },
    });
    if (!invoice) return;
    if (invoice.contingency_type) {
      this.logger.debug(
        `Invoice ${invoice_id} already under contingency ${invoice.contingency_type}; deadline preserved`,
      );
      return;
    }

    const declared_at = new Date();
    const deadline = new Date(
      declared_at.getTime() + CONTINGENCY_DEADLINE_HOURS * 60 * 60 * 1000,
    );

    await this.prisma.invoices.update({
      where: { id: invoice_id },
      data: {
        contingency_type: '04',
        contingency_declared_at: declared_at,
        contingency_deadline: deadline,
        contingency_reason: reason.slice(0, 2000),
        transmission_status: 'contingency',
      },
    });

    this.logger.warn(
      `Invoice ${invoice_id} expedited under DIAN contingency (Type 04). ` +
        `Must be transmitted before ${deadline.toISOString()}.`,
    );
  }

  /**
   * Documents expedited under contingency whose 48 h window has not closed yet.
   * Feeds the sweeper that retransmits them once the DIAN is reachable again.
   */
  async findPendingContingency(limit = 50) {
    return this.prisma.invoices.findMany({
      where: {
        contingency_type: { not: null },
        transmission_status: 'contingency',
      },
      orderBy: { contingency_deadline: 'asc' },
      take: limit,
      select: {
        id: true,
        organization_id: true,
        store_id: true,
        invoice_number: true,
        contingency_type: true,
        contingency_declared_at: true,
        contingency_deadline: true,
      },
    });
  }

  /**
   * Vuelve a poner en cola los documentos expedidos bajo contingencia que
   * siguen dentro de sus 48 h.
   *
   * ## El agujero que cierra
   *
   * `markFailed(..., contingency_eligible = true)` deja la fila de la cola en
   * `contingency`, que es TERMINAL para la cola. El cron de reintentos sólo
   * recoge `pending`. Resultado hasta ahora: un documento expedido bajo Anexo
   * §12.2 se intentaba transmitir durante los ~10 min de la cadencia
   * reglamentada y, si la DIAN seguía caída, no se volvía a intentar NUNCA —
   * mientras su `contingency_deadline` corría en silencio y vencía. La
   * obligación estaba registrada pero no cumplida.
   *
   * ## Por qué reencolar y no llamar a `send()` desde acá
   *
   * Porque `enqueue()` desemboca en el MISMO camino que cualquier otro
   * reintento (cron → `invoice.retry` → `InvoiceRetryListener` → contexto de
   * tienda → `InvoiceFlowService.send`), con su idempotencia y su re-chequeo
   * del gate fiscal. Un segundo camino de transmisión sería una segunda forma
   * de emitir el mismo documento, y de ahí a dos criterios distintos hay un
   * paso.
   *
   * `enqueue()` ya se niega a duplicar mientras exista una fila viva, así que
   * llamar a esto más seguido que la duración de un ciclo (~10 min) es inocuo.
   *
   * ## El vencimiento no se reintenta, se grita
   *
   * Pasadas las 48 h la transmisión ya no sana la obligación: toca una
   * actuación distinta (nota de ajuste, corrección ante la DIAN) que ningún
   * cron puede decidir. Seguir reintentando disfrazaría de «en curso» un
   * incumplimiento consumado, así que se registra en ERROR y se deja quieto,
   * visible en la superficie fiscal por su `transmission_status`.
   *
   * @returns cuántos se reencolaron y cuántos ya vencieron.
   */
  async resweepContingency(
    limit = 100,
  ): Promise<{ requeued: number; expired: number }> {
    const now = new Date();

    const pending = await this.prisma.invoices.findMany({
      where: {
        transmission_status: 'contingency',
        contingency_type: { not: null },
      },
      orderBy: { contingency_deadline: 'asc' },
      take: limit,
      select: {
        id: true,
        organization_id: true,
        store_id: true,
        invoice_number: true,
        contingency_deadline: true,
      },
    });

    let requeued = 0;
    let expired = 0;

    for (const invoice of pending) {
      const deadline = invoice.contingency_deadline;

      if (deadline && deadline.getTime() <= now.getTime()) {
        expired += 1;
        this.logger.error(
          `CONTINGENCY DEADLINE MISSED: invoice #${invoice.id} (${invoice.invoice_number}) ` +
            `was expedited under contingency and its 48 h window closed at ${deadline.toISOString()} ` +
            `without being accepted by the DIAN. It needs manual fiscal action; no further retries will be scheduled.`,
        );
        continue;
      }

      const created = await this.enqueue(
        invoice.id,
        invoice.organization_id,
        invoice.store_id,
        `Retransmisión de documento en contingencia${
          deadline ? ` (vence ${deadline.toISOString()})` : ''
        }`,
      );
      if (created) requeued += 1;
    }

    if (requeued > 0 || expired > 0) {
      this.logger.log(
        `Contingency sweep: ${requeued} re-queued, ${expired} past deadline`,
      );
    }

    return { requeued, expired };
  }

  /**
   * Batch-resolve the latest retry-queue state for a page of invoices.
   * Single query for all IDs (no N+1); the caller passes IDs that already
   * went through the tenant-scoped invoice listing, so the result set is
   * tenant-safe by construction. Invoices without a queue row are simply
   * absent from the map (the caller maps them to retry_status = null).
   */
  async getRetryStatusByInvoiceIds(
    invoice_ids: number[],
  ): Promise<Map<number, InvoiceRetryStatus>> {
    const result = new Map<number, InvoiceRetryStatus>();
    if (!invoice_ids.length) return result;

    const rows = await this.prisma.invoice_retry_queue.findMany({
      where: { invoice_id: { in: invoice_ids } },
      orderBy: { updated_at: 'desc' },
      select: {
        invoice_id: true,
        status: true,
        attempts: true,
        max_attempts: true,
        last_error: true,
        next_retry_at: true,
      },
    });

    for (const row of rows) {
      // Rows are sorted newest-first; keep only the most recent per invoice.
      if (result.has(row.invoice_id)) continue;
      result.set(row.invoice_id, {
        status: row.status,
        attempts: row.attempts,
        max_attempts: row.max_attempts,
        last_error: row.last_error,
        next_retry_at: row.next_retry_at,
      });
    }

    return result;
  }

  /**
   * Get queue statistics for monitoring.
   */
  async getQueueStats(): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    contingency: number;
    total: number;
  }> {
    const [pending, processing, completed, failed, contingency] =
      await Promise.all([
        this.prisma.invoice_retry_queue.count({
          where: { status: RETRY_STATUS.PENDING },
        }),
        this.prisma.invoice_retry_queue.count({
          where: { status: RETRY_STATUS.PROCESSING },
        }),
        this.prisma.invoice_retry_queue.count({
          where: { status: RETRY_STATUS.COMPLETED },
        }),
        this.prisma.invoice_retry_queue.count({
          where: { status: RETRY_STATUS.FAILED },
        }),
        this.prisma.invoice_retry_queue.count({
          where: { status: RETRY_STATUS.CONTINGENCY },
        }),
      ]);

    return {
      pending,
      processing,
      completed,
      failed,
      contingency,
      total: pending + processing + completed + failed + contingency,
    };
  }
}
