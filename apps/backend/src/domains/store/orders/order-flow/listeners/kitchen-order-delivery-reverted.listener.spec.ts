import { KitchenOrderDeliveryRevertedListener } from './kitchen-order-delivery-reverted.listener';

/**
 * Espejo de `kitchen-order-delivered.listener.spec.ts` para el listener que
 * maneja `kitchen.order_delivery_reverted` (reversa de un ticket terminal).
 * Misma forma de validación: solo emite SSE si el service realmente
 * transicionó la orden `delivered -> processing`.
 */
describe('KitchenOrderDeliveryRevertedListener — SSE push (QUI-777)', () => {
  function buildListener() {
    const orderFlowService = {
      revertKitchenOrderDelivery: jest.fn(),
    } as any;
    const storeContextRunner = {
      runInStoreContext: jest.fn(
        async (_storeId: number, fn: () => Promise<any>) => fn(),
      ),
    } as any;
    const orderSseService = {
      pushOrderEvent: jest.fn(),
    } as any;

    const listener = new KitchenOrderDeliveryRevertedListener(
      orderFlowService,
      storeContextRunner,
      orderSseService,
    );

    return { listener, orderFlowService, storeContextRunner, orderSseService };
  }

  it('happy path: orden en delivered transiciona a processing y emite SSE con kind y extra exactos', async () => {
    const { listener, orderFlowService, orderSseService } = buildListener();
    orderFlowService.revertKitchenOrderDelivery.mockResolvedValue({
      id: 99,
      state: 'processing',
      order_number: 'ORD-2026-099',
    });

    await listener.handleDeliveryReverted({ orderId: 99, storeId: 4 });

    expect(orderFlowService.revertKitchenOrderDelivery).toHaveBeenCalledWith(99);
    expect(orderSseService.pushOrderEvent).toHaveBeenCalledTimes(1);
    expect(orderSseService.pushOrderEvent).toHaveBeenCalledWith(
      4, // storeId
      99, // orderId
      'order.status_changed', // kind
      expect.objectContaining({
        old_state: 'delivered',
        new_state: 'processing',
        order_number: 'ORD-2026-099',
      }),
    );
  });

  it('idempotencia: orden en finished (no estaba en delivered) NO emite SSE', async () => {
    // El service es no-op cuando la orden NO está en `delivered` (puede estar
    // en `processing`, `finished`, etc.) y devuelve la fila tal cual.
    //
    // NOTA sobre el guard `state === 'processing'`: también pasa cuando el
    // service hace no-op en una orden que YA estaba en `processing` (devuelve
    // la fila con state='processing' sin transicionar). El listener emite en
    // ese caso también — pero el upsert del cliente es idempotente, así que
    // no causa daño (la UI ya muestra `processing` y el emit solo lo
    // re-confirma). Acá testeamos el caso donde el guard SÍ rechaza: el
    // service devolvió un state distinto de `processing` (no hubo
    // transición).
    const { listener, orderFlowService, orderSseService } = buildListener();
    orderFlowService.revertKitchenOrderDelivery.mockResolvedValue({
      id: 99,
      state: 'finished',
    });

    await listener.handleDeliveryReverted({ orderId: 99, storeId: 4 });

    expect(orderSseService.pushOrderEvent).not.toHaveBeenCalled();
  });

  it('idempotencia: orden inexistente (service retorna null) NO emite SSE', async () => {
    const { listener, orderFlowService, orderSseService } = buildListener();
    orderFlowService.revertKitchenOrderDelivery.mockResolvedValue(null);

    await listener.handleDeliveryReverted({ orderId: 99, storeId: 4 });

    expect(orderSseService.pushOrderEvent).not.toHaveBeenCalled();
  });

  it('error del service: log + swallow + NO emitir SSE', async () => {
    const { listener, orderFlowService, orderSseService } = buildListener();
    orderFlowService.revertKitchenOrderDelivery.mockRejectedValue(
      new Error('DB blew up'),
    );
    const loggerErrorSpy = jest
      .spyOn((listener as any).logger, 'error')
      .mockImplementation(() => undefined);

    await expect(
      listener.handleDeliveryReverted({ orderId: 99, storeId: 4 }),
    ).resolves.toBeUndefined();

    expect(orderSseService.pushOrderEvent).not.toHaveBeenCalled();
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to revert order #99'),
      expect.any(String),
    );
  });

  it('reestablece el contexto de tienda antes de tocar el service', async () => {
    const { listener, orderFlowService, storeContextRunner } = buildListener();
    orderFlowService.revertKitchenOrderDelivery.mockResolvedValue({
      id: 99,
      state: 'processing',
    });

    await listener.handleDeliveryReverted({ orderId: 99, storeId: 4 });

    expect(storeContextRunner.runInStoreContext).toHaveBeenCalledWith(
      4,
      expect.any(Function),
    );
    const callback = storeContextRunner.runInStoreContext.mock.calls[0][1];
    await callback();
    expect(orderFlowService.revertKitchenOrderDelivery).toHaveBeenCalledWith(99);
  });

  it('order_number ausente en el retorno del service: emite con string vacío (defensivo)', async () => {
    const { listener, orderFlowService, orderSseService } = buildListener();
    orderFlowService.revertKitchenOrderDelivery.mockResolvedValue({
      id: 99,
      state: 'processing',
      // sin order_number — el service usa findFirst con `select: { id, state }`
      // en el camino de no-op, así que esto puede ocurrir si la transición
      // real pasa por un camino que no expone order_number.
    });

    await listener.handleDeliveryReverted({ orderId: 99, storeId: 4 });

    expect(orderSseService.pushOrderEvent).toHaveBeenCalledWith(
      4,
      99,
      'order.status_changed',
      expect.objectContaining({ order_number: '' }),
    );
  });
});
