/**
 * P2 — transferencias de organización: despacho con transporte y remisión,
 * recepción parcial, cierre con pérdida y destino externo.
 */
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { OrgTransfersService } from './org-transfers.service';

const DAY = 24 * 60 * 60 * 1000;

function buildHarness(overrides: {
  transfer?: Record<string, any>;
  items?: Array<Record<string, any>>;
} = {}) {
  const items =
    overrides.items ??
    [
      { id: 21, product_id: 1, product_variant_id: null, quantity: 5, quantity_received: 0, quantity_dispatched: null, quantity_lost: 0, batch_id: null },
      { id: 22, product_id: 2, product_variant_id: null, quantity: 2, quantity_received: 0, quantity_dispatched: null, quantity_lost: 0, batch_id: null },
    ];

  const transfer: Record<string, any> = {
    id: 1,
    organization_id: 1,
    transfer_number: 'TRF-20261119-0002',
    status: 'approved',
    approved_by_user_id: 55,
    from_location_id: 7,
    to_location_id: 9,
    expected_date: new Date(Date.now() - 2 * DAY),
    dispatched_at: null,
    movement_mode: 'with_dispatch_notes',
    is_external_destination: false,
    external_destination_name: null,
    external_destination_tax_id: null,
    external_destination_address: null,
    support_document_type: null,
    exit_reason: null,
    no_support_alert: false,
    dispatch_note_id: null,
    receipt_note_id: null,
    notes: null,
    stock_transfer_items: items,
    ...(overrides.transfer ?? {}),
  };

  const notes: Record<number, any> = {};

  const tx: any = {
    stock_transfers: {
      findFirst: jest.fn().mockImplementation(() =>
        Promise.resolve({ ...transfer, stock_transfer_items: items }),
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockImplementation(({ data }: any) => {
        Object.assign(transfer, data);
        return Promise.resolve({ ...transfer, stock_transfer_items: items });
      }),
      create: jest.fn(),
    },
    stock_transfer_items: {
      update: jest.fn().mockImplementation(({ where, data }: any) => {
        const item = items.find((line) => line.id === where.id);
        if (item) Object.assign(item, data);
        return Promise.resolve(item);
      }),
      findMany: jest.fn().mockImplementation(() =>
        Promise.resolve(items.map((line) => ({ ...line }))),
      ),
    },
    stock_levels: {
      findFirst: jest.fn().mockResolvedValue({
        quantity_available: 100,
        cost_per_unit: 700,
        products: { name: 'Camisa', cost_price: 600 },
        product_variants: null,
      }),
    },
    inventory_batches: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    users: { findFirst: jest.fn() },
    vehicles: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    shipping_methods: {
      findFirst: jest.fn().mockResolvedValue({
        id: 4,
        name: 'Transportadora interna',
        store_id: 3,
        is_active: true,
      }),
    },
    workflow_definitions: { findFirst: jest.fn().mockResolvedValue(null) },
    dispatch_notes: {
      findFirst: jest.fn().mockImplementation((args: any) => {
        if (args?.include) {
          return Promise.resolve(notes[args.where?.id] ?? null);
        }
        return Promise.resolve(null);
      }),
      create: jest.fn().mockImplementation(({ data }: any) => {
        const id = 950 + Object.keys(notes).length;
        notes[id] = {
          id,
          ...data,
          dispatch_note_items: (data.dispatch_note_items?.create ?? []).map(
            (item: any, index: number) => ({ id: index + 1, ...item }),
          ),
        };
        return Promise.resolve({ id, dispatch_number: data.dispatch_number });
      }),
      update: jest.fn().mockImplementation(({ where, data }: any) => {
        if (notes[where.id]) Object.assign(notes[where.id], data);
        return Promise.resolve(notes[where.id]);
      }),
    },
    dispatch_note_items: {
      update: jest.fn().mockResolvedValue(undefined),
      create: jest.fn().mockResolvedValue(undefined),
      findMany: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(notes[where.dispatch_note_id]?.dispatch_note_items ?? []),
      ),
    },
  };

  const orgPrisma: any = {
    $transaction: jest.fn((callback: any) => callback(tx)),
    stock_levels: tx.stock_levels,
  };

  const operatingScope = {
    enforceLocationAccess: jest
      .fn()
      .mockImplementation((_org: number, id: number) =>
        Promise.resolve({ id, store_id: id === 7 ? 3 : 4 }),
      ),
    assertCrossStoreTransferAllowed: jest.fn().mockResolvedValue(undefined),
  };
  const stockLevelManager = {
    updateStock: jest.fn().mockResolvedValue({
      cost_snapshot: { unit_cost: 700 },
    }),
  };
  const events = { emit: jest.fn() };

  const service = new OrgTransfersService(
    orgPrisma,
    operatingScope as any,
    stockLevelManager as any,
    events as any,
  );

  return {
    service,
    tx,
    orgPrisma,
    operatingScope,
    stockLevelManager,
    events,
    transfer,
    items,
    notes,
  };
}

