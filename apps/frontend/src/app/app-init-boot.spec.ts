import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Action, ActionsSubject, Store, provideStore } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';

import { APP_INIT_TIMEOUT_MS, initializeApp } from './app.config';
import { RouteManagerService } from './core/services/route-manager.service';
import { configReducer } from './core/store/config/config.reducer';
import * as ConfigActions from './core/store/config/config.actions';
import {
  APP_INIT_GRACE_MS,
  BACKEND_HEALTH_TIMEOUT_MS,
} from './core/utils/backend-availability.util';
import type { AppConfig } from './core/services/app-config.service';

/**
 * Arranque REAL: `initializeApp` (APP_INITIALIZER) + `RouteManagerService`
 * juntos, con la resolución de dominio colgada (nadie responde a
 * `initializeApp`, como cuando la petición se queda en la cola del navegador).
 *
 * Regla: el gato global (`initializeAppFailure` → `resolutionError`) solo sale
 * si `/health` confirma que el backend no responde. Antes, el temporizador de
 * 5 s del RouteManagerService lo despachaba sin pasar por la sonda.
 *
 * El arnés es zoneless (`test-init.ts`): el tiempo se controla con el reloj de
 * Jasmine y las promesas se vacían a mano.
 */
describe('Arranque de la app: cuándo sale el gato global', () => {
  let store: Store;
  let dispatched: Action[];
  let fetchSpy: jasmine.Spy;
  let initResult: boolean | undefined;

  async function flush(): Promise<void> {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  }

  /** Avanza el reloj en pasos de 1 s para que timers y promesas se intercalen. */
  async function advance(ms: number): Promise<void> {
    let left = ms;
    while (left > 0) {
      const step = Math.min(1_000, left);
      jasmine.clock().tick(step);
      left -= step;
      await flush();
    }
  }

  const failures = () =>
    dispatched.filter(
      (a) => a.type === ConfigActions.initializeAppFailure.type,
    );

  const resolutionError = async () =>
    (
      (await firstValueFrom(
        store.select((s: any) => s.config).pipe(take(1)),
      )) as {
        resolutionError: unknown;
      }
    ).resolutionError;

  function boot(): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideStore({ config: configReducer }),
        provideEffects(),
      ],
    });
    store = TestBed.inject(Store);
    dispatched = [];
    TestBed.inject(ActionsSubject).subscribe((action) =>
      dispatched.push(action),
    );
    const routeManager = TestBed.inject(RouteManagerService);
    initResult = undefined;
    void initializeApp(store, routeManager)().then((r) => (initResult = r));
  }

  beforeEach(() => {
    jasmine.clock().install();
    fetchSpy = spyOn(window, 'fetch');
  });

  afterEach(() => jasmine.clock().uninstall());

  it('backend vivo + arranque lento → NO hay gato: sigue cargando hasta que resuelve', async () => {
    fetchSpy.and.resolveTo(new Response('{}', { status: 200 }));
    boot();

    // A los 6 s (antes moría aquí por el temporizador de 5 s del RouteManager).
    await advance(6_000);
    expect(failures()).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();

    // A los 12 s ya venció el plazo de arranque: se consultó /health, está vivo.
    await advance(6_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.calls.mostRecent().args[0])).toMatch(/\/health$/);
    expect(failures()).toEqual([]);
    expect(initResult).toBeUndefined(); // sigue en el splash

    // La resolución llega tarde (dentro del margen): rutas listas, sin gato.
    await advance(APP_INIT_GRACE_MS - 5_000);
    expect(failures()).toEqual([]);
    store.dispatch(
      ConfigActions.initializeAppSuccess({ config: {} as AppConfig }),
    );
    await advance(1_000);

    expect(initResult).toBeTrue();
    expect(failures()).toEqual([]);
    expect(await resolutionError()).toBeNull();

    // Y nada lo dispara después.
    await advance(60_000);
    expect(failures()).toEqual([]);
  });

  it('backend caído (/health falla) → gato al vencer el plazo de arranque', async () => {
    fetchSpy.and.rejectWith(new TypeError('Failed to fetch'));
    boot();

    await advance(APP_INIT_TIMEOUT_MS - 1_000);
    expect(failures()).toEqual([]);

    await advance(2_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // fallo rápido: sin reintento
    expect(failures().length).toBe(1);
    expect(await resolutionError()).toEqual({ kind: 'transient' });
    expect(initResult).toBeTrue(); // libera el APP_INITIALIZER
  });

  it('/health no contesta → reintenta una vez y, si tampoco, gato', async () => {
    fetchSpy.and.callFake(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          ),
        ),
    );
    boot();

    await advance(APP_INIT_TIMEOUT_MS + BACKEND_HEALTH_TIMEOUT_MS);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // primer intento agotado → reintento
    expect(failures()).toEqual([]);

    await advance(BACKEND_HEALTH_TIMEOUT_MS);
    expect(failures().length).toBe(1);
    expect(initResult).toBeTrue();
  });
});
