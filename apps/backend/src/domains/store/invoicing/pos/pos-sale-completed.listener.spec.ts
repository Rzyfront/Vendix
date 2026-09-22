import { PosSaleCompletedListener } from './pos-sale-completed.listener';
import { PosSaleCompletedEvent } from './pos-sale-completed.event';

/**
 * El listener es el ÚNICO lector de `auto_emit` en el camino del evento: el
 * emisor (payments.service o order-flow.service) lo resuelve y lo pone en el
 * payload; acá se aplica. También es el punto donde un evento duplicado
 * concurrente (doble clic / reintento) se colapsa en una sola emisión.
 */
describe('PosSaleCompletedListener', () => {
  const event = (overrides: Partial<PosSaleCompletedEvent> = {}): PosSaleCompletedEvent => ({
    organization_id: 1,
    store_id: 4,
    user_id: 9,
    order_id: 100,
    order_number: 'ORD-100',
    auto_emit: true,
    ...overrides,
  });

  const makeListener = (emitForOrder: jest.Mock) =>
    new PosSaleCompletedListener({ emitForOrder } as any);

  it('auto_emit=false NO emite', async () => {
    const emitForOrder = jest.fn();
    await makeListener(emitForOrder).handlePosSaleCompleted(event({ auto_emit: false }));
    expect(emitForOrder).not.toHaveBeenCalled();
  });

  it('auto_emit=true emite el pedido del evento', async () => {
    const emitForOrder = jest
      .fn()
      .mockResolvedValue({ state: 'accepted', invoice_number: 'FE1' });
    await makeListener(emitForOrder).handlePosSaleCompleted(event());
    expect(emitForOrder).toHaveBeenCalledTimes(1);
    expect(emitForOrder).toHaveBeenCalledWith(100);
  });

  it('dos eventos concurrentes del mismo pedido emiten UNA sola vez', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const emitForOrder = jest.fn().mockImplementation(async () => {
      await gate;
      return { state: 'accepted' };
    });
    const listener = makeListener(emitForOrder);

    const first = listener.handlePosSaleCompleted(event());
    const second = listener.handlePosSaleCompleted(event());
    release();
    await Promise.all([first, second]);

    expect(emitForOrder).toHaveBeenCalledTimes(1);
  });

  it('terminada la primera emisión, un evento posterior vuelve a pasar (el servicio reusa el documento)', async () => {
    const emitForOrder = jest.fn().mockResolvedValue({ state: 'accepted' });
    const listener = makeListener(emitForOrder);

    await listener.handlePosSaleCompleted(event());
    await listener.handlePosSaleCompleted(event());

    expect(emitForOrder).toHaveBeenCalledTimes(2);
  });

  it('pedidos distintos no se bloquean entre sí', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const emitForOrder = jest.fn().mockImplementation(async () => {
      await gate;
      return { state: 'accepted' };
    });
    const listener = makeListener(emitForOrder);

    const a = listener.handlePosSaleCompleted(event({ order_id: 1 }));
    const b = listener.handlePosSaleCompleted(event({ order_id: 2 }));
    release();
    await Promise.all([a, b]);

    expect(emitForOrder).toHaveBeenCalledTimes(2);
  });

  it('un fallo de emisión nunca lanza y libera el pedido para un reintento', async () => {
    const emitForOrder = jest
      .fn()
      .mockRejectedValueOnce(new Error('DIAN caída'))
      .mockResolvedValueOnce({ state: 'accepted' });
    const listener = makeListener(emitForOrder);

    await expect(listener.handlePosSaleCompleted(event())).resolves.toBeUndefined();
    await listener.handlePosSaleCompleted(event());

    expect(emitForOrder).toHaveBeenCalledTimes(2);
  });
});
