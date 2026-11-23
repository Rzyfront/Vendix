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

  describe('isBackendReachable: plazo corto por intento y un reintento', () => {
    const hangingOnce = () => {
      let calls = 0;
      return jasmine
        .createSpy('fetch')
        .and.callFake(
          (
            _url: string,
            init?: { signal?: AbortSignal },
          ): Promise<{ ok: boolean }> => {
            calls++;
            if (calls > 1) return Promise.resolve({ ok: true });
            return new Promise((_resolve, reject) =>
              init?.signal?.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError')),
              ),
            );
          },
        );
    };

    it('el primer intento se agota por tiempo y el reintento responde → vivo', async () => {
      const fetchImpl = hangingOnce();

      await expectAsync(
        isBackendReachable('https://api.test/api', 20, fetchImpl),
      ).toBeResolvedTo(true);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('fallo rápido (red o 5xx) → caído sin reintentar', async () => {
      const network = jasmine
        .createSpy('fetch')
        .and.rejectWith(new TypeError('Failed to fetch'));
      const badGateway = jasmine
        .createSpy('fetch')
        .and.resolveTo({ ok: false, status: 502 });

      await expectAsync(
        isBackendReachable('https://api.test/api', 50, network),
      ).toBeResolvedTo(false);
      await expectAsync(
        isBackendReachable('https://api.test/api', 50, badGateway),
      ).toBeResolvedTo(false);
      expect(network).toHaveBeenCalledTimes(1);
      expect(badGateway).toHaveBeenCalledTimes(1);
    });
  });

  describe('isBackendReachable: qué cuenta como caída', () => {
    const probe = (status: number) =>
      isBackendReachable(
        'https://api.test/api',
        50,
        jasmine
          .createSpy('fetch')
          .and.resolveTo({ ok: status >= 200 && status < 300, status }),
      );

    it('cualquier respuesta HTTP < 500 (incluido 4xx) → vivo', async () => {
      for (const status of [200, 204, 301, 401, 403, 404, 429]) {
        await expectAsync(probe(status))
          .withContext(`status ${status}`)
          .toBeResolvedTo(true);
      }
    });

    it('status 0 (sin respuesta) o 5xx → caído', async () => {
      for (const status of [0, 500, 502, 503, 504]) {
        await expectAsync(probe(status))
          .withContext(`status ${status}`)
          .toBeResolvedTo(false);
      }
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

    it('con onRetry: backend vivo y la resolución no llega → reintenta, sin gato', async () => {
      const routes$ = new BehaviorSubject(false);
      const onFailure = jasmine.createSpy('onFailure');
      const probeBackend = jasmine.createSpy('probe').and.resolveTo(true);
      let retries = 0;
      const onRetry = jasmine.createSpy('onRetry').and.callFake(() => {
        retries++;
        if (retries === 2) setTimeout(() => routes$.next(true), 5);
      });

      await expectAsync(
        settleSlowAppInit({
          routesConfigured$: routes$,
          probeBackend,
          onFailure,
          onRetry,
          graceMs: 20,
        }),
      ).toBeResolvedTo(true);
      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(probeBackend).toHaveBeenCalledTimes(3);
      expect(onFailure).not.toHaveBeenCalled();
    });

    it('con onRetry: si al reintentar /health ya no responde → gato', async () => {
      const onFailure = jasmine.createSpy('onFailure');
      const probeBackend = jasmine
        .createSpy('probe')
        .and.returnValues(Promise.resolve(true), Promise.resolve(false));
      const onRetry = jasmine.createSpy('onRetry');

      await settleSlowAppInit({
        routesConfigured$: new BehaviorSubject(false),
        probeBackend,
        onFailure,
        onRetry,
        graceMs: 20,
      });

      expect(onRetry).toHaveBeenCalledTimes(1);
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
