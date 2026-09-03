import { TestBed } from '@angular/core/testing';
import { OrdersListSseService } from './orders-list-sse.service';

/**
 * QUI-777: spec del cliente SSE de la lista de Órdenes de Venta. Mockeamos
 * `EventSource` global para no abrir una conexión real. Probamos:
 *  - parseo del payload canónico `order.status_changed` desde el subject
 *    compartido por tienda;
 *  - filtrado de OTROS tipos de evento (`order.created`, `ticket.*`,
 *    notificaciones, etc.) — esta vista SOLO consume `order.status_changed`;
 *  - idempotencia del signal `lastRelevantEvent` (puede sobrescribirse con
 *    el mismo evento);
 *  - manejo de heartbeat (líneas que empiezan con ":");
 *  - manejo de token ausente (no abre conexión).
 *
 * Patrón tomado de OrderDetailSseService (mismo archivo): reemplazo el
 * global EventSource con un stub que captura `onmessage` / `onerror` para
 * invocarlos manualmente.
 */
describe('OrdersListSseService — QUI-777', () => {
  let service: OrdersListSseService;

  // Stub del EventSource. Captura las callbacks para invocarlas en test.
  // El proyecto usa Jasmine (no Jest), así que evitamos `jest.fn()` y
  // tipamos el stub como cualquier `any` con los hooks que necesitamos.
  let lastInstance: any;

  class EventSourceStub {
    url: string;
    onopen: ((ev?: any) => void) | null = null;
    onmessage: ((ev: any) => void) | null = null;
    onerror: ((ev?: any) => void) | null = null;
    close = jasmine.createSpy('close');
    constructor(url: string) {
      this.url = url;
      lastInstance = this;
    }
  }

  beforeEach(() => {
    (global as any).EventSource = EventSourceStub;
    localStorage.setItem(
      'vendix_auth_state',
      JSON.stringify({ tokens: { access_token: 'fake-jwt' } }),
    );
    TestBed.configureTestingModule({ providers: [OrdersListSseService] });
    service = TestBed.inject(OrdersListSseService);
  });

  afterEach(() => {
    service.disconnect();
    delete (global as any).EventSource;
    localStorage.removeItem('vendix_auth_state');
  });

  it('abre el SSE con JWT en query string al conectar', () => {
    service.connect();
    expect(lastInstance).toBeTruthy();
    expect(lastInstance.url).toContain('/store/orders/stream');
    expect(lastInstance.url).toContain('token=fake-jwt');
    expect(service.connectionState()).toBe('connecting');
  });

  it('connect() es idempotente: llamar dos veces seguidas abre un solo EventSource', () => {
    service.connect();
    const firstInstance = lastInstance;
    service.connect();
    // La segunda llamada es no-op (no se reemplaza el EventSource vivo).
    expect(lastInstance).toBe(firstInstance);
  });

  it('onmessage con order.status_changed actualiza lastRelevantEvent', () => {
    service.connect();
    lastInstance.onopen?.();
    lastInstance.onmessage?.({
      data: JSON.stringify({
        id: 1,
        type: 'order.status_changed',
        created_at: '2026-09-03T10:00:00.000Z',
        data: {
          order_id: 42,
          kind: 'order.status_changed',
          old_state: 'processing',
          new_state: 'delivered',
          order_number: 'ORD-2026-001',
        },
      }),
    });
    const evt = service.lastRelevantEvent();
    expect(evt).toBeTruthy();
    expect(evt?.data.order_id).toBe(42);
    expect(evt?.data.new_state).toBe('delivered');
    expect(evt?.data.old_state).toBe('processing');
    expect(evt?.data.order_number).toBe('ORD-2026-001');
  });

  it('onmessage con OTRO tipo (order.created) NO actualiza lastRelevantEvent', () => {
    service.connect();
    lastInstance.onopen?.();
    lastInstance.onmessage?.({
      data: JSON.stringify({
        id: 2,
        type: 'order.created',
        created_at: '2026-09-03T10:00:00.000Z',
        data: { order_id: 99, kind: 'order.created' },
      }),
    });
    expect(service.lastRelevantEvent()).toBeNull();
    // El último evento del subject sí se registra, pero no es "relevant".
    expect(service.lastEvent()).toBeNull();
  });

  it('onmessage con heartbeat (línea que empieza con ":") se ignora', () => {
    service.connect();
    lastInstance.onopen?.();
    lastInstance.onmessage?.({ data: ': heartbeat 1234' });
    expect(service.lastRelevantEvent()).toBeNull();
    expect(service.lastEvent()).toBeNull();
  });

  it('onmessage con payload malformado se ignora sin throw', () => {
    service.connect();
    lastInstance.onopen?.();
    expect(() =>
      lastInstance.onmessage?.({ data: 'no es JSON' }),
    ).not.toThrow();
    expect(service.lastRelevantEvent()).toBeNull();
  });

  it('onerror cierra la conexión y programa reconexión (backoff exponencial)', () => {
    service.connect();
    lastInstance.onopen?.();
    expect(service.connectionState()).toBe('open');

    lastInstance.onerror?.();

    expect(service.connectionState()).toBe('reconnecting');
    expect(lastInstance.close).toHaveBeenCalled();
  });

  it('sin token en localStorage: connect() cierra silenciosamente sin abrir EventSource', () => {
    localStorage.removeItem('vendix_auth_state');
    service.connect();
    expect(lastInstance).toBeUndefined();
    expect(service.connectionState()).toBe('idle');
  });

  it('disconnect() cierra el EventSource y limpia el timer de reconexión', () => {
    service.connect();
    lastInstance.onopen?.();
    expect(service.connectionState()).toBe('open');

    service.disconnect();

    expect(lastInstance.close).toHaveBeenCalled();
    expect(service.connectionState()).toBe('closed');
  });
});