describe('OrgTransfersService — P2 transporte, remisión y recepción', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(RequestContextService, 'getOrganizationId').mockReturnValue(1);
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(55);
  });

  describe('dispatch', () => {
    it('despacha con conteo parcial, lote elegido y remisión de salida', async () => {
      const h = buildHarness();
      h.tx.inventory_batches.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.id === 70
            ? {
                id: 70,
                batch_number: 'LOTE-70',
                product_id: 1,
                product_variant_id: null,
                location_id: 7,
              }
            : null,
        ),
      );

      const result = await h.service.dispatch(1, {
        items: [{ id: 21, quantity_dispatched: 4, batch_id: 70 }],
        transport_method: 'internal_shipping_method',
        shipping_method_id: 4,
        shipping_cost: 12000,
      });

      // Scoping por tenant en la lectura.
      expect(h.tx.stock_transfers.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1, organization_id: 1 } }),
      );

      const itemUpdates = h.tx.stock_transfer_items.update.mock.calls.map(
        (call: any) => call[0],
      );
      expect(itemUpdates).toEqual([
        expect.objectContaining({
          where: { id: 21 },
          data: expect.objectContaining({
            quantity_dispatched: 4,
            batch_id: 70,
          }),
        }),
        expect.objectContaining({
          where: { id: 22 },
          data: expect.objectContaining({
            quantity_dispatched: 2,
            batch_id: null,
          }),
        }),
      ]);

      const stockCalls = h.stockLevelManager.updateStock.mock.calls.map(
        (call: any) => call[0],
      );
      expect(stockCalls).toHaveLength(2);
      expect(stockCalls[0]).toEqual(
        expect.objectContaining({
          location_id: 7,
          quantity_change: -4,
          validate_availability: true,
        }),
      );

      expect(h.tx.dispatch_notes.create).toHaveBeenCalledTimes(1);
      const note = h.tx.dispatch_notes.create.mock.calls[0][0].data;
      expect(note.subtype).toBe('transfer_out');
      expect(note.dispatch_note_items.create).toEqual([
        expect.objectContaining({ dispatched_quantity: 4, lot_serial: 'LOTE-70' }),
        expect.objectContaining({ dispatched_quantity: 2, lot_serial: null }),
      ]);

      expect(
        h.tx.stock_transfers.update.mock.calls[0][0].data,
      ).toEqual(
        expect.objectContaining({
          status: 'in_transit',
          dispatch_note_id: 950,
          transport_method: 'internal_shipping_method',
          shipping_method_id: 4,
          shipping_cost: 12000,
        }),
      );
      expect(result.status).toBe('in_transit');
    });

    it('modo mass_only mueve a destino y cierra sin remisión', async () => {
      const h = buildHarness({
        transfer: { movement_mode: 'mass_only' },
      });

      const result = await h.service.dispatch(1, {});

      expect(h.tx.dispatch_notes.create).not.toHaveBeenCalled();
      const stockCalls = h.stockLevelManager.updateStock.mock.calls.map(
        (call: any) => call[0],
      );
      expect(stockCalls).toHaveLength(4);
      expect(stockCalls[2]).toEqual(
        expect.objectContaining({
          location_id: 9,
          quantity_change: 5,
          unit_cost: 700,
        }),
      );
      expect(result.status).toBe('received');
      expect(h.events.emit).toHaveBeenCalledWith(
        'stock_transfer.completed',
        expect.objectContaining({ transfer_id: 1 }),
      );
    });

    it('destino externo: solo salida, remisión con alerta y estado completed', async () => {
      const h = buildHarness({
        transfer: {
          is_external_destination: true,
          to_location_id: null,
          to_location: null,
          no_support_alert: true,
        },
      });

      const result = await h.service.dispatch(1, {});

      const stockCalls = h.stockLevelManager.updateStock.mock.calls.map(
        (call: any) => call[0],
      );
      expect(stockCalls).toHaveLength(2);
      expect(stockCalls.every((call: any) => call.location_id === 7)).toBe(
        true,
      );
      const note = h.tx.dispatch_notes.create.mock.calls[0][0].data;
      expect(note.to_location_id).toBeNull();
      expect(note.internal_notes).toContain(
        'Salida de inventario sin documento soporte ni motivo',
      );
      expect(result.status).toBe('completed');
    });

    it('es idempotente: no despacha dos veces la misma transferencia', async () => {
      const h = buildHarness({
        transfer: { dispatched_at: new Date() },
      });

      await expect(h.service.dispatch(1, {})).rejects.toThrow(
        /ya fue despachada/,
      );
      expect(h.stockLevelManager.updateStock).not.toHaveBeenCalled();
      expect(h.tx.dispatch_notes.create).not.toHaveBeenCalled();
    });
  });

  describe('receive', () => {
    it('una recepción parcial deja el saldo y crea la remisión de entrada', async () => {
      const h = buildHarness({
        transfer: { status: 'in_transit', dispatched_at: new Date() },
        items: [
          { id: 21, product_id: 1, quantity: 5, quantity_received: 0, quantity_dispatched: 5, quantity_lost: 0 },
        ],
      });

      const result = await h.service.receive(1, {
        items: [{ stock_transfer_item_id: 21, quantity_received: 2 }],
      } as any);

      const stockCalls = h.stockLevelManager.updateStock.mock.calls.map(
        (call: any) => call[0],
      );
      expect(stockCalls).toEqual([
        expect.objectContaining({
          location_id: 9,
          quantity_change: 2,
          unit_cost: 700,
        }),
      ]);
      expect(result.status).toBe('partially_received');
      expect(result.receipt_note_id).toBe(950);
      expect(h.tx.dispatch_notes.create.mock.calls[0][0].data.subtype).toBe(
        'transfer_in',
      );
    });

    it('al completar el saldo pasa a received y emite el evento contable', async () => {
      const h = buildHarness({
        transfer: {
          status: 'partially_received',
          dispatched_at: new Date(),
          receipt_note_id: 900,
        },
        items: [
          { id: 21, product_id: 1, quantity: 5, quantity_received: 4, quantity_dispatched: 5, quantity_lost: 0 },
        ],
      });
      h.tx.dispatch_notes.findFirst.mockImplementation((args: any) =>
        Promise.resolve(
          args?.include
            ? {
                id: 900,
                dispatch_note_items: [
                  {
                    id: 1,
                    product_id: 1,
                    product_variant_id: null,
                    dispatched_quantity: 4,
                    unit_price: 0,
                  },
                ],
              }
            : null,
        ),
      );
      h.tx.dispatch_note_items.findMany.mockResolvedValue([
        { dispatched_quantity: 4, unit_price: 0 },
      ]);

      const result = await h.service.receive(1, {
        items: [{ stock_transfer_item_id: 21, quantity_received: 1 }],
      } as any);

      expect(result.status).toBe('received');
      expect(h.tx.dispatch_note_items.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({ dispatched_quantity: 5 }),
        }),
      );
      expect(h.events.emit).toHaveBeenCalledWith(
        'stock_transfer.completed',
        expect.objectContaining({ transfer_id: 1, user_id: 55 }),
      );
    });

    it('no permite recibir una salida externa ni más de lo pendiente', async () => {
      const external = buildHarness({
        transfer: {
          dispatched_at: new Date(),
          is_external_destination: true,
          status: 'in_transit',
        },
      });
      await expect(
        external.service.receive(1, {
          items: [{ stock_transfer_item_id: 21, quantity_received: 1 }],
        } as any),
      ).rejects.toThrow(/no se recibe/);

      const h = buildHarness({
        transfer: { dispatched_at: new Date(), status: 'in_transit' },
        items: [
          { id: 21, product_id: 1, quantity: 5, quantity_received: 1, quantity_dispatched: 5, quantity_lost: 0 },
        ],
      });
      await expect(
        h.service.receive(1, {
          items: [{ stock_transfer_item_id: 21, quantity_received: 5 }],
        } as any),
      ).rejects.toThrow(/exceeds remaining 4/);
      expect(h.stockLevelManager.updateStock).not.toHaveBeenCalled();
    });
  });

  describe('closeWithLoss', () => {
    it('rechaza cerrar antes de la fecha límite', async () => {
      const h = buildHarness({
        transfer: {
          status: 'in_transit',
          dispatched_at: new Date(),
          expected_date: new Date(Date.now() + 2 * DAY),
        },
      });

      await expect(
        h.service.closeWithLoss(1, 'Se perdió'),
      ).rejects.toThrow(/no vence la fecha límite/);
      expect(h.stockLevelManager.updateStock).not.toHaveBeenCalled();
    });

    it('después de la fecha cierra con pérdida sin doble descuento', async () => {
      const h = buildHarness({
        transfer: { status: 'partially_received', dispatched_at: new Date() },
        items: [
          { id: 21, product_id: 1, quantity: 5, quantity_received: 2, quantity_dispatched: 5, quantity_lost: 0 },
        ],
      });

      const result = await h.service.closeWithLoss(1, 'Se perdió en ruta');

      expect(h.stockLevelManager.updateStock).not.toHaveBeenCalled();
      expect(
        h.tx.stock_transfer_items.update.mock.calls[0][0].data.quantity_lost,
      ).toBe(3);
      expect(result.status).toBe('closed_with_loss');
    });
  });

  describe('movimiento rápido', () => {
    it('rechaza el destino externo (D9)', async () => {
      const h = buildHarness();

      await expect(
        h.service.createAndComplete({
          from_location_id: 7,
          to_location_id: 9,
          is_external_destination: true,
          items: [{ product_id: 1, quantity: 1 }],
        } as any),
      ).rejects.toThrow(VendixHttpException);
      expect(h.tx.stock_transfers.create).not.toHaveBeenCalled();
    });
  });
});
