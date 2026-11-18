import { VendixHttpException, ErrorCodes } from '@common/errors';
import { noteProviderOutcome } from '../../ai-engine/provider-failure-recorder';
import {
  AI_JOB_ACTIVE_STALL_MS,
  AI_JOB_WAITING_STALL_MS,
  AiJobMonitorService,
  readProgress,
} from './ai-job-monitor.service';

const SOURCE = { queue: 'ai-scan', kind: 'rut', label: 'escaneo del RUT' };
const OWNER = { store_id: 5, organization_id: 2, user_id: 7, request_id: 'r1' };
const NOW = Date.parse('2026-11-17T12:00:00.000Z');

describe('AiJobMonitorService (QUI-1020)', () => {
  let incidents: { report: jest.Mock };
  let platformOrg: { getPlatformOrganizationId: jest.Mock };
  let monitor: AiJobMonitorService;

  const job = (over: Record<string, unknown> = {}) =>
    ({
      id: '41',
      timestamp: NOW - 10_000,
      processedOn: NOW - 8_000,
      finishedOn: undefined,
      attemptsMade: 0,
      opts: { attempts: 2 },
      progress: 0,
      failedReason: undefined,
      ...over,
    }) as any;

  beforeEach(() => {
    incidents = {
      report: jest
        .fn()
        .mockResolvedValue({ ticketNumber: 'INC-1', created: true, emailed: 1 }),
    };
    platformOrg = { getPlatformOrganizationId: jest.fn().mockResolvedValue(1) };
    monitor = new AiJobMonitorService(incidents as any, platformOrg as any);
  });

  describe('describe', () => {
    it('entrega marcas de tiempo del servidor, intentos y progreso real', () => {
      const meta = monitor.describe(
        job({ progress: { done: 2, total: 5, stage: 'Leyendo páginas' } }),
        'active',
        SOURCE,
        OWNER,
        NOW,
      );
      expect(meta).toEqual({
        progress: { done: 2, total: 5, stage: 'Leyendo páginas' },
        queued_at: new Date(NOW - 10_000).toISOString(),
        started_at: new Date(NOW - 8_000).toISOString(),
        finished_at: null,
        server_time: new Date(NOW).toISOString(),
        attempts_made: 0,
        max_attempts: 2,
        stalled: false,
      });
      expect(incidents.report).not.toHaveBeenCalled();
    });

    it('fallido -> clase del fallo (documento, técnico, IA sin créditos)', () => {
      const failed = (failedReason: string) =>
        monitor.describe(
          job({ failedReason, finishedOn: NOW }),
          'failed',
          SOURCE,
          OWNER,
          NOW,
        );
      expect(failed('RUT_SCAN_PARSE_FAIL')).toMatchObject({
        error_category: 'document',
      });
      expect(failed('RUT_SCAN_AI_FAIL')).toMatchObject({
        error_category: 'technical',
      });
      expect(failed('AI_PROVIDER_003')).toMatchObject({
        error_category: 'ai_unavailable',
        error_reason: 'credits',
      });
    });

    it('en cola sin worker más allá del umbral -> colgado y UN incidente de cola', async () => {
      const stuck = job({
        timestamp: NOW - AI_JOB_WAITING_STALL_MS - 1,
        processedOn: undefined,
      });
      const meta = monitor.describe(stuck, 'waiting', SOURCE, OWNER, NOW);
      expect(meta.stalled).toBe(true);
      await new Promise((r) => setImmediate(r));
      expect(incidents.report).toHaveBeenCalledTimes(1);
      expect(incidents.report.mock.calls[0][0]).toMatchObject({
        dedupeKey: 'ai-job:stalled:waiting:ai-scan',
        source: 'ai_job',
        severity: 'critical',
        organizationId: 1,
        storeId: null,
      });
    });

    it('en cola dentro del umbral no está colgado', () => {
      const meta = monitor.describe(
        job({ timestamp: NOW - AI_JOB_WAITING_STALL_MS + 1_000, processedOn: undefined }),
        'waiting',
        SOURCE,
        OWNER,
        NOW,
      );
      expect(meta.stalled).toBe(false);
      expect(incidents.report).not.toHaveBeenCalled();
    });

    it('activo más allá del umbral -> colgado por tipo de proceso', async () => {
      const meta = monitor.describe(
        job({ processedOn: NOW - AI_JOB_ACTIVE_STALL_MS - 1 }),
        'active',
        SOURCE,
        OWNER,
        NOW,
      );
      expect(meta.stalled).toBe(true);
      await new Promise((r) => setImmediate(r));
      expect(incidents.report.mock.calls[0][0].dedupeKey).toBe(
        'ai-job:stalled:active:ai-scan:rut',
      );
    });

    it('reintento en espera (ya empezó antes) no cuenta como cola sin worker', () => {
      const meta = monitor.describe(
        job({ timestamp: NOW - AI_JOB_WAITING_STALL_MS * 3, processedOn: NOW - 5_000 }),
        'delayed',
        SOURCE,
        OWNER,
        NOW,
      );
      expect(meta.stalled).toBe(false);
    });
  });

  describe('onFailed', () => {
    it('reintento pendiente (sin finishedOn) -> no avisa', async () => {
      await monitor.onFailed(job({ failedReason: 'RUT_SCAN_AI_FAIL' }), SOURCE, OWNER);
      expect(incidents.report).not.toHaveBeenCalled();
    });

    it('documento ilegible -> no avisa', async () => {
      await monitor.onFailed(
        job({ failedReason: 'RUT_SCAN_PARSE_FAIL', finishedOn: NOW }),
        SOURCE,
        OWNER,
      );
      expect(incidents.report).not.toHaveBeenCalled();
    });

    it('cuota del plan de la tienda -> no avisa', async () => {
      await monitor.onFailed(
        job({ failedReason: 'SUBSCRIPTION_006', finishedOn: NOW }),
        SOURCE,
        OWNER,
      );
      expect(incidents.report).not.toHaveBeenCalled();
    });

    it('fallo técnico final -> un ticket por tipo y código, en la organización de plataforma', async () => {
      await monitor.onFailed(
        job({ failedReason: 'RUT_SCAN_AI_FAIL', finishedOn: NOW, attemptsMade: 2 }),
        SOURCE,
        OWNER,
      );
      expect(incidents.report).toHaveBeenCalledTimes(1);
      const input = incidents.report.mock.calls[0][0];
      expect(input).toMatchObject({
        dedupeKey: 'ai-job:technical:ai-scan:rut:RUT_SCAN_AI_FAIL',
        source: 'ai_job',
        organizationId: 1,
        storeId: null,
        userId: null,
        errorCode: 'RUT_SCAN_AI_FAIL',
        correlationId: 'ai-scan:41 / r1',
      });
      expect(input.details).toMatchObject({
        'Tienda afectada (id)': 5,
        'Organización afectada (id)': 2,
        Categoría: 'technical',
      });
      expect(input.tags).toEqual(['ai', 'ai-scan', 'rut', 'technical']);
    });

    it('sin organización de plataforma -> el ticket va a la organización afectada', async () => {
      platformOrg.getPlatformOrganizationId.mockResolvedValue(null);
      await monitor.onFailed(
        job({ failedReason: 'RUT_SCAN_AI_FAIL', finishedOn: NOW }),
        SOURCE,
        OWNER,
      );
      expect(incidents.report.mock.calls[0][0]).toMatchObject({
        organizationId: 2,
        storeId: 5,
      });
    });

    it('IA sin créditos -> clave global (1 ticket + 1 correo para todos los procesos) con la respuesta del proveedor solo en el correo', async () => {
      const failing = job({ id: '77' });
      await expect(
        monitor.runAiWork(failing, SOURCE, async () => {
          noteProviderOutcome(
            { success: false, failure_reason: 'credits', error: '402 Insufficient Balance' },
            'rut_scanner',
          );
          throw new VendixHttpException(ErrorCodes.RUT_SCAN_AI_FAIL);
        }),
      ).rejects.toMatchObject({ errorCode: 'AI_PROVIDER_003' });

      failing.failedReason = 'AI_PROVIDER_003';
      failing.finishedOn = NOW;
      await monitor.onFailed(failing, SOURCE, OWNER);
      const input = incidents.report.mock.calls[0][0];
      expect(input).toMatchObject({
        dedupeKey: 'ai-job:ai-unavailable:credits',
        severity: 'critical',
        title: 'IA sin créditos o cuota agotada',
      });
      expect(input.internalDetails).toMatchObject({
        'App de IA': 'rut_scanner',
        'Respuesta del proveedor': '402 Insufficient Balance',
      });
      expect(JSON.stringify(input.details)).not.toContain('Insufficient');
    });

    it('nunca lanza aunque el servicio de incidentes falle', async () => {
      incidents.report.mockRejectedValue(new Error('redis down'));
      await expect(
        monitor.onFailed(
          job({ failedReason: 'RUT_SCAN_AI_FAIL', finishedOn: NOW }),
          SOURCE,
          OWNER,
        ),
      ).resolves.toBeUndefined();
    });

    it('job indefinido (removido por removeOnFail) -> nada', async () => {
      await expect(monitor.onFailed(undefined, SOURCE)).resolves.toBeUndefined();
    });
  });

  describe('runAiWork', () => {
    it('429 persistente del proveedor -> AI_PROVIDER_004 (reintentable)', async () => {
      await expect(
        monitor.runAiWork(job(), SOURCE, async () => {
          noteProviderOutcome({ success: false, failure_reason: 'rate_limited' });
          throw new VendixHttpException(ErrorCodes.RUT_SCAN_AI_FAIL);
        }),
      ).rejects.toMatchObject({ errorCode: 'AI_PROVIDER_004' });
    });

    it('error de documento tras un rechazo del proveedor se conserva', async () => {
      await expect(
        monitor.runAiWork(job(), SOURCE, async () => {
          noteProviderOutcome({ success: false, failure_reason: 'credits' });
          throw new VendixHttpException(ErrorCodes.RUT_SCAN_PARSE_FAIL);
        }),
      ).rejects.toMatchObject({ errorCode: 'RUT_SCAN_PARSE_FAIL' });
    });

    it('un éxito posterior del proveedor borra el rechazo anterior', async () => {
      await expect(
        monitor.runAiWork(job(), SOURCE, async () => {
          noteProviderOutcome({ success: false, failure_reason: 'rate_limited' });
          noteProviderOutcome({ success: true });
          throw new VendixHttpException(ErrorCodes.RUT_SCAN_AI_FAIL);
        }),
      ).rejects.toMatchObject({ errorCode: 'RUT_SCAN_AI_FAIL' });
    });

    it('sin rechazo del proveedor el error pasa intacto', async () => {
      const boom = new Error('boom');
      await expect(
        monitor.runAiWork(job(), SOURCE, async () => {
          throw boom;
        }),
      ).rejects.toBe(boom);
    });

    it('los trabajos no comparten la anotación (contexto aislado)', async () => {
      await Promise.all([
        monitor
          .runAiWork(job({ id: 'a' }), SOURCE, async () => {
            noteProviderOutcome({ success: false, failure_reason: 'credits' });
            await new Promise((r) => setTimeout(r, 5));
            throw new VendixHttpException(ErrorCodes.RUT_SCAN_AI_FAIL);
          })
          .catch((e) => expect(e.errorCode).toBe('AI_PROVIDER_003')),
        monitor
          .runAiWork(job({ id: 'b' }), SOURCE, async () => {
            await new Promise((r) => setTimeout(r, 1));
            throw new VendixHttpException(ErrorCodes.RUT_SCAN_AI_FAIL);
          })
          .catch((e) => expect(e.errorCode).toBe('RUT_SCAN_AI_FAIL')),
      ]);
    });
  });

  describe('readProgress', () => {
    it('solo {done,total} con total > 0 es progreso real', () => {
      expect(readProgress(3)).toBeNull();
      expect(readProgress({ done: 1, total: 0 })).toBeNull();
      expect(readProgress({ done: 9, total: 4 })).toEqual({ done: 4, total: 4 });
    });
  });
});
