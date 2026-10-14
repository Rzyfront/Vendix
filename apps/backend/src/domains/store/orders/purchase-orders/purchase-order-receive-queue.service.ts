import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { ReceiveItemDto } from './dto/receive-purchase-order.dto';

/** Tamaño del lote de recepción (cada lote = una `purchase_order_reception`). */
export const PURCHASE_ORDER_RECEIVE_BATCH_SIZE = 100;

/**
 * Job de la cola `purchase-order-receive`. MODULE-LOCAL (skill `vendix-ai-queue`).
 * `store_id` alimenta el control IDOR del poll.
 */
export interface PurchaseOrderReceiveJob {
  store_id: number;
  organization_id?: number;
  user_id?: number;
  request_id?: string;
  purchase_order_id: number;
  items: ReceiveItemDto[];
  notes?: string;
  supplier_invoice_number?: string;
  supplier_invoice_date?: string;
  total_lines: number;
  batches_total: number;
}

export interface PurchaseOrderReceiveJobResult {
  purchase_order_id: number;
  status: string;
}

export interface PurchaseOrderReceiveJobProgress {
  processed_lines: number;
  total_lines: number;
  batches_done: number;
  batches_total: number;
}

export interface PurchaseOrderReceiveJobError {
  message: string;
  batch_index: number;
  failed_at_line: number;
}

export interface PurchaseOrderReceiveJobStatus {
  job_id: string;
  state: 'waiting' | 'active' | 'completed' | 'failed';
  progress: PurchaseOrderReceiveJobProgress;
  result?: PurchaseOrderReceiveJobResult;
  error?: PurchaseOrderReceiveJobError;
}

export interface EnqueueReceiveInput {
  items: ReceiveItemDto[];
  notes?: string;
  supplier_invoice_number?: string;
  supplier_invoice_date?: string;
}

/**
 * Encola y consulta los jobs de recepción por lotes de una OC. Vive aparte de
 * `PurchaseOrdersService` (gigante) y lo comparten el controller
 * (`PATCH :id/receive/async`) y el listener de remisiones (> 100 líneas).
 */
@Injectable()
export class PurchaseOrderReceiveQueueService {
  constructor(
    @InjectQueue('purchase-order-receive')
    private readonly queue: Queue<PurchaseOrderReceiveJob>,
  ) {}

  async enqueueReceive(
    purchaseOrderId: number,
    input: EnqueueReceiveInput,
  ): Promise<{ job_id: string; total_lines: number; batches_total: number }> {
    const ctx = RequestContextService.getContext() as any;
    const store_id = ctx?.store_id ?? undefined;
    if (store_id == null) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const total_lines = input.items.length;
    const batches_total = Math.ceil(
      total_lines / PURCHASE_ORDER_RECEIVE_BATCH_SIZE,
    );

    try {
      const job = await this.queue.add(
        'receive',
        {
          store_id,
          organization_id: ctx?.organization_id ?? undefined,
          user_id: ctx?.user_id ?? undefined,
          request_id: ctx?.request_id ?? `po-receive-${randomUUID()}`,
          purchase_order_id: purchaseOrderId,
          items: input.items,
          notes: input.notes,
          supplier_invoice_number: input.supplier_invoice_number,
          supplier_invoice_date: input.supplier_invoice_date,
          total_lines,
          batches_total,
        },
        {
          // Sin reintento automático: un reintento re-recibiría lotes ya
          // confirmados. Reintentar = volver a llamar con las líneas pendientes.
          attempts: 1,
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        },
      );
      return { job_id: String(job.id), total_lines, batches_total };
    } catch {
      throw new VendixHttpException(ErrorCodes.AI_QUEUE_001);
    }
  }

  async getReceiveJob(jobId: string): Promise<PurchaseOrderReceiveJobStatus> {
    const job = await this.queue.getJob(jobId);

    // 🔒 IDOR: `job.returnvalue` viene de Redis (no scoped-prisma). Mismo 404
    // que un job inexistente para no filtrar existencia cross-tenant.
    const callerStoreId = RequestContextService.getContext()?.store_id as
      | number
      | undefined;
    if (!job || callerStoreId == null || job.data?.store_id !== callerStoreId) {
      throw new VendixHttpException(ErrorCodes.AI_QUEUE_002);
    }

    const rawState = await job.getState();
    const state: PurchaseOrderReceiveJobStatus['state'] =
      rawState === 'completed' ||
      rawState === 'failed' ||
      rawState === 'active'
        ? rawState
        : 'waiting';

    const p =
      job.progress && typeof job.progress === 'object'
        ? (job.progress as Partial<PurchaseOrderReceiveJobProgress>)
        : {};
    const progress: PurchaseOrderReceiveJobProgress = {
      processed_lines: p.processed_lines ?? 0,
      total_lines: p.total_lines ?? job.data.total_lines,
      batches_done: p.batches_done ?? 0,
      batches_total: p.batches_total ?? job.data.batches_total,
    };

    const status: PurchaseOrderReceiveJobStatus = {
      job_id: String(job.id),
      state,
      progress,
    };
    if (state === 'completed' && job.returnvalue) {
      status.result = job.returnvalue as PurchaseOrderReceiveJobResult;
    }
    if (state === 'failed') {
      status.error = parseFailedReason(job.failedReason, progress);
    }
    return status;
  }
}

function parseFailedReason(
  failedReason: string | undefined,
  progress: PurchaseOrderReceiveJobProgress,
): PurchaseOrderReceiveJobError {
  try {
    const parsed = JSON.parse(failedReason ?? '');
    if (parsed && typeof parsed.message === 'string') {
      return {
        message: parsed.message,
        batch_index: Number(parsed.batch_index ?? 0),
        failed_at_line: Number(parsed.failed_at_line ?? 0),
      };
    }
  } catch {
    // failedReason no estructurado (p. ej. job stalled): se degrada abajo.
  }
  return {
    message: failedReason ?? 'La recepción falló',
    batch_index: progress.batches_done,
    failed_at_line: progress.processed_lines,
  };
}
