import { KitchenOrderDeliveredListener } from './kitchen-order-delivered.listener';

/**
 * Cobertura del boundary SSE que conecta el evento interno
 * `kitchen.order_all_delivered` con el subject compartido por tienda en
 * `NotificationsSseService` (vía `OrderSseService.pushOrderEvent`). Lo que
 * se prueba aquí es la DECISIÓN de emitir o no emitir, no el
 * `OrderFlowService` (ese tiene su propio spec) ni `OrderSseService` (es un
 * wrapper trivial alrededor de `NotificationsSseService.push`).
 *
 * Patrón: factory `buildListener()` con mocks de las 3 deps del constructor.
 * Inspirado en `notifications-events.listener.spec.ts` (mismo archivo).
 */
describe('KitchenOrderDeliveredListener — SSE push (QUI-777)', () => {
  function buildListener() {
    const orderFlowService = {
      markKitchenOrderDelivered: jest.fn(),
    } as any;
    const storeContextRunner = {
      runInStoreContext: jest.fn(
        async (_storeId: number, fn: () => Promise<any>) => fn(),
      ),
    } as any;
    // OrderSseService: solo el método que el listener usa. El wrapper real
    // lo provee OrderSseService.pushOrderEvent; mockear `pushOrderEvent`
    // directamente es la frontera mínima para probar la decisión.
    const orderSseService = {
      pushOrderEvent: jest.fn(),
    } as any;

    const listener = new KitchenOrderDeliveredListener(
      orderFlowService,
      storeContextRunner,
      orderSseService,
    );

    return { listener, orderFlowService, storeContextRunner, orderSseService };
  }

  it('happy path: orden en processing transiciona a delivered y emite SSE con kind y extra exactos', async () => {
    const { listener, orderFlowService, orderSseService } = buildListener();
    orderFlowService.markKitchenOrderDelivered.mockResolvedValue({
      order: { id: 42, state: 'delivered', order_number: 'ORD-2026-001' },
      transitioned: true,
      previousState: 'processing',
    });

    await listener.handleAllDelivered({ orderId: 42, storeId: 7 });

    expect(orderFlowService.markKitchenOrderDelivered).toHaveBeenCalledWith(42);
    expect(orderSseService.pushOrderEvent).toHaveBeenCalledTimes(1);
    expect(orderSseService.pushOrderEvent).toHaveBeenCalledWith(
      7, // storeId
      42, // orderId
      'order.status_changed', // kind
      expect.objectContaining({
        old_state: 'processing',
        new_state: 'delivered',
        order_number: 'ORD-2026-001',
      }),
    );
  });

  it('idempotencia: orden ya en delivered (no-op, transitioned=false) NO emite SSE', async () => {
    // El service retorna la fila tal cual con `transitioned: false` cuando NO
    // estaba en `processing`. El listener decide por `transitioned`, NO por
    // `order.state`: un re-trigger del KDS sobre una orden ya entregada no
    // debe re-emitir (el chequeo viejo por `state === 'delivered'` sí lo
    // hacía, con un `old_state` inventado).
    const { listener, orderFlowService, orderSseService } = buildListener();
    orderFlowService.markKitchenOrderDelivered.mockResolvedValue({
      order: { id: 42, state: 'delivered', order_number: 'ORD-2026-001' },
      transitioned: false,
      previousState: 'delivered',
    });

    await listener.handleAllDelivered({ orderId: 42, storeId: 7 });

    expect(orderSseService.pushOrderEvent).not.toHaveBeenCalled();
  });

  it('idempotencia: orden en finished (auto-finalizada por el job de 4h) NO emite SSE', async () => {
    const { listener, orderFlowService, orderSseService } = buildListener();
    orderFlowService.markKitchenOrderDelivered.mockResolvedValue({
      order: { id: 42, state: 'finished', order_number: 'ORD-2026-001' },
      transitioned: false,
      previousState: 'finished',
    });

    await listener.handleAllDelivered({ orderId: 42, storeId: 7 });

    expect(orderSseService.pushOrderEvent).not.toHaveBeenCalled();
  });

  it('error del service: log + swallow + NO emitir SSE', async () => {
    const { listener, orderFlowService, orderSseService } = buildListener();
    orderFlowService.markKitchenOrderDelivered.mockRejectedValue(
      new Error('DB blew up'),
    );
    const loggerErrorSpy = jest
      .spyOn((listener as any).logger, 'error')
      .mockImplementation(() => undefined);

    await expect(
      listener.handleAllDelivered({ orderId: 42, storeId: 7 }),
    ).resolves.toBeUndefined();

    expect(orderSseService.pushOrderEvent).not.toHaveBeenCalled();
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to deliver order #42'),
      expect.any(String),
    );
  });

  it('reestablece el contexto de tienda antes de tocar el service', async () => {
    const { listener, orderFlowService, storeContextRunner } = buildListener();
    orderFlowService.markKitchenOrderDelivered.mockResolvedValue({
      order: { id: 42, state: 'delivered' },
      transitioned: true,
      previousState: 'processing',
    });

    await listener.handleAllDelivered({ orderId: 42, storeId: 7 });

    expect(storeContextRunner.runInStoreContext).toHaveBeenCalledWith(
      7,
      expect.any(Function),
    );
    // El callback pasado a runInStoreContext debe invocar el service.
    const callback = storeContextRunner.runInStoreContext.mock.calls[0][1];
    await callback();
    expect(orderFlowService.markKitchenOrderDelivered).toHaveBeenCalledWith(42);
  });

  it('order_number ausente en el retorno del service: emite con string vacío (defensivo, no rompe el push)', async () => {
    const { listener, orderFlowService, orderSseService } = buildListener();
    orderFlowService.markKitchenOrderDelivered.mockResolvedValue({
      order: { id: 42, state: 'delivered' },
      transitioned: true,
      previousState: 'processing',
      // sin order_number — la vista devuelta puede no exponerlo.
    });

    await listener.handleAllDelivered({ orderId: 42, storeId: 7 });

    expect(orderSseService.pushOrderEvent).toHaveBeenCalledWith(
      7,
      42,
      'order.status_changed',
      expect.objectContaining({ order_number: '' }),
    );
  });
});
