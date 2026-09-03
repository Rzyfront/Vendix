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
      id: 42,
      state: 'delivered',
      order_number: 'ORD-2026-001',
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

  it('idempotencia: orden ya en delivered (service hace no-op de un re-trigger) emite SSE', async () => {
    // El service retorna la orden tal cual cuando NO está en `processing`
    // (puede estar en `delivered`, `finished`, etc.). El listener distingue:
    //   - state === 'delivered' → ya estaba entregada, pero igual emitimos
    //     porque podría ser una reconexión / re-trigger desde el KDS. El
    //     upsert en el cliente es idempotente.
    //   - state !== 'delivered' → no-op real, NO emite.
    const { listener, orderFlowService, orderSseService } = buildListener();
    orderFlowService.markKitchenOrderDelivered.mockResolvedValue({
      id: 42,
      state: 'delivered',
      order_number: 'ORD-2026-001',
    });

    await listener.handleAllDelivered({ orderId: 42, storeId: 7 });

    // El guard acepta `state === 'delivered'` → emite.
    expect(orderSseService.pushOrderEvent).toHaveBeenCalledTimes(1);
  });

  it('idempotencia: orden en finished (auto-finalizada por el job de 4h) NO emite SSE', async () => {
    const { listener, orderFlowService, orderSseService } = buildListener();
    orderFlowService.markKitchenOrderDelivered.mockResolvedValue({
      id: 42,
      state: 'finished',
      order_number: 'ORD-2026-001',
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
      id: 42,
      state: 'delivered',
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
      id: 42,
      state: 'delivered',
      // sin order_number — simula un SELECT mínimo en el service.
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
