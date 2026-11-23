import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, NEVER, firstValueFrom, throwError } from 'rxjs';
import {
  USER_ACTION_TIMEOUT_MESSAGE,
  isBackendReachable,
  settleSlowAppInit,
  withUserActionTimeout,
} from './backend-availability.util';

describe('backend-availability.util', () => {
  describe('isBackendReachable', () => {
    it('true cuando /health responde 2xx', async () => {
      const fetchImpl = jasmine.createSpy('fetch').and.resolveTo({ ok: true });

      await expectAsync(
        isBackendReachable('https://api.test/api', 50, fetchImpl),
      ).toBeResolvedTo(true);
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://api.test/api/health',
        jasmine.objectContaining({ cache: 'no-store' }),
      );
    });

    it('false cuando la red falla o /health no contesta a tiempo (nunca lanza)', async () => {
      const failing = jasmine
        .createSpy('fetch')
        .and.rejectWith(new TypeError('Failed to fetch'));
      const hanging = (
        _url: string,
        init?: { signal?: AbortSignal },
      ): Promise<{ ok: boolean }> =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          ),
        );

      await expectAsync(
        isBackendReachable('https://api.test/api', 50, failing),
      ).toBeResolvedTo(false);
      await expectAsync(
        isBackendReachable('https://api.test/api', 20, hanging),
      ).toBeResolvedTo(false);
    });
  });

  describe('settleSlowAppInit (cuándo sale el gato global)', () => {
    it('caída real: /health falla → muestra el gato al instante', async () => {
      const onFailure = jasmine.createSpy('onFailure');

      const result = await settleSlowAppInit({
        routesConfigured$: new BehaviorSubject(false),
        probeBackend: () => Promise.resolve(false),
        onFailure,
        graceMs: 1_000,
      });

      expect(result).toBeTrue();
      expect(onFailure).toHaveBeenCalledTimes(1);
    });

    it('arranque lento con backend vivo → espera y NO muestra el gato', async () => {
      const routes$ = new BehaviorSubject(false);
      const onFailure = jasmine.createSpy('onFailure');

      const pending = settleSlowAppInit({
        routesConfigured$: routes$,
        probeBackend: () => Promise.resolve(true),
        onFailure,
        graceMs: 1_000,
      });
      setTimeout(() => routes$.next(true), 10);

      await expectAsync(pending).toBeResolvedTo(true);
      expect(onFailure).not.toHaveBeenCalled();
    });

    it('backend vivo pero la resolución nunca termina → gato tras el margen', async () => {
      const onFailure = jasmine.createSpy('onFailure');

      await settleSlowAppInit({
        routesConfigured$: new BehaviorSubject(false),
        probeBackend: () => Promise.resolve(true),
        onFailure,
        graceMs: 20,
      });

      expect(onFailure).toHaveBeenCalledTimes(1);
    });
  });

  describe('withUserActionTimeout', () => {
    it('una acción colgada termina en un Error legible (para el toast)', async () => {
      await expectAsync(
        firstValueFrom(NEVER.pipe(withUserActionTimeout(20))),
      ).toBeRejectedWith(new Error(USER_ACTION_TIMEOUT_MESSAGE));
    });

    it('los errores HTTP (p. ej. 400) pasan intactos', async () => {
      const badRequest = new HttpErrorResponse({ status: 400 });

      await expectAsync(
        firstValueFrom(
          throwError(() => badRequest).pipe(withUserActionTimeout(1_000)),
        ),
      ).toBeRejectedWith(badRequest);
    });
  });
});
