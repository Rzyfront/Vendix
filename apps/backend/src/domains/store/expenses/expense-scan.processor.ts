import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { RequestContextService } from '../../../common/context/request-context.service';
import { ExpenseScannerService } from './expense-scanner.service';
import { ExpenseScanResponse } from './dto/scan-expense.dto';
import { ExpenseScanJob } from './expense-scan-job.interface';

/**
 * Worker de la cola `expense-scan`. Ejecuta la parte pesada del escaneo de
 * factura de gasto (OCR + parse + matching) fuera del ciclo request/response.
 *
 * El `AsyncLocalStorage` del request HTTP NO llega al worker, por lo que hay que
 * restaurar el contexto multi-tenant con `RequestContextService.run(...)` a
 * partir de `job.data.context`. Sin esto, `matchCategory` no vería
 * `organization_id` y el matching de categorías quedaría sin scope.
 *
 * El valor retornado es `ExpenseScanResponse` sin cambios de forma y queda en
 * `job.returnvalue` para que el polling (`GET store/expenses/scan/:jobId`) lo
 * devuelva. Los fallos se propagan (throw) para que BullMQ aplique su política
 * de reintentos.
 */
@Processor('expense-scan')
export class ExpenseScanProcessor extends WorkerHost {
  private readonly logger = new Logger(ExpenseScanProcessor.name);

  constructor(private readonly scannerService: ExpenseScannerService) {
    super();
  }

  async process(job: Job<ExpenseScanJob>): Promise<ExpenseScanResponse> {
    const { dataUri, mimeType, context } = job.data;

    this.logger.log(
      `Processing expense-scan job ${job.id} (store_id=${context.store_id ?? '-'}, organization_id=${context.organization_id ?? '-'})`,
    );

    try {
      return await RequestContextService.run(
        {
          is_super_admin: false,
          is_owner: false,
          store_id: context.store_id,
          organization_id: context.organization_id,
          user_id: context.user_id,
          request_id: context.request_id,
        },
        () => this.scannerService.scanFromImage(dataUri, mimeType),
      );
    } catch (error: any) {
      this.logger.error(
        `Expense-scan job ${job.id} failed: ${error?.message}`,
      );
      // Re-lanzar para que BullMQ registre failedReason y aplique reintentos.
      throw error;
    }
  }
}
