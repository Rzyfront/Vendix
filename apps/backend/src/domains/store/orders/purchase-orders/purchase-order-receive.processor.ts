import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { randomUUID } from 'crypto';
import { RequestContextService } from '@common/context/request-context.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import {
  PURCHASE_ORDER_RECEIVE_BATCH_SIZE,
  PurchaseOrderReceiveJob,
  PurchaseOrderReceiveJobResult,
} from './purchase-order-receive-queue.service';

/**
 * Processor de la cola `purchase-order-receive`: recibe una OC grande en lotes
 * de 100 líneas. Cada lote es una llamada completa a
 * `PurchaseOrdersService.receive()` (su propia transacción, su
 * `purchase_order_reception` y su asiento prorrateado): una recepción parcial.
 *
 * Si un lote falla, el job queda `failed` y los lotes ya confirmados NO se
 * revierten (la OC queda `partial`). Sin reintento automático (`attempts: 1`):
 * reintentar es volver a llamar `receive/async` con las líneas pendientes; los
 * topes de pendiente de `receive()` evitan la doble recepción.
 */
@Processor('purchase-order-receive', { concurrency: 2 })
export class PurchaseOrderReceiveProcessor extends WorkerHost {
  private readonly logger = new Logger(PurchaseOrderReceiveProcessor.name);

  constructor(private readonly purchaseOrders: PurchaseOrdersService) {
    super();
  }

  async process(
    job: Job<PurchaseOrderReceiveJob>,
  ): Promise<PurchaseOrderReceiveJobResult> {
    const data = job.data;
    const items = data.items;
    const total_lines = items.length;
    const batches_total = Math.ceil(
      total_lines / PURCHASE_ORDER_RECEIVE_BATCH_SIZE,
    );

    return RequestContextService.run(
      {
        is_super_admin: false,
        is_owner: false,
        store_id: data.store_id,
        organization_id: data.organization_id,
        user_id: data.user_id,
        request_id: data.request_id ?? `queue-${randomUUID()}`,
      },
      async () => {
        let processed_lines = 0;
        let status = '';
        for (let b = 0; b < batches_total; b++) {
          const start = b * PURCHASE_ORDER_RECEIVE_BATCH_SIZE;
          const batch = items.slice(
            start,
            start + PURCHASE_ORDER_RECEIVE_BATCH_SIZE,
          );
          try {
            const updated: any = await this.purchaseOrders.receive(
              data.purchase_order_id,
              {
                items: batch,
                notes: data.notes,
                supplier_invoice_number: data.supplier_invoice_number,
                supplier_invoice_date: data.supplier_invoice_date,
              },
            );
            status = String(updated?.status ?? status);
          } catch (error: any) {
            this.logger.error(
              `[POReceive] job=${job.id} PO=${data.purchase_order_id} batch ${b + 1}/${batches_total} failed: ${error?.message ?? error}`,
              error?.stack,
            );
            throw new UnrecoverableError(
              JSON.stringify({
                message: error?.errorCode ?? error?.message ?? 'Error',
                batch_index: b,
                failed_at_line: start,
              }),
            );
          }
          processed_lines += batch.length;
          await job.updateProgress({
            processed_lines,
            total_lines,
            batches_done: b + 1,
            batches_total,
          });
        }
        return { purchase_order_id: data.purchase_order_id, status };
      },
    );
  }
}
