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
    // Candado de numeración de remisiones (`pg_advisory_xact_lock`).
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    stock_transfers: {
      findFirst: jest.fn().mockImplementation(() =>
        Promise.resolve({ ...transfer, stock_transfer_items: items }),
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockImplementation(({ data }: any) => {
        Object.assign(transfer, data);
        return Promise.resolve({ ...transfer, stock_transfer_items: items });
      }),
      create: jest.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 1, ...data }),
      ),
      count: jest.fn().mockResolvedValue(0),
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
    stock_transfers: tx.stock_transfers,
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
    releaseReservationsByReference: jest.fn().mockResolvedValue(undefined),
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

  describe('fixes de review P2', () => {
    it('una línea despachada en 0 queda con quantity_dispatched 0 (no se lee como completa)', async () => {
      const h = buildHarness();

      await h.service.dispatch(1, {
        items: [
          { id: 21, quantity_dispatched: 5 },
          { id: 22, quantity_dispatched: 0 },
        ],
      });

      const zeroUpdate = h.tx.stock_transfer_items.update.mock.calls
        .map((call: any) => call[0])
        .find((call: any) => call.where.id === 22);
      expect(zeroUpdate).toEqual({
        where: { id: 22 },
        data: { quantity_dispatched: 0 },
      });
      expect(h.stockLevelManager.updateStock).toHaveBeenCalledTimes(1);

      // Cancelar devuelve al origen solo la línea que salió.
      h.stockLevelManager.updateStock.mockClear();
      await h.service.cancel(1, {});
      expect(
        h.stockLevelManager.updateStock.mock.calls.map((call: any) => call[0]),
      ).toEqual([
        expect.objectContaining({ product_id: 1, quantity_change: 5 }),
      ]);
    });

    it('despachar sin transport_method no pisa el transporte guardado', async () => {
      const h = buildHarness({
        transfer: {
          transport_method: 'internal_carrier',
          driver_name: 'Ana Pérez',
          shipping_cost: 9000,
        },
      });

      await h.service.dispatch(1, {});

      const data = h.tx.stock_transfers.update.mock.calls[0][0].data;
      for (const key of [
        'transport_method',
        'vehicle_id',
        'driver_user_id',
        'driver_name',
        'shipping_method_id',
        'carrier_name',
        'tracking_number',
        'shipping_cost',
      ]) {
        expect(data).not.toHaveProperty(key);
      }
      expect(h.transfer.driver_name).toBe('Ana Pérez');
    });

    it('el reclamo del despacho condiciona por estado aprobado', async () => {
      const h = buildHarness();
      h.tx.stock_transfers.updateMany.mockResolvedValue({ count: 0 });

      await expect(h.service.dispatch(1, {})).rejects.toThrow(
        /ya fue despachada/,
      );
      expect(h.tx.stock_transfers.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 1,
            organization_id: 1,
            dispatched_at: null,
            status: { in: ['approved', 'draft'] },
          },
        }),
      );
      expect(h.stockLevelManager.updateStock).not.toHaveBeenCalled();
    });

    it('closeWithLoss toma el candado de fila antes de leer y respeta el estado releído', async () => {
      const h = buildHarness({
        transfer: { status: 'in_transit', dispatched_at: new Date() },
      });
      h.tx.stock_transfers.updateMany.mockImplementation(async () => {
        h.transfer.status = 'received';
        return { count: 1 };
      });

      await expect(
        h.service.closeWithLoss(1, 'Se perdió en ruta'),
      ).rejects.toThrow(/Solo una transferencia despachada/);
      expect(
        h.tx.stock_transfers.updateMany.mock.invocationCallOrder[0],
      ).toBeLessThan(h.tx.stock_transfers.findFirst.mock.invocationCallOrder[0]);
      expect(h.tx.stock_transfers.updateMany).toHaveBeenCalledWith({
        where: { id: 1, organization_id: 1 },
        data: { updated_at: expect.any(Date) },
      });
    });

    it('flujo histórico: recibir consume la reserva del aprobar de tienda antes de descontar', async () => {
      const h = buildHarness({
        transfer: { status: 'in_transit', dispatched_at: null, movement_mode: null },
      });

      await h.service.receive(1, {
        items: [{ stock_transfer_item_id: 21, quantity_received: 5 }],
      });

      expect(
        h.stockLevelManager.releaseReservationsByReference,
      ).toHaveBeenCalledWith('transfer', 1, 'consumed', h.tx, {
        decrementOnHand: false,
      });
      expect(
        h.stockLevelManager.releaseReservationsByReference.mock
          .invocationCallOrder[0],
      ).toBeLessThan(h.stockLevelManager.updateStock.mock.invocationCallOrder[0]);
    });

    it('flujo histórico: cerrar con pérdida consume la reserva antes de la merma', async () => {
      const h = buildHarness({
        transfer: { status: 'in_transit', dispatched_at: null, movement_mode: null },
      });

      await h.service.closeWithLoss(1, 'Producto vencido');

      expect(
        h.stockLevelManager.releaseReservationsByReference,
      ).toHaveBeenCalledWith('transfer', 1, 'consumed', h.tx, {
        decrementOnHand: false,
      });
      const damage = h.stockLevelManager.updateStock.mock.calls.map(
        (call: any) => call[0],
      );
      expect(damage).toEqual([
        expect.objectContaining({ quantity_change: -5, movement_type: 'damage' }),
        expect.objectContaining({ quantity_change: -2, movement_type: 'damage' }),
      ]);
    });

    it('flujo histórico: cancelar una aprobada desde tienda libera la reserva y no devuelve stock', async () => {
      const h = buildHarness({
        transfer: { status: 'in_transit', dispatched_at: null, movement_mode: null },
      });

      const result = await h.service.cancel(1, { reason: 'Ya no va' });

      expect(
        h.stockLevelManager.releaseReservationsByReference,
      ).toHaveBeenCalledWith('transfer', 1, 'cancelled', h.tx);
      expect(h.stockLevelManager.updateStock).not.toHaveBeenCalled();
      expect(result.status).toBe('cancelled');
    });

    it('N1: cancelar toma el candado condicionado por estado dentro de la transacción y antes de leer', async () => {
      const h = buildHarness({
        transfer: { status: 'in_transit', dispatched_at: new Date() },
        items: [
          { id: 21, product_id: 1, quantity: 5, quantity_received: 0, quantity_dispatched: 5, quantity_lost: 0 },
        ],
      });

      await h.service.cancel(1, {});

      expect(h.orgPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(h.tx.stock_transfers.updateMany).toHaveBeenCalledWith({
        where: {
          id: 1,
          organization_id: 1,
          status: {
            notIn: ['received', 'completed', 'closed_with_loss', 'cancelled'],
          },
        },
        data: { updated_at: expect.any(Date) },
      });
      expect(
        h.tx.stock_transfers.updateMany.mock.invocationCallOrder[0],
      ).toBeLessThan(h.tx.stock_transfers.findFirst.mock.invocationCallOrder[0]);
    });

    it('N1: si una recepción concurrente ya cerró la transferencia, cancelar se rechaza sin mover stock', async () => {
      const h = buildHarness({
        transfer: { status: 'in_transit', dispatched_at: new Date() },
        items: [
          { id: 21, product_id: 1, quantity: 5, quantity_received: 0, quantity_dispatched: 5, quantity_lost: 0 },
        ],
      });
      h.tx.stock_transfers.updateMany.mockImplementation(async () => {
        h.transfer.status = 'received';
        h.items[0].quantity_received = 5;
        return { count: 0 };
      });

      await expect(h.service.cancel(1, {})).rejects.toThrow(
        /Cannot cancel transfer in status 'received'/,
      );
      expect(h.stockLevelManager.updateStock).not.toHaveBeenCalled();
      expect(
        h.stockLevelManager.releaseReservationsByReference,
      ).not.toHaveBeenCalled();
      expect(h.tx.stock_transfers.update).not.toHaveBeenCalled();
    });

    it('N1: un despacho que hizo commit antes que la cancelación se devuelve al origen', async () => {
      // Al leer fuera del candado la fila se veía `approved` y se cancelaba
      // sin devolver lo que el despacho ya había descontado.
      const h = buildHarness();
      h.tx.stock_transfers.updateMany.mockImplementation(async () => {
        h.transfer.status = 'in_transit';
        h.transfer.dispatched_at = new Date();
        h.items[0].quantity_dispatched = 5;
        h.items[1].quantity_dispatched = 2;
        return { count: 1 };
      });

      const result = await h.service.cancel(1, {});

      expect(
        h.stockLevelManager.updateStock.mock.calls.map((call: any) => call[0]),
      ).toEqual([
        expect.objectContaining({ location_id: 7, quantity_change: 5 }),
        expect.objectContaining({ location_id: 7, quantity_change: 2 }),
      ]);
      expect(result.status).toBe('cancelled');
    });

    it('N2: con modo avanzado no se recibe ni se cierra con pérdida sin despacho', async () => {
      const receiving = buildHarness({
        transfer: { status: 'in_transit', dispatched_at: null },
      });
      await expect(
        receiving.service.receive(1, {
          items: [{ stock_transfer_item_id: 21, quantity_received: 5 }],
        } as any),
      ).rejects.toThrow(/Despacha la transferencia antes de recibirla/);
      expect(receiving.stockLevelManager.updateStock).not.toHaveBeenCalled();
      expect(
        receiving.stockLevelManager.releaseReservationsByReference,
      ).not.toHaveBeenCalled();

      const closing = buildHarness({
        transfer: {
          status: 'in_transit',
          dispatched_at: null,
          movement_mode: 'mass_only',
        },
      });
      await expect(
        closing.service.closeWithLoss(1, 'Se perdió en ruta'),
      ).rejects.toThrow(/Despacha la transferencia antes de cerrarla/);
      expect(closing.stockLevelManager.updateStock).not.toHaveBeenCalled();
      expect(closing.tx.stock_transfer_items.update).not.toHaveBeenCalled();
    });

    it('N3: la remisión de entrada queda en la tienda que recibe y la de salida en la que despacha', async () => {
      const h = buildHarness();
      await h.service.dispatch(1, {});
      await h.service.receive(1, {
        items: [{ stock_transfer_item_id: 21, quantity_received: 1 }],
      } as any);

      const created = h.tx.dispatch_notes.create.mock.calls.map(
        (call: any) => call[0].data,
      );
      expect(created.map((data: any) => [data.subtype, data.store_id])).toEqual([
        ['transfer_out', 3],
        ['transfer_in', 4],
      ]);
      expect(h.tx.$executeRawUnsafe.mock.calls.map((call: any) => call[1])).toEqual([
        'dispatch_notes:number:3',
        'dispatch_notes:number:4',
      ]);
    });

    it('rechaza un conductor de otra organización o que no sea personal al crear', async () => {
      const h = buildHarness();
      h.tx.users.findFirst.mockResolvedValue(null);

      await expect(
        h.service.create({
          from_location_id: 7,
          to_location_id: 9,
          movement_mode: 'with_dispatch_notes',
          transport_method: 'internal_carrier',
          driver_user_id: 80,
          items: [{ product_id: 1, quantity: 1 }],
        } as any),
      ).rejects.toThrow(/El transportador elegido ya no está disponible/);
      expect(h.tx.users.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          // M1 (review P3): misma organización y solo personal, sin
          // clientes del ecommerce.
          where: expect.objectContaining({
            id: 80,
            organization_id: 1,
            state: 'active',
            user_roles: {
              some: expect.objectContaining({
                roles: { name: { not: 'customer' } },
              }),
            },
          }),
        }),
      );
      expect(h.tx.stock_transfers.create).not.toHaveBeenCalled();
    });

    it('getStats cuenta closed_with_loss en su propia tarjeta', async () => {
      const h = buildHarness();
      h.tx.stock_transfers.count.mockImplementation(async (args: any) =>
        args?.where?.status === 'closed_with_loss' ? 2 : 0,
      );

      const stats = await h.service.getStats();

      expect(stats.closed_with_loss).toBe(2);
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

  describe('lecturas de apoyo (review P3: B1, M2, m8)', () => {
    it('getTransferBatches valida la bodega y acota los lotes a la organización', async () => {
      const h = buildHarness();

      await h.service.getTransferBatches(7, [1, 2]);

      expect(h.operatingScope.enforceLocationAccess).toHaveBeenCalledWith(
        1,
        7,
        { allowCentral: true },
      );
      expect(h.tx.inventory_batches.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            product_id: { in: [1, 2] },
            products: { stores: { organization_id: 1 } },
          }),
        }),
      );
    });

    it('getTransferBatches no consulta lotes si la bodega no es accesible', async () => {
      const h = buildHarness();
      h.operatingScope.enforceLocationAccess.mockRejectedValueOnce(
        new Error('sin acceso'),
      );

      await expect(h.service.getTransferBatches(70, [1])).rejects.toThrow(
        'sin acceso',
      );
      expect(h.tx.inventory_batches.findMany).not.toHaveBeenCalled();
    });

    it('lookupTransferCode valida las bodegas y acota la búsqueda a la organización', async () => {
      const h = buildHarness();
      h.tx.stock_levels.findMany = jest.fn().mockResolvedValue([]);

      await h.service.lookupTransferCode('7701234567890', 7, 9);

      expect(h.operatingScope.enforceLocationAccess).toHaveBeenCalledTimes(2);
      const where = h.tx.stock_levels.findMany.mock.calls[0][0].where;
      expect(where.location_id).toBe(7);
      expect(where.products.stores).toEqual({ organization_id: 1 });
    });
  });
});
