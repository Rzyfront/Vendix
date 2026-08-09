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
 *
 * `attempts: 1` NO ERA SUFICIENTE, y `maxStalledCount: 0` cierra el hueco.
 *
 * En BullMQ la recuperación de un job ESTANCADO es un mecanismo APARTE del contador
 * de intentos. Lo dicen sus propios tipos sobre `WorkerOptions.maxStalledCount`,
 * cuyo default es 1: «Amount of times a job can be recovered from a stalled state
 * to the `wait` state». Un job cuyo lock caduca vuelve a `wait` y se procesa otra
 * vez — sin consultar `attempts`.
 *
 * Y caducar el lock no es hipotético: pasa cuando el contenedor se reinicia a mitad
 * del job, que es exactamente lo que hace un deploy. Con el default, un deploy en
 * medio de un envío habría hecho que `executeTestSet` corriera de nuevo, reservara
 * OTRO bloque de 50 consecutivos y mandara un segundo lote a la DIAN. En silencio.
 *
 * El envío en dos fases agrava la exposición: el job pasó de ~2 minutos a hasta ~12,
 * porque ahora espera a que la DIAN registre las facturas antes de mandar las notas.
 *
 * Con `maxStalledCount: 0` un job estancado va a `failed` y el operador lo ve. Falla
 * ruidosa en vez de duplicar 50 números autorizados irrecuperables — el mismo
 * criterio que el resto de este flujo: preferir fallar antes de gastar.
 */
@Processor('dian-test-set', { maxStalledCount: 0 })
export class DianTestSetProcessor extends WorkerHost {
  private readonly logger = new Logger(DianTestSetProcessor.name);

  constructor(private readonly dianTestService: DianTestService) {
    super();
  }

  async process(job: Job<DianTestSetJob>): Promise<unknown> {
    const {
      config_id,
      resolution_id,
      smoke,
      validate_only,
      numbering_range,
      check_status,
      validate_kind,
      context,
    } = job.data;

    this.logger.log(
      `Procesando set de pruebas DIAN job=${job.id} config=${config_id} ` +
        `resolucion=${resolution_id} store_id=${context?.store_id ?? 'null'}` +
        (validate_only
          ? ` [VALIDACIÓN: SendBillSync, 1 ${validate_kind ?? 'invoice'}, sin testSetId]`
          : smoke
            ? ` [HUMO: 1 ${validate_kind ?? 'invoice'}]`
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
            numbering_range: numbering_range === true,
            check_status: check_status === true,
            // Se pasa tal cual, sin default: `executeTestSet` resuelve el suyo
            // (`invoice`). Poner uno aquí duplicaría la decisión en dos sitios.
            ...(validate_kind ? { validate_kind } : {}),
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
