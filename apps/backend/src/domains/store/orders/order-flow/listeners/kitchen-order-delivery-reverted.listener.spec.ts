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
      order: { id: 99, state: 'processing', order_number: 'ORD-2026-099' },
      transitioned: true,
      previousState: 'delivered',
    });

    await listener.handleDeliveryReverted({ orderId: 99, storeId: 4 });

    expect(orderFlowService.revertKitchenOrderDelivery).toHaveBeenCalledWith(
      99,
    );
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

  it('idempotencia: orden ya en processing (no-op, transitioned=false) NO emite SSE', async () => {
    // El service es no-op con `transitioned: false` cuando la orden NO estaba
    // en `delivered`. El listener decide por `transitioned`, NO por
    // `order.state`: el chequeo viejo (`state === 'processing'`) emitía un
    // `status_changed` fantasma con `old_state: 'delivered'` inventado cada
    // vez que la orden YA estaba en `processing`.
    const { listener, orderFlowService, orderSseService } = buildListener();
    orderFlowService.revertKitchenOrderDelivery.mockResolvedValue({
      order: { id: 99, state: 'processing' },
      transitioned: false,
      previousState: 'processing',
    });

    await listener.handleDeliveryReverted({ orderId: 99, storeId: 4 });

    expect(orderSseService.pushOrderEvent).not.toHaveBeenCalled();
  });

  it('idempotencia: orden en finished (no estaba en delivered) NO emite SSE', async () => {
    const { listener, orderFlowService, orderSseService } = buildListener();
    orderFlowService.revertKitchenOrderDelivery.mockResolvedValue({
      order: { id: 99, state: 'finished' },
      transitioned: false,
      previousState: 'finished',
    });

    await listener.handleDeliveryReverted({ orderId: 99, storeId: 4 });

    expect(orderSseService.pushOrderEvent).not.toHaveBeenCalled();
  });

  it('idempotencia: orden inexistente (order null, transitioned=false) NO emite SSE', async () => {
    const { listener, orderFlowService, orderSseService } = buildListener();
    orderFlowService.revertKitchenOrderDelivery.mockResolvedValue({
      order: null,
      transitioned: false,
      previousState: null,
    });

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
      order: { id: 99, state: 'processing' },
      transitioned: true,
      previousState: 'delivered',
    });

    await listener.handleDeliveryReverted({ orderId: 99, storeId: 4 });

    expect(storeContextRunner.runInStoreContext).toHaveBeenCalledWith(
      4,
      expect.any(Function),
    );
    const callback = storeContextRunner.runInStoreContext.mock.calls[0][1];
    await callback();
    expect(orderFlowService.revertKitchenOrderDelivery).toHaveBeenCalledWith(
      99,
    );
  });

  it('order_number ausente en el retorno del service: emite con string vacío (defensivo)', async () => {
    const { listener, orderFlowService, orderSseService } = buildListener();
    orderFlowService.revertKitchenOrderDelivery.mockResolvedValue({
      order: { id: 99, state: 'processing' },
      transitioned: true,
      previousState: 'delivered',
      // sin order_number — la vista devuelta puede no exponerlo.
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
