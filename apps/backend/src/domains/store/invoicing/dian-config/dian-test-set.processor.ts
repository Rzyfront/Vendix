import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
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
 *
 * ## `lockDuration: 120_000` — por qué se sube el default (QUI-674)
 *
 * BullMQ renueva el lock con un temporizador que dispara a la MITAD de
 * `lockDuration` (15 s con el default de 30 s). Ese temporizador vive en el event
 * loop de ESTE proceso, así que si el job lo bloquea, la renovación no corre y el
 * lock caduca — con `maxStalledCount: 0` eso es un `failed` en medio de un envío
 * a la DIAN. Es exactamente lo que pasaba: `could not renew lock for job 27`,
 * `Missing lock for job 28. moveToFinished`.
 *
 * La causa se ataca en origen (caché del PKCS#12 en `DianXmlSignerService` +
 * cesión del event loop por documento en `DianTestService.yieldEventLoop`), y con
 * eso el macrotask más largo del job pasa a ser UN documento: sub-segundo.
 *
 * `lockDuration` se dimensiona sobre esa cota nueva, no sobre la vieja: 120 s son
 * dos órdenes de magnitud de margen sobre un documento, y cubren de sobra un
 * primer parseo en frío, una pausa de GC o un pico del host. El coste de pasarse
 * es acotado y benigno: un proceso que MUERA a mitad de job deja el lock retenido
 * hasta 120 s antes de que se detecte el estancamiento, y como `maxStalledCount`
 * es 0 el desenlace es el mismo `failed` — solo que 90 s más tarde. Errar por
 * generoso es el lado seguro: lo que no se puede permitir es lo contrario, un
 * lock que caduca con el worker vivo y sano.
 */
@Processor('dian-test-set', { maxStalledCount: 0, lockDuration: 120_000 })
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

  /**
   * PR 4 — cleanup cuando el job falla por OOM, exit 137 o error del servicio.
   *
   * Sin esto, `last_test_result.pending` queda colgado en `true` cuando el
   * worker muere a mitad del envío y el tenant queda encerrado: la guarda
   * de `enqueueTestSet` lo rechaza con `DIAN_TEST_SET_002` para siempre.
   *
   * Se ejecuta DESPUÉS de que BullMQ ya movió el job a `failed`. La
   * limpieza solo escribe si el job NO llegó a la terminación natural
   * (que ya escribe `pending: false`).
   *
   * Usa `@OnWorkerEvent('failed')` y NO `@OnQueueEvent('failed')`:
   * la primera entrega el `Job` completo (con `data` y `context`) y
   * corre dentro del ciclo de vida del `WorkerHost` — no exige una
   * clase aparte con `@QueueEventsListener`. La firma real de
   * `WorkerListener['failed']` es `(job, error, prev)` con `job`
   * posiblemente `undefined` cuando un stalled job llega al límite
   * `maxStalledCount` y `removeOnFail` lo borra.
   */
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<DianTestSetJob> | undefined,
    err: Error,
    _prev: string,
  ): Promise<void> {
    if (!job) {
      this.logger.warn(
        'onFailed invoked with undefined job (stalled job removed by removeOnFail); nothing to clean',
      );
      return;
    }
    const { config_id } = job.data;
    this.logger.warn(
      `Job ${job.id} (config=${config_id}) failed: ${err?.message ?? 'unknown'}. Limpiando last_test_result.pending.`,
    );
    try {
      await RequestContextService.runIsolated(
        {
          is_super_admin: job.data.context?.is_super_admin ?? false,
          is_owner: job.data.context?.is_owner ?? false,
          store_id: job.data.context?.store_id,
          organization_id: job.data.context?.organization_id,
          user_id: job.data.context?.user_id,
          request_id: `failed-${job.id}`,
        },
        async () => {
          const config = await this.dianTestService.getConfigById(config_id);
          const previous = (config.last_test_result ?? {}) as Record<string, any>;
          if (previous.pending === true && previous.abandoned !== true) {
            await this.dianTestService.persistTestSetAbandonment(
              config_id,
              'worker failure: ' + (err?.message ?? 'unknown').slice(0, 200),
            );
          }
        },
      );
    } catch (cleanupErr: any) {
      this.logger.error(
        `Cleanup failed for job=${job.id} config=${config_id}: ${cleanupErr?.message}`,
      );
    }
  }
}
