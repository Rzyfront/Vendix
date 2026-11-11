import { TestBed } from '@angular/core/testing';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import {
  PRODUCTION_RECONNECT_WINDOW_MS,
  ProductionSseService,
  ProductionStreamSignal,
} from './production-sse.service';

/**
 * S21 (release #1134): el stream de producción no insiste sin permiso.
 *  - `canStream` sigue el permiso dual del backend (OR);
 *  - un 401/403 lo detiene sin reconectar ni pasar a polling;
 *  - un fallo de red sí reconecta;
 *  - en modo manual vuelve a vivo al recuperar la red o el foco.
 * `EventSource` y el sondeo de estado se sustituyen: no hay red real.
 */
describe('ProductionSseService — S21', () => {
  let service: ProductionSseService;
  let instances: EventSourceStub[];
  let permissions: string[];

  class EventSourceStub {
    onopen: ((ev?: unknown) => void) | null = null;
    onmessage: ((ev: unknown) => void) | null = null;
    onerror: ((ev?: unknown) => void) | null = null;
    close = jasmine.createSpy('close');
    constructor(public url: string) {
      instances.push(this);
    }
  }

  /** Deja correr las promesas pendientes (el sondeo de estado es asíncrono). */
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  const probe = (status: number | null) =>
    spyOn(service as unknown as { probeStatus: () => Promise<number | null> }, 'probeStatus').and.resolveTo(status);

  beforeEach(() => {
    instances = [];
    permissions = [];
    (globalThis as unknown as { EventSource: unknown }).EventSource = EventSourceStub;
    localStorage.setItem(
      'vendix_auth_state',
      JSON.stringify({ tokens: { access_token: 'fake-jwt' } }),
    );
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthFacade,
          useValue: {
            hasAnyPermission: (list: string[]) => list.some((p) => permissions.includes(p)),
          },
        },
      ],
    });
    service = TestBed.inject(ProductionSseService);
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(0));
  });

  afterEach(() => {
    jasmine.clock().uninstall();
    service.ngOnDestroy();
    delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
    localStorage.removeItem('vendix_auth_state');
  });

  it('canStream: sin permisos de producción no se debe abrir el stream', () => {
    expect(service.canStream()).toBeFalse();
    expect(service.canStream('manufacturing')).toBeFalse();
  });

  it('canStream: cualquiera de los dos permisos de lectura abre el stream de restaurante', () => {
    permissions = ['store:production_orders:read'];
    expect(service.canStream()).toBeTrue();
    permissions = ['store:manufacturing:orders:read'];
    expect(service.canStream()).toBeTrue();
    expect(service.canStream('manufacturing')).toBeTrue();
    permissions = ['store:production_orders:read'];
    expect(service.canStream('manufacturing')).toBeFalse();
  });

  it('un 403 detiene el stream: no reconecta ni pasa a polling', async () => {
    probe(403);
    const signals: ProductionStreamSignal[] = [];
    service.signals$.subscribe((s) => signals.push(s));
    const release = service.acquire();
    expect(instances.length).toBe(1);

    instances[0].onerror?.();
    await flush();

    expect(service.forbidden()).toBeTrue();
    expect(service.connectionState()).toBe('closed');
    jasmine.clock().tick(PRODUCTION_RECONNECT_WINDOW_MS + 60_000);
    expect(instances.length).toBe(1);
    expect(service.mode()).toBe('live');
    expect(signals.filter((s) => s.type === 'refresh').length).toBe(0);
    release();
  });

  it('un 401 también lo detiene', async () => {
    probe(401);
    const release = service.acquire();
    instances[0].onerror?.();
    await flush();
    jasmine.clock().tick(60_000);
    expect(service.forbidden()).toBeTrue();
    expect(instances.length).toBe(1);
    release();
  });

  it('un fallo de red (sin status) sí reconecta con backoff', async () => {
    probe(null);
    const release = service.acquire();
    instances[0].onerror?.();
    await flush();
    expect(service.forbidden()).toBeFalse();
    jasmine.clock().tick(1_000);
    expect(instances.length).toBe(2);
    release();
  });

  it('en modo manual vuelve a vivo al recuperar la red', async () => {
    probe(null);
    const signals: ProductionStreamSignal[] = [];
    service.signals$.subscribe((s) => signals.push(s));
    const release = service.acquire();
    instances[0].onerror?.();
    await flush();
    jasmine.clock().tick(1_000);
    expect(instances.length).toBe(2);

    // Pasada la ventana de reconexión, el siguiente fallo cae a polling.
    jasmine.clock().mockDate(new Date(PRODUCTION_RECONNECT_WINDOW_MS + 2_000));
    instances[1].onerror?.();
    await flush();
    expect(service.mode()).toBe('manual');
    expect(signals.some((s) => s.type === 'refresh')).toBeTrue();

    window.dispatchEvent(new Event('online'));
    expect(instances.length).toBe(3);
    instances[2].onopen?.();
    expect(service.mode()).toBe('live');
    expect(service.connectionState()).toBe('open');
    release();
  });

  it('en modo manual también vuelve a vivo al recuperar el foco', async () => {
    probe(null);
    const release = service.acquire();
    instances[0].onerror?.();
    await flush();
    jasmine.clock().tick(1_000);
    jasmine.clock().mockDate(new Date(PRODUCTION_RECONNECT_WINDOW_MS + 2_000));
    instances[1].onerror?.();
    await flush();
    expect(service.mode()).toBe('manual');

    window.dispatchEvent(new Event('focus'));
    expect(instances.length).toBe(3);
    release();
  });
});
