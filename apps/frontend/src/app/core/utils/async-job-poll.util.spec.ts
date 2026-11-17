import { HttpErrorResponse } from '@angular/common/http';
import { Observable, defer, of, throwError } from 'rxjs';

import {
  AsyncJobPollLimitError,
  AsyncJobStatus,
  BackoffRetryInfo,
  DEFAULT_BACKOFF_STEPS_MS,
  backoffDelayMs,
  isTransientHttpError,
  pollAsyncJob,
  retryTransientWithBackoff,
} from './async-job-poll.util';

/**
 * QUI-1009 — backoff 1→2→4→10 s con tope y límite de intentos.
 *
 * El arnés de Karma es zoneless (`test-init.ts`, `polyfills: []`): `fakeAsync`
 * necesita Zone.js, así que el tiempo se controla con el reloj de Jasmine, que
 * reemplaza el `setInterval` global que usa el `asyncScheduler` de RxJS.
 */
describe('async-job-poll.util — backoff (QUI-1009)', () => {
  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date('2026-11-17T10:00:00Z'));
  });
  afterEach(() => jasmine.clock().uninstall());

  const http = (status: number) =>
    new HttpErrorResponse({ status, url: '/api/x' });

  /** Fuente fría que falla con `errors[i]` en la suscripción i y luego emite 'ok'. */
  function flaky(errors: unknown[]): { source: Observable<string>; calls: () => number } {
    let calls = 0;
    return {
      source: defer(() => {
        const error = errors[calls];
        calls++;
        return error === undefined ? of('ok') : throwError(() => error);
      }),
      calls: () => calls,
    };
  }

  describe('backoffDelayMs', () => {
    it('sigue la escalera 1→2→4→10 s y se queda en el tope de 10 s', () => {
      expect([1, 2, 3, 4, 5, 6, 20].map((a) => backoffDelayMs(a))).toEqual([
        1_000, 2_000, 4_000, 10_000, 10_000, 10_000, 10_000,
      ]);
      expect(DEFAULT_BACKOFF_STEPS_MS).toEqual([1_000, 2_000, 4_000, 10_000]);
    });

    it('trata un intento < 1 como el primero', () => {
      expect(backoffDelayMs(0)).toBe(1_000);
    });
  });

  describe('isTransientHttpError', () => {
    it('solo red (status 0) y 5xx son transitorios', () => {
      expect(isTransientHttpError(http(0))).toBeTrue();
      expect(isTransientHttpError(http(500))).toBeTrue();
      expect(isTransientHttpError(http(502))).toBeTrue();
      expect(isTransientHttpError(http(504))).toBeTrue();
      expect(isTransientHttpError(http(400))).toBeFalse();
      expect(isTransientHttpError(http(409))).toBeFalse();
      expect(isTransientHttpError('Error del servidor')).toBeFalse();
      expect(isTransientHttpError(new Error('boom'))).toBeFalse();
    });
  });

  describe('retryTransientWithBackoff', () => {
    it('reintenta un 5xx a 1 s, 2 s y 4 s y termina bien', () => {
      const { source, calls } = flaky([http(502), http(503), http(0)]);
      const retries: BackoffRetryInfo[] = [];
      let value: string | undefined;

      source
        .pipe(retryTransientWithBackoff({ onRetry: (info) => retries.push(info) }))
        .subscribe((v) => (value = v));

      expect(calls()).toBe(1);
      jasmine.clock().tick(999);
      expect(calls()).toBe(1);
      jasmine.clock().tick(1);
      expect(calls()).toBe(2);
      jasmine.clock().tick(2_000);
      expect(calls()).toBe(3);
      jasmine.clock().tick(3_999);
      expect(calls()).toBe(3);
      jasmine.clock().tick(1);
      expect(calls()).toBe(4);
      expect(value).toBe('ok');
      expect(retries.map((r) => [r.attempt, r.maxRetries, r.delayMs])).toEqual([
        [1, 3, 1_000],
        [2, 3, 2_000],
        [3, 3, 4_000],
      ]);
    });

    it('se rinde al agotar el límite y entrega el error original', () => {
      const lastError = http(503);
      const { source, calls } = flaky([http(500), http(500), http(500), lastError]);
      let error: unknown;

      source.pipe(retryTransientWithBackoff()).subscribe({ error: (e) => (error = e) });
      jasmine.clock().tick(1_000 + 2_000 + 4_000);

      expect(calls()).toBe(4);
      expect(error).toBe(lastError);
      jasmine.clock().tick(60_000);
      expect(calls()).toBe(4);
    });

    it('no reintenta un error de datos (4xx)', () => {
      const dataError = http(400);
      const { source, calls } = flaky([dataError]);
      const onRetry = jasmine.createSpy('onRetry');
      let error: unknown;

      source
        .pipe(retryTransientWithBackoff({ onRetry }))
        .subscribe({ error: (e) => (error = e) });
      jasmine.clock().tick(30_000);

      expect(calls()).toBe(1);
      expect(error).toBe(dataError);
      expect(onRetry).not.toHaveBeenCalled();
    });

    it('respeta un maxRetries distinto', () => {
      const { source, calls } = flaky([http(502), http(502)]);
      let error: unknown;

      source
        .pipe(retryTransientWithBackoff({ maxRetries: 1 }))
        .subscribe({ error: (e) => (error = e) });
      jasmine.clock().tick(1_000);

      expect(calls()).toBe(2);
      expect((error as HttpErrorResponse).status).toBe(502);
    });
  });

  describe('pollAsyncJob con backoff', () => {
    function job(states: AsyncJobStatus<string>['status'][]) {
      const at: number[] = [];
      const start = Date.now();
      let i = 0;
      return {
        poll: () =>
          defer(() => {
            at.push(Date.now() - start);
            const status = states[Math.min(i, states.length - 1)];
            i++;
            return of<AsyncJobStatus<string>>(
              status === 'completed' ? { status, result: 'listo' } : { status },
            );
          }),
        at,
      };
    }

    it('consulta en 0, 1, 3, 7, 17 y 27 s (esperas 1→2→4→10→10)', () => {
      const { poll, at } = job([
        'waiting', 'active', 'active', 'active', 'active', 'completed',
      ]);
      let result: AsyncJobStatus<string> | undefined;

      pollAsyncJob(poll, { backoff: true }).subscribe((r) => (result = r));
      jasmine.clock().tick(27_000);

      expect(at).toEqual([0, 1_000, 3_000, 7_000, 17_000, 27_000]);
      expect(result).toEqual({ status: 'completed', result: 'listo' });
      jasmine.clock().tick(60_000);
      expect(at.length).toBe(6);
    });

    it('lanza AsyncJobPollLimitError al llegar a maxAttempts sin estado terminal', () => {
      const { poll, at } = job(['active']);
      let error: unknown;

      pollAsyncJob(poll, { backoff: true, maxAttempts: 3 }).subscribe({
        error: (e) => (error = e),
      });
      jasmine.clock().tick(60_000);

      expect(at).toEqual([0, 1_000, 3_000]);
      expect(error).toEqual(jasmine.any(AsyncJobPollLimitError));
      expect((error as AsyncJobPollLimitError).attempts).toBe(3);
      expect((error as AsyncJobPollLimitError).lastStatus).toBe('active');
    });

    it('un job que falla emite su estado failed en vez de lanzar', () => {
      const { poll } = job(['active', 'failed']);
      let result: AsyncJobStatus<string> | undefined;

      pollAsyncJob(poll, { backoff: true }).subscribe((r) => (result = r));
      jasmine.clock().tick(1_000);

      expect(result?.status).toBe('failed');
    });

    it('sin backoff conserva el intervalo fijo de 3 s (comportamiento previo)', () => {
      const { poll, at } = job(['waiting', 'active', 'completed']);
      let result: AsyncJobStatus<string> | undefined;

      pollAsyncJob(poll).subscribe((r) => (result = r));
      jasmine.clock().tick(6_000);

      expect(at).toEqual([0, 3_000, 6_000]);
      expect(result?.status).toBe('completed');
    });
  });
});
