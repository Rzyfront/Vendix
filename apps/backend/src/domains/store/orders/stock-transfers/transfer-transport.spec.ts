/**
 * P2 · Transferencias multi-producto — despacho con lote, recepción parcial y
 * repetida, cierre con pérdida, destino externo (alerta), vehículo inline,
 * movimiento rápido contra destino externo y permiso de aprobación.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VendixHttpException } from '@common/errors';
import { Reflector } from '@nestjs/core';
import { RequestContextService } from '@common/context/request-context.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { StockTransfersController } from './stock-transfers.controller';
import { StockTransfersService } from './stock-transfers.service';

const DAY = 24 * 60 * 60 * 1000;

function buildHarness(overrides: {
  transfer?: Record<string, any>;
  items?: Array<Record<string, any>>;
} = {}) {
  const items =
    overrides.items ??
    [
      { id: 11, product_id: 1, product_variant_id: 10, quantity: 5, quantity_received: 0, quantity_dispatched: null, quantity_lost: 0, batch_id: null },
      { id: 12, product_id: 2, product_variant_id: null, quantity: 3, quantity_received: 0, quantity_dispatched: null, quantity_lost: 0, batch_id: null },
    ];

  const transfer: Record<string, any> = {
    id: 1,
    organization_id: 1,
    transfer_number: 'TRF-20261119-0001',
    status: 'in_transit',
    from_location_id: 7,
    to_location_id: 9,
    from_location: { id: 7, store_id: 3 },
    to_location: { id: 9, store_id: 3 },
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
      findUnique: jest.fn().mockImplementation(() =>
        Promise.resolve({
          ...transfer,
          stock_transfer_items: items,
        }),
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockImplementation(({ data }: any) => {
        Object.assign(transfer, data);
        return Promise.resolve({
          ...transfer,
          stock_transfer_items: items,
        });
      }),
      create: jest.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 1, ...data }),
      ),
      findFirst: jest.fn().mockResolvedValue(null),
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
        cost_per_unit: 500,
        products: { name: 'Camisa', cost_price: 400 },
        product_variants: null,
      }),
    },
    inventory_batches: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    vehicles: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 55 }),
    },
    users: {
      findFirst: jest.fn().mockResolvedValue({
        id: 8,
        first_name: 'Ana',
        last_name: 'Pérez',
      }),
    },
    shipping_methods: {
      findFirst: jest.fn().mockResolvedValue({
        id: 4,
        name: 'Transportadora',
        store_id: 3,
        is_active: true,
      }),
    },
    dispatch_notes: {
      findFirst: jest.fn().mockImplementation((args: any) => {
        if (args?.include) {
          const id = args.where?.id;
          return Promise.resolve(notes[id] ?? null);
        }
        return Promise.resolve(null);
      }),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }: any) => {
        const id = 900 + Object.keys(notes).length;
        notes[id] = {
          id,
          ...data,
          dispatch_note_items: (data.dispatch_note_items?.create ?? []).map(
            (item: any, index: number) => ({ id: index + 1, ...item }),
          ),
        };
        return Promise.resolve({
          id,
          dispatch_number: data.dispatch_number,
        });
      }),
      update: jest.fn().mockImplementation(({ where, data }: any) => {
        if (notes[where.id]) Object.assign(notes[where.id], data);
        return Promise.resolve(notes[where.id]);
      }),
    },
    workflow_definitions: {
      // `recordTriggerEvent` consulta workflows activos: sin ninguno, no emite.
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    dispatch_note_items: {
      update: jest.fn().mockImplementation(({ where, data }: any) => {
        const note = Object.values(notes).find((entry: any) =>
          entry.dispatch_note_items?.some((item: any) => item.id === where.id),
        );
        const item = note?.dispatch_note_items.find(
          (line: any) => line.id === where.id,
        );
        if (item) Object.assign(item, data);
        return Promise.resolve(item);
      }),
      create: jest.fn().mockImplementation(({ data }: any) => {
        const note = notes[data.dispatch_note_id];
        const created = {
          id: (note?.dispatch_note_items?.length ?? 0) + 1,
          ...data,
        };
        note?.dispatch_note_items.push(created);
        return Promise.resolve(created);
      }),
      findMany: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(notes[where.dispatch_note_id]?.dispatch_note_items ?? []),
      ),
    },
  };

  const prisma: any = {
    $transaction: jest.fn((callback: any) => callback(tx)),
    stock_levels: tx.stock_levels,
    stock_transfers: {
      findUnique: tx.stock_transfers.findUnique,
    },
  };

  const stockLevelManager = {
    updateStock: jest.fn().mockResolvedValue({
      cost_snapshot: { unit_cost: 500 },
    }),
    reserveStock: jest.fn().mockResolvedValue(undefined),
    releaseReservationsByReference: jest.fn().mockResolvedValue(undefined),
  };
  const events = { emit: jest.fn() };
  const operatingScope = {
    validateLocationScope: jest
      .fn()
      .mockImplementation(async (_org: number, ids: number[]) => ({
        scope: 'STORE',
        locations: ids.map((id) => ({
          id,
          organization_id: 1,
          store_id: 3,
        })),
      })),
  };

  const service = new StockTransfersService(
    prisma,
    stockLevelManager as any,
    events as any,
    operatingScope as any,
    { isKillSwitchOn: () => true } as any,
  );

  return { service, tx, prisma, stockLevelManager, events, operatingScope, transfer, items, notes };
}

describe('StockTransfersService — P2 transporte, remisión y recepción', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      organization_id: 1,
      store_id: 3,
      user_id: 55,
    } as any);
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(55);
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(3);
  });

  describe('dispatch', () => {
    it('despacha con el lote más antiguo por defecto y el lote elegido por fila', async () => {
      const h = buildHarness();
      h.tx.inventory_batches.findMany.mockResolvedValue([
        { id: 50, quantity: 5, quantity_used: 1 },
      ]);
      h.tx.inventory_batches.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.id === 77
            ? {
                id: 77,
                batch_number: 'LOTE-77',
                product_id: 1,
                product_variant_id: 10,
                location_id: 7,
              }
            : {
                id: 50,
                batch_number: 'LOTE-50',
                product_id: 2,
                product_variant_id: null,
                location_id: 7,
              },
        ),
      );

      const result = await h.service.dispatch(1, {
        items: [
          { id: 11, quantity_dispatched: 2, batch_id: 77 },
          { id: 12, quantity_dispatched: 3 },
        ],
        transport_method: 'internal_vehicle',
        vehicle: { plate: 'abc-123' },
        shipping_cost: 25000,
      });

      const itemUpdates = h.tx.stock_transfer_items.update.mock.calls.map(
        (call: any) => call[0],
      );
      expect(itemUpdates).toEqual([
        expect.objectContaining({
          where: { id: 11 },
          data: expect.objectContaining({
            quantity_dispatched: 2,
            batch_id: 77,
          }),
        }),
        expect.objectContaining({
          where: { id: 12 },
          data: expect.objectContaining({
            quantity_dispatched: 3,
            batch_id: 50,
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
          quantity_change: -2,
          validate_availability: true,
        }),
      );
      expect(stockCalls[1]).toEqual(
        expect.objectContaining({ location_id: 7, quantity_change: -3 }),
      );

      // Remisión de salida en la misma transacción, con el conteo de salida.
      expect(h.tx.dispatch_notes.create).toHaveBeenCalledTimes(1);
      const noteData = h.tx.dispatch_notes.create.mock.calls[0][0].data;
      expect(noteData.subtype).toBe('transfer_out');
      expect(noteData.direction).toBe('outbound');
      expect(noteData.dispatch_note_items.create).toEqual([
        expect.objectContaining({
          product_id: 1,
          dispatched_quantity: 2,
          lot_serial: 'LOTE-77',
        }),
        expect.objectContaining({
          product_id: 2,
          dispatched_quantity: 3,
          lot_serial: 'LOTE-50',
        }),
      ]);

      const transferUpdate = h.tx.stock_transfers.update.mock.calls[0][0].data;
      expect(transferUpdate).toEqual(
        expect.objectContaining({
          status: 'in_transit',
          dispatch_note_id: 900,
          transport_method: 'internal_vehicle',
          vehicle_id: 55,
          shipping_cost: 25000,
        }),
      );
      // Vehículo inline creado con la placa normalizada.
      expect(h.tx.vehicles.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ store_id: 3, plate: 'ABC-123' }),
        }),
      );
      expect(result.status).toBe('in_transit');
    });

    it('reutiliza el vehículo cuando la placa ya existe', async () => {
      const h = buildHarness();
      h.tx.vehicles.findUnique.mockResolvedValue({ id: 91 });

      await h.service.dispatch(1, {
        transport_method: 'internal_vehicle',
        vehicle: { plate: 'XYZ-999' },
      });

      expect(h.tx.vehicles.create).not.toHaveBeenCalled();
      expect(
        h.tx.stock_transfers.update.mock.calls[0][0].data.vehicle_id,
      ).toBe(91);
    });

    it('es idempotente: una transferencia ya despachada no se despacha dos veces', async () => {
      const h = buildHarness({
        transfer: { dispatched_at: new Date() },
      });

      await expect(h.service.dispatch(1, {})).rejects.toThrow(
        /ya fue despachada/,
      );
      expect(h.stockLevelManager.updateStock).not.toHaveBeenCalled();
      expect(h.tx.dispatch_notes.create).not.toHaveBeenCalled();
    });

    it('modo mass_only aplica el movimiento completo sin remisiones', async () => {
      const h = buildHarness({
        transfer: { movement_mode: 'mass_only' },
      });

      const result = await h.service.dispatch(1, {});

      expect(h.tx.dispatch_notes.create).not.toHaveBeenCalled();
      const stockCalls = h.stockLevelManager.updateStock.mock.calls.map(
        (call: any) => call[0],
      );
      expect(stockCalls).toHaveLength(4); // primero las 2 salidas, luego las 2 entradas
      expect(stockCalls[0]).toEqual(
        expect.objectContaining({ location_id: 7, quantity_change: -5 }),
      );
      expect(stockCalls[1]).toEqual(
        expect.objectContaining({ location_id: 7, quantity_change: -3 }),
      );
      expect(stockCalls[2]).toEqual(
        expect.objectContaining({
          location_id: 9,
          quantity_change: 5,
          unit_cost: 500,
        }),
      );
      expect(stockCalls[3]).toEqual(
        expect.objectContaining({ location_id: 9, quantity_change: 3 }),
      );
      expect(result.status).toBe('received');
      expect(h.events.emit).toHaveBeenCalledWith(
        'stock_transfer.completed',
        expect.objectContaining({ transfer_id: 1 }),
      );
    });
  });

  describe('receive', () => {
    it('una recepción parcial suma solo lo recibido y deja el saldo pendiente', async () => {
      const h = buildHarness({
        transfer: {
          dispatched_at: new Date(),
        },
        items: [
          { id: 11, product_id: 1, product_variant_id: 10, quantity: 5, quantity_received: 0, quantity_dispatched: 5, quantity_lost: 0 },
        ],
      });

      const result = await h.service.receive(1, [
        { id: 11, quantity_received: 2 },
      ]);

      const stockCalls = h.stockLevelManager.updateStock.mock.calls.map(
        (call: any) => call[0],
      );
      // Solo destino: el origen ya se descontó al despachar.
      expect(stockCalls).toEqual([
        expect.objectContaining({
          location_id: 9,
          quantity_change: 2,
          unit_cost: 500,
        }),
      ]);
      expect(
        h.tx.stock_transfer_items.update.mock.calls[0][0].data
          .quantity_received,
      ).toBe(2);
      expect(result.status).toBe('partially_received');
      expect(result.receipt_note_id).toBe(900);
      expect(h.tx.dispatch_notes.create).toHaveBeenCalledTimes(1);
    });

    it('una segunda recepción completa el saldo sin duplicar stock', async () => {
      const h = buildHarness({
        transfer: {
          dispatched_at: new Date(),
          status: 'partially_received',
          receipt_note_id: 900,
        },
        items: [
          { id: 11, product_id: 1, product_variant_id: 10, quantity: 5, quantity_received: 2, quantity_dispatched: 5, quantity_lost: 0 },
        ],
      });
      // La remisión de entrada existente, con lo recibido en la primera vuelta.
      h.tx.dispatch_notes.findFirst.mockImplementation((args: any) => {
        if (args?.include) {
          return Promise.resolve({
            id: 900,
            dispatch_note_items: [
              {
                id: 1,
                product_id: 1,
                product_variant_id: 10,
                dispatched_quantity: 2,
                unit_price: 0,
              },
            ],
          });
        }
        return Promise.resolve(null);
      });
      h.tx.dispatch_note_items.findMany.mockResolvedValue([
        { dispatched_quantity: 2, unit_price: 0 },
      ]);

      const result = await h.service.receive(1, [
        { id: 11, quantity_received: 3 },
      ]);

      const stockCalls = h.stockLevelManager.updateStock.mock.calls.map(
        (call: any) => call[0],
      );
      expect(stockCalls).toEqual([
        expect.objectContaining({ location_id: 9, quantity_change: 3 }),
      ]);
      expect(result.status).toBe('received');
      // La misma remisión de entrada se acumula, no se crea otra.
      expect(h.tx.dispatch_notes.create).not.toHaveBeenCalled();
      expect(h.tx.dispatch_note_items.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({ dispatched_quantity: 5 }),
        }),
      );
    });

    it('no recibe más de lo pendiente ni vuelve a recibir una cerrada', async () => {
      const h = buildHarness({
        transfer: { dispatched_at: new Date(), status: 'partially_received' },
        items: [
          { id: 11, product_id: 1, quantity: 5, quantity_received: 4, quantity_dispatched: 5, quantity_lost: 0 },
        ],
      });

      await expect(
        h.service.receive(1, [{ id: 11, quantity_received: 2 }]),
      ).rejects.toThrow(/saldo pendiente es 1/);
      expect(h.stockLevelManager.updateStock).not.toHaveBeenCalled();

      h.transfer.status = 'received';
      await expect(
        h.service.receive(1, [{ id: 11, quantity_received: 1 }]),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('closeWithLoss', () => {
    it('rechaza cerrar antes de la fecha límite de entrega', async () => {
      const h = buildHarness({
        transfer: {
          dispatched_at: new Date(),
          expected_date: new Date(Date.now() + 3 * DAY),
        },
      });

      await expect(
        h.service.closeWithLoss(1, 'Se perdió en ruta'),
      ).rejects.toThrow(/no vence la fecha límite/);
      expect(h.stockLevelManager.updateStock).not.toHaveBeenCalled();
    });

    it('después de la fecha registra la merma sin descontar dos veces el origen', async () => {
      const h = buildHarness({
        transfer: {
          dispatched_at: new Date(),
          status: 'partially_received',
        },
        items: [
          { id: 11, product_id: 1, quantity: 5, quantity_received: 2, quantity_dispatched: 5, quantity_lost: 0 },
        ],
      });

      const result = await h.service.closeWithLoss(1, 'Se perdió en ruta');

      expect(h.stockLevelManager.updateStock).not.toHaveBeenCalled();
      expect(
        h.tx.stock_transfer_items.update.mock.calls[0][0].data.quantity_lost,
      ).toBe(3);
      expect(result.status).toBe('closed_with_loss');
      expect(result.loss_reason).toBe('Se perdió en ruta');
    });

    it('si nunca se despachó, sí genera el movimiento de merma en el origen', async () => {
      const h = buildHarness({
        transfer: { dispatched_at: null },
        items: [
          { id: 11, product_id: 1, quantity: 5, quantity_received: 0, quantity_dispatched: null, quantity_lost: 0 },
        ],
      });

      await h.service.closeWithLoss(1, 'Producto vencido');

      const stockCalls = h.stockLevelManager.updateStock.mock.calls.map(
        (call: any) => call[0],
      );
      expect(stockCalls).toEqual([
        expect.objectContaining({
          location_id: 7,
          quantity_change: -5,
          movement_type: 'damage',
        }),
      ]);
    });
  });

  describe('destino externo y alerta D8', () => {
    it('crea la salida externa con alerta cuando no hay documento ni motivo', async () => {
      const h = buildHarness();

      const created = await h.service.create({
        from_location_id: 7,
        is_external_destination: true,
        external_destination_name: 'Cliente externo',
        movement_mode: 'with_dispatch_notes',
        items: [{ product_id: 1, quantity: 2 }],
      } as any);

      const data = h.tx.stock_transfers.create.mock.calls[0][0].data;
      expect(data.to_location_id).toBeNull();
      expect(data.no_support_alert).toBe(true);
      expect(data.external_destination_name).toBe('Cliente externo');
      expect(created.id).toBe(1);
    });

    it('no alerta cuando hay documento soporte', async () => {
      const h = buildHarness();

      await h.service.create({
        from_location_id: 7,
        is_external_destination: true,
        external_destination_name: 'Cliente externo',
        movement_mode: 'with_dispatch_notes',
        support_document_type: 'invoice',
        support_document_id: 'FV-1',
        items: [{ product_id: 1, quantity: 2 }],
      } as any);

      expect(
        h.tx.stock_transfers.create.mock.calls[0][0].data.no_support_alert,
      ).toBe(false);
    });

    it('el despacho externo solo registra salida y cierra como completada', async () => {
      const h = buildHarness({
        transfer: {
          is_external_destination: true,
          to_location: null,
          to_location_id: null,
          status: 'in_transit',
          no_support_alert: true,
        },
        items: [
          { id: 11, product_id: 1, quantity: 4, quantity_received: 0, quantity_dispatched: null, quantity_lost: 0 },
        ],
      });

      const result = await h.service.dispatch(1, {});

      const stockCalls = h.stockLevelManager.updateStock.mock.calls.map(
        (call: any) => call[0],
      );
      expect(stockCalls).toHaveLength(1);
      expect(stockCalls[0].quantity_change).toBe(-4);
      expect(result.status).toBe('completed');
      const noteData = h.tx.dispatch_notes.create.mock.calls[0][0].data;
      expect(noteData.customer_name).toBeNull();
      expect(noteData.to_location_id).toBeNull();
      expect(noteData.internal_notes).toBe(
        'Salida de inventario sin documento soporte ni motivo: revisar antes de entregar.',
      );
    });

    it('el movimiento rápido rechaza el destino externo (D9)', async () => {
      const h = buildHarness();

      await expect(
        h.service.createAndComplete({
          from_location_id: 7,
          to_location_id: 9,
          is_external_destination: true,
          items: [{ product_id: 1, quantity: 1 }],
        } as any),
      ).rejects.toThrow(/solo mueve inventario entre tus propias bodegas/);
      expect(h.tx.stock_transfers.create).not.toHaveBeenCalled();
    });
  });

  describe('aprobación', () => {
    it('el endpoint de aprobar exige el permiso dedicado (y acepta el histórico)', () => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        StockTransfersController.prototype.approve,
      );
      expect(permissions).toEqual([
        'store:stock-transfers:approve',
        'store:stock-transfers:update',
      ]);
    });

    it('un usuario sin el permiso recibe 403 del guard', () => {
      const reflector = {
        getAllAndOverride: () => ['store:stock-transfers:approve'],
      } as unknown as Reflector;
      const guard = new PermissionsGuard(reflector);
      const context: any = {
        getHandler: () => StockTransfersController.prototype.approve,
        getClass: () => StockTransfersController,
        switchToHttp: () => ({
          getRequest: () => ({
            user: {
              roles: [],
              permissions: [
                {
                  name: 'store:stock-transfers:read',
                  path: '/api/store/stock-transfers',
                  method: 'GET',
                  status: 'active',
                },
              ],
            },
            method: 'PATCH',
            route: { path: '/api/store/stock-transfers/:id/approve' },
            url: '/api/store/stock-transfers/1/approve',
          }),
        }),
      };

      let thrown: unknown;
      try {
        guard.canActivate(context);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(VendixHttpException);
      expect((thrown as VendixHttpException).getStatus()).toBe(403);
    });

    it('con el permiso de aprobar, el guard deja pasar', () => {
      const reflector = {
        getAllAndOverride: () => ['store:stock-transfers:approve'],
      } as unknown as Reflector;
      const guard = new PermissionsGuard(reflector);
      const context: any = {
        getHandler: () => StockTransfersController.prototype.approve,
        getClass: () => StockTransfersController,
        switchToHttp: () => ({
          getRequest: () => ({
            user: {
              roles: [],
              permissions: [
                {
                  name: 'store:stock-transfers:approve',
                  path: '/policy/stock-transfers/approve',
                  method: 'PATCH',
                  status: 'active',
                },
              ],
            },
            method: 'PATCH',
            route: { path: '/api/store/stock-transfers/:id/approve' },
            url: '/api/store/stock-transfers/1/approve',
          }),
        }),
      };

      expect(guard.canActivate(context)).toBe(true);
    });
  });

  it('devuelve 404 cuando la transferencia no existe', async () => {
    const h = buildHarness();
    h.tx.stock_transfers.findUnique.mockResolvedValue(null);

    await expect(h.service.dispatch(999, {})).rejects.toThrow(
      NotFoundException,
    );
  });
});
