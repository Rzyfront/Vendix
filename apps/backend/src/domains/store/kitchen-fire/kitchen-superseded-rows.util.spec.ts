import {
  closeSupersededKitchenRows,
  findLinesAwaitingKitchenDelivery,
} from './kitchen-superseded-rows.util';

describe('kitchen-superseded-rows.util (QUI-892)', () => {
  const makeClient = () => ({
    kitchen_ticket_items: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    kitchen_tickets: { update: jest.fn().mockResolvedValue({}) },
    order_items: { findMany: jest.fn() },
  });

  describe('closeSupersededKitchenRows', () => {
    it('no hace queries con lista vacía', async () => {
      const c = makeClient();
      expect(await closeSupersededKitchenRows(c, [])).toEqual([]);
      expect(c.kitchen_ticket_items.findFirst).not.toHaveBeenCalled();
    });

    it('cancela la fila vieja ready cuando la última está delivered y recalcula su ticket', async () => {
      const c = makeClient();
      c.kitchen_ticket_items.findFirst.mockResolvedValue({ id: 20, status: 'delivered' });
      c.kitchen_ticket_items.findMany
        .mockResolvedValueOnce([{ kitchen_ticket_id: 7 }])
        .mockResolvedValueOnce([{ status: 'cancelled' }]);
      const res = await closeSupersededKitchenRows(c, [5]);
      expect(c.kitchen_ticket_items.updateMany).toHaveBeenCalledWith({
        where: { order_item_id: 5, id: { lt: 20 }, status: { notIn: ['delivered', 'cancelled'] } },
        data: expect.objectContaining({ status: 'cancelled' }),
      });
      expect(c.kitchen_tickets.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: expect.objectContaining({ status: 'cancelled' }),
      });
      expect(res).toEqual([7]);
    });

    it('marca el ticket delivered si alguna fila quedó delivered', async () => {
      const c = makeClient();
      c.kitchen_ticket_items.findFirst.mockResolvedValue({ id: 20, status: 'delivered' });
      c.kitchen_ticket_items.findMany
        .mockResolvedValueOnce([{ kitchen_ticket_id: 7 }])
        .mockResolvedValueOnce([{ status: 'cancelled' }, { status: 'delivered' }]);
      await closeSupersededKitchenRows(c, [5]);
      expect(c.kitchen_tickets.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: expect.objectContaining({ status: 'delivered' }),
      });
    });

    it('no recalcula si el ticket aún tiene filas vivas', async () => {
      const c = makeClient();
      c.kitchen_ticket_items.findFirst.mockResolvedValue({ id: 20, status: 'delivered' });
      c.kitchen_ticket_items.findMany
        .mockResolvedValueOnce([{ kitchen_ticket_id: 7 }])
        .mockResolvedValueOnce([{ status: 'cancelled' }, { status: 'pending' }]);
      const res = await closeSupersededKitchenRows(c, [5]);
      expect(c.kitchen_tickets.update).not.toHaveBeenCalled();
      expect(res).toEqual([7]);
    });

    it('no hace nada si la última fila no está delivered', async () => {
      const c = makeClient();
      c.kitchen_ticket_items.findFirst.mockResolvedValue({ id: 20, status: 'pending' });
      expect(await closeSupersededKitchenRows(c, [5])).toEqual([]);
      expect(c.kitchen_ticket_items.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('findLinesAwaitingKitchenDelivery', () => {
    it('ignora filas viejas: solo cuenta la última de cada línea', async () => {
      const c = makeClient();
      c.order_items.findMany.mockResolvedValue([
        { id: 1, product_name: 'A', kitchen_ticket_items: [{ status: 'delivered', quantity: 1, variant_label: null }] },
        { id: 2, product_name: 'B', kitchen_ticket_items: [{ status: 'pending', quantity: 2, variant_label: 'XL' }] },
      ]);
      const res = await findLinesAwaitingKitchenDelivery(c, 9);
      expect(res).toEqual([
        { order_item_id: 2, product_name: 'B', variant_label: 'XL', quantity: 2, status: 'pending' },
      ]);
      expect(c.order_items.findMany.mock.calls[0][0].where).toMatchObject({
        order_id: 9,
        cancelled_at: null,
      });
    });

    it('tolera lines undefined', async () => {
      const c = makeClient();
      c.order_items.findMany.mockResolvedValue(undefined);
      expect(await findLinesAwaitingKitchenDelivery(c, 9)).toEqual([]);
    });
  });
});
