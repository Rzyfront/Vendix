import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { randomUUID } from 'crypto';

import { RequestContextService } from '@common/context/request-context.service';
import { DianTestService } from './dian-test.service';
import { DianTestSetJob } from './dian-test-set-job.interface';

/**
 * Worker del set de pruebas DIAN (cola `dian-test-set`).
 *
 * Calco de estilo de `ReceiptScanProcessor`: `@Processor` + `WorkerHost.process`,
 * restaurando el `RequestContext` desde el payload para que el cliente Prisma
 * scopeado resuelva la misma entidad fiscal que el llamador original.
 *
 * DIFERENCIA CRÍTICA con los demás workers del repo: `attempts: 1`, sin reintento.
 * Un reintento aquí no es gratis — cada intento reserva un bloque NUEVO de
 * consecutivos autorizados y envía un lote nuevo a la DIAN. Consecutivos quemados
 * no se recuperan, y la DIAN rechazaría el segundo lote como duplicado. La
 * política de reintentos vive en la persona que mira el resultado, no en BullMQ.
 * El productor (`DianTestService.enqueueTestSet`) fija esa política; este
 * comentario existe para que nadie la "mejore" a 3 intentos por costumbre.
 */
@Processor('dian-test-set')
export class DianTestSetProcessor extends WorkerHost {
  private readonly logger = new Logger(DianTestSetProcessor.name);

  constructor(private readonly dianTestService: DianTestService) {
    super();
  }

  async process(job: Job<DianTestSetJob>): Promise<unknown> {
    const { config_id, resolution_id, smoke, validate_only, context } = job.data;

    this.logger.log(
      `Procesando set de pruebas DIAN job=${job.id} config=${config_id} ` +
        `resolucion=${resolution_id} store_id=${context?.store_id ?? 'null'}` +
        (validate_only
          ? ' [VALIDACIÓN: SendBillSync, 1 documento, sin testSetId]'
          : smoke
            ? ' [HUMO: 1 documento]'
            : ''),
    );

    const requestId =
      context?.request_id && context.request_id.trim().length > 0
        ? context.request_id
        : `queue-${randomUUID()}`;

    try {
      return await RequestContextService.runIsolated(
        {
          // Se arrastran tal cual: la plataforma corre con `store_id: undefined`
          // y `is_super_admin: true`, y aplanar eso a `false` haría que el
          // cliente scopeado resolviera otra entidad fiscal (o ninguna).
          is_super_admin: context?.is_super_admin ?? false,
          is_owner: context?.is_owner ?? false,
          store_id: context?.store_id,
          organization_id: context?.organization_id,
          user_id: context?.user_id,
          request_id: requestId,
        },
        () =>
          this.dianTestService.executeTestSet(config_id, resolution_id, {
            smoke: smoke === true,
            validate_only: validate_only === true,
          }),
      );
    } catch (error: any) {
      this.logger.error(
        `Set de pruebas DIAN job=${job.id} falló: ${error?.message}`,
      );
      // Se relanza para que BullMQ marque el job como failed y `failedReason`
      // llegue al cliente que sondea. Con `attempts: 1` no hay reintento.
      throw error;
    }
  }
}
