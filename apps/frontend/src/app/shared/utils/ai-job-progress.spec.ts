import {
  AI_JOB_DEFAULT_EXPECTED_MS,
  AiJobProgress,
  aiJobPercent,
  expectedAiJobMs,
  recordAiJobDuration,
} from './ai-job-progress';
import { AiScanJobError } from '../../core/utils/ai-job-error';

/**
 * QUI-1020 — barra de progreso de los procesos con IA.
 * Reloj de Jasmine: el arnés de Karma es zoneless (sin `fakeAsync`).
 */
describe('AiJobProgress (QUI-1020)', () => {
  const HISTORY_KEY = 'vendix:ai-job-durations:v1';

  beforeEach(() => {
    localStorage.removeItem(HISTORY_KEY);
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date('2026-11-17T10:00:00Z'));
  });

  afterEach(() => {
    jasmine.clock().uninstall();
    localStorage.removeItem(HISTORY_KEY);
  });

  describe('aiJobPercent', () => {
    it('sin progreso real llega a 90 % en el tiempo esperado (25 s por defecto)', () => {
      expect(aiJobPercent({ elapsedMs: 0, expectedMs: 25_000 })).toBe(0);
      expect(aiJobPercent({ elapsedMs: 12_500, expectedMs: 25_000 })).toBe(45);
      expect(aiJobPercent({ elapsedMs: 25_000, expectedMs: 25_000 })).toBe(90);
    });

    it('pasado el estimado sigue subiendo sin llegar a 100 ni congelarse', () => {
      const a = aiJobPercent({ elapsedMs: 30_000, expectedMs: 25_000 });
      const b = aiJobPercent({ elapsedMs: 60_000, expectedMs: 25_000 });
      const c = aiJobPercent({ elapsedMs: 10 * 60_000, expectedMs: 25_000 });
      expect(a).toBeGreaterThan(90);
      expect(b).toBeGreaterThan(a);
      expect(c).toBeGreaterThan(b);
      expect(c).toBeLessThan(100);
    });

    it('con progreso real lo sigue fielmente y no se adelanta al siguiente paso', () => {
      // 2 de 4 pasos al segundo 1: el reloj iría en 3.6 %, manda el real (50 %).
      expect(
        aiJobPercent({ elapsedMs: 1_000, expectedMs: 25_000, real: { done: 2, total: 4 } }),
      ).toBe(50);
      // 1 de 4 pasos con el reloj muy adelantado: se queda bajo el paso 2 (50 %).
      expect(
        aiJobPercent({ elapsedMs: 24_000, expectedMs: 25_000, real: { done: 1, total: 4 } }),
      ).toBe(49);
    });
  });

  describe('duración esperada por tipo', () => {
    it('sin historial usa 25 s', () => {
      expect(expectedAiJobMs('rut')).toBe(AI_JOB_DEFAULT_EXPECTED_MS);
    });

    it('usa la mediana de las corridas del mismo tipo, escalada por tamaño de entrada', () => {
      recordAiJobDuration('invoice_draft', 10_000, 1);
      recordAiJobDuration('invoice_draft', 40_000, 2); // 20 s por archivo
      recordAiJobDuration('invoice_draft', 90_000, 3); // 30 s por archivo
      expect(expectedAiJobMs('invoice_draft')).toBe(20_000);
      expect(expectedAiJobMs('invoice_draft', 3)).toBe(60_000);
      expect(expectedAiJobMs('rut')).toBe(AI_JOB_DEFAULT_EXPECTED_MS);
    });

    it('un historial corrupto no rompe la barra', () => {
      localStorage.setItem(HISTORY_KEY, '{not json');
      expect(expectedAiJobMs('rut')).toBe(AI_JOB_DEFAULT_EXPECTED_MS);
    });
  });

  describe('tracker', () => {
    let progress: AiJobProgress;

    beforeEach(() => {
      progress = new AiJobProgress({ kind: 'rut' });
    });

    afterEach(() => progress.dispose());

    it('arranca desde el primer segundo y avanza sola con el reloj', () => {
      expect(progress.visible()).toBeFalse();
      progress.onUploadStart();
      expect(progress.visible()).toBeTrue();
      expect(progress.label()).toBe('Subiendo archivo…');
      jasmine.clock().tick(1_000);
      expect(progress.percent()).toBeGreaterThan(0);
      progress.onEnqueued();
      expect(progress.label()).toBe('En cola…');
      progress.onStatus({ status: 'active' });
      expect(progress.label()).toBe('Analizando con IA…');
      expect(progress.elapsedLabel()).toBe('1 s');
    });

    it('pasado el estimado dice «Sigue procesando…» y no llega a 100', () => {
      progress.onUploadStart();
      progress.onStatus({ status: 'active' });
      jasmine.clock().tick(AI_JOB_DEFAULT_EXPECTED_MS + 1_000);
      expect(progress.overtime()).toBeTrue();
      expect(progress.label()).toBe('Sigue procesando…');
      expect(progress.percent()).toBeLessThan(100);
    });

    it('muestra el paso real que reporta el servidor', () => {
      progress.onUploadStart();
      progress.onStatus({
        status: 'active',
        progress: { done: 1, total: 3, stage: 'Leyendo página 2' },
      });
      expect(progress.label()).toBe('Leyendo página 2');
      expect(progress.stepLabel()).toBe('paso 2 de 3');
      expect(progress.percent()).toBeGreaterThanOrEqual(33);
    });

    it('al reengancharse cuenta desde que el usuario lo lanzó (reloj del servidor)', () => {
      progress.onResumed(Date.now() - 40_000);
      expect(progress.elapsedMs()).toBe(40_000);
      progress.onStatus({
        status: 'active',
        queued_at: '2026-11-17T09:59:00.000Z',
        server_time: '2026-11-17T10:00:00.000Z',
      });
      expect(progress.elapsedMs()).toBe(60_000);
    });

    it('marca el trabajo colgado que reporta el servidor', () => {
      progress.onUploadStart();
      progress.onStatus({ status: 'active', stalled: true });
      expect(progress.stalled()).toBeTrue();
    });

    it('al terminar marca 100 % y alimenta el historial del tipo', () => {
      progress.setSize(2);
      progress.onUploadStart();
      jasmine.clock().tick(30_000);
      progress.onCompleted();
      expect(progress.percent()).toBe(100);
      expect(progress.running()).toBeFalse();
      expect(expectedAiJobMs('rut', 2)).toBe(30_000);
    });

    it('un fallo se muestra por categoría y no alimenta el historial', () => {
      progress.onUploadStart();
      progress.onFailed(new AiScanJobError('x', 'ai_unavailable', 'AI_PROVIDER_003', 'credits', true));
      expect(progress.phase()).toBe('failed');
      expect(progress.error()?.category).toBe('ai_unavailable');
      expect(progress.error()?.title).toBe('El servicio de IA no está disponible');
      expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
    });

    it('reset vuelve a cero para un nuevo intento', () => {
      progress.onUploadStart();
      progress.onFailed(new Error('boom'));
      progress.reset();
      expect(progress.visible()).toBeFalse();
      expect(progress.error()).toBeNull();
      progress.onUploadStart();
      expect(progress.phase()).toBe('uploading');
    });
  });
});
