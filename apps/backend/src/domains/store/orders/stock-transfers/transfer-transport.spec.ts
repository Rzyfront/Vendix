/**
 * P2 · Transferencias multi-producto — despacho con lote, recepción parcial y
 * repetida, cierre con pérdida, destino externo (alerta), vehículo inline,
 * movimiento rápido contra destino externo y permiso de aprobación.
 */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VendixHttpException } from '@common/errors';
import { Reflector } from '@nestjs/core';
import { RequestContextService } from '@common/context/request-context.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { StockTransfersController } from './stock-transfers.controller';
import { StockTransfersService } from './stock-transfers.service';
import { UpdateTransferDto } from './dto/update-transfer.dto';
import {
  accumulateTransferReceiptNoteInTx,
  createTransferNoteInTx,
  resolveTransferTransport,
} from './transfer-transport';

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
    // Candado de numeración de remisiones (`pg_advisory_xact_lock`).
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
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
      update: tx.stock_transfers.update,
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

    it('si nunca se despachó (fila sin modo), sí genera el movimiento de merma en el origen', async () => {
      const h = buildHarness({
        transfer: { dispatched_at: null, movement_mode: null },
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

  describe('fixes de review P2', () => {
    it('una línea despachada en 0 queda con quantity_dispatched 0 y no se recibe, devuelve ni pierde', async () => {
      const h = buildHarness({ transfer: { status: 'approved' } });

      await h.service.dispatch(1, {
        items: [
          { id: 11, quantity_dispatched: 5 },
          { id: 12, quantity_dispatched: 0 },
        ],
      });

      const zeroUpdate = h.tx.stock_transfer_items.update.mock.calls
        .map((call: any) => call[0])
        .find((call: any) => call.where.id === 12);
      expect(zeroUpdate).toEqual({
        where: { id: 12 },
        data: { quantity_dispatched: 0 },
      });
      // Solo sale del origen la línea con unidades.
      expect(h.stockLevelManager.updateStock).toHaveBeenCalledTimes(1);
      expect(h.items[1].quantity_dispatched).toBe(0);

      // Recibir esa línea: el saldo pendiente es 0.
      h.stockLevelManager.updateStock.mockClear();
      await expect(
        h.service.receive(1, [{ id: 12, quantity_received: 1 }]),
      ).rejects.toThrow(/saldo pendiente es 0/);

      // Cancelar devuelve al origen solo lo que salió (línea 11), no la 12.
      h.stockLevelManager.updateStock.mockClear();
      h.transfer.status = 'in_transit';
      await h.service.cancel(1);
      const returns = h.stockLevelManager.updateStock.mock.calls.map(
        (call: any) => call[0],
      );
      expect(returns).toEqual([
        expect.objectContaining({ product_id: 1, quantity_change: 5 }),
      ]);
    });

    it('el cierre con pérdida no da de baja una línea despachada en 0', async () => {
      const h = buildHarness({
        transfer: { dispatched_at: new Date(), status: 'in_transit' },
        items: [
          { id: 11, product_id: 1, quantity: 5, quantity_received: 0, quantity_dispatched: 5, quantity_lost: 0 },
          { id: 12, product_id: 2, quantity: 3, quantity_received: 0, quantity_dispatched: 0, quantity_lost: 0 },
        ],
      });

      await h.service.closeWithLoss(1, 'Se perdió en ruta');

      const lossUpdates = h.tx.stock_transfer_items.update.mock.calls.map(
        (call: any) => call[0],
      );
      expect(lossUpdates).toEqual([
        { where: { id: 11 }, data: { quantity_lost: 5 } },
      ]);
    });

    it('despachar sin transport_method no pisa el transporte guardado al crear', async () => {
      const h = buildHarness({
        transfer: {
          status: 'approved',
          transport_method: 'internal_vehicle',
          vehicle_id: 91,
          driver_name: 'Ana Pérez',
          shipping_cost: 25000,
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
      expect(h.transfer.vehicle_id).toBe(91);
      expect(h.transfer.shipping_cost).toBe(25000);
      expect(h.tx.vehicles.findFirst).not.toHaveBeenCalled();
    });

    it('el reclamo del despacho exige estado aprobado o en tránsito', async () => {
      const h = buildHarness({ transfer: { status: 'approved' } });
      h.tx.stock_transfers.updateMany.mockResolvedValue({ count: 0 });

      await expect(h.service.dispatch(1, {})).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(h.tx.stock_transfers.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 1,
            dispatched_at: null,
            status: { in: ['approved', 'in_transit'] },
          },
        }),
      );
      expect(h.stockLevelManager.updateStock).not.toHaveBeenCalled();
    });

    it('closeWithLoss toma el candado de fila antes de leer y respeta el estado releído', async () => {
      const h = buildHarness({
        transfer: { dispatched_at: new Date(), status: 'in_transit' },
        items: [
          { id: 11, product_id: 1, quantity: 5, quantity_received: 0, quantity_dispatched: 5, quantity_lost: 0 },
        ],
      });
      // Una recepción concurrente terminó primero: al releer, ya está recibida.
      h.tx.stock_transfers.updateMany.mockImplementation(async () => {
        h.transfer.status = 'received';
        return { count: 1 };
      });

      await expect(
        h.service.closeWithLoss(1, 'Se perdió en ruta'),
      ).rejects.toThrow(/Solo una transferencia despachada/);

      const lockOrder =
        h.tx.stock_transfers.updateMany.mock.invocationCallOrder[0];
      const readOrder =
        h.tx.stock_transfers.findUnique.mock.invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(readOrder);
      expect(h.tx.stock_transfers.updateMany).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { updated_at: expect.any(Date) },
      });
      expect(h.tx.stock_transfer_items.update).not.toHaveBeenCalled();
    });

    it('closeWithLoss rechaza estados que no tienen saldo en camino', async () => {
      for (const status of ['pending', 'approved', 'received', 'cancelled', 'closed_with_loss']) {
        const h = buildHarness({ transfer: { status } });
        await expect(
          h.service.closeWithLoss(1, 'Se perdió en ruta'),
        ).rejects.toThrow(BadRequestException);
        expect(h.tx.stock_transfer_items.update).not.toHaveBeenCalled();
      }
    });

    it('update() ignora los campos avanzados aunque lleguen en el payload', async () => {
      const h = buildHarness({ transfer: { status: 'pending' } });

      await h.service.update(1, {
        notes: 'Cambio de nota',
        movement_mode: 'mass_only',
        is_external_destination: true,
        external_destination_name: 'Otro',
        vehicle_id: 999,
        vehicle: { plate: 'ZZZ-000' },
        transport_method: 'internal_vehicle',
        shipping_cost: 1,
        support_document_type: 'invoice',
        items: [{ product_id: 1, quantity: 99 }],
      } as any);

      expect(h.tx.stock_transfers.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: { notes: 'Cambio de nota' },
        }),
      );
      expect(h.tx.vehicles.create).not.toHaveBeenCalled();
    });

    it('el DTO de update rechaza los campos avanzados (forbidNonWhitelisted)', async () => {
      const dto = plainToInstance(UpdateTransferDto, {
        notes: 'ok',
        movement_mode: 'mass_only',
        is_external_destination: true,
        vehicle: { plate: 'ZZZ-000' },
        transport_method: 'internal_vehicle',
      });
      const errors = await validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(errors.map((error) => error.property).sort()).toEqual([
        'is_external_destination',
        'movement_mode',
        'transport_method',
        'vehicle',
      ]);

      const allowed = plainToInstance(UpdateTransferDto, {
        notes: 'ok',
        expected_date: '2026-12-20',
      });
      expect(
        await validate(allowed, { whitelist: true, forbidNonWhitelisted: true }),
      ).toEqual([]);
    });

    it('getStats cuenta closed_with_loss en su propia tarjeta', async () => {
      const h = buildHarness();
      h.prisma.stock_transfers.count = jest.fn(async (args: any) =>
        args?.where?.status === 'closed_with_loss' ? 2 : 0,
      );

      const stats = await h.service.getStats();

      expect(stats.data.closed_with_loss).toBe(2);
    });

    it('update() no deja una transferencia interna sin destino ni sin origen', async () => {
      const h = buildHarness({ transfer: { status: 'pending' } });

      await expect(
        h.service.update(1, { to_location_id: null } as any),
      ).rejects.toThrow(/Elige la bodega de destino/);
      await expect(
        h.service.update(1, { from_location_id: null } as any),
      ).rejects.toThrow(/Elige la bodega de origen/);
      expect(h.tx.stock_transfers.update).not.toHaveBeenCalled();
    });

    it('update() no le asigna bodega de destino a una salida externa', async () => {
      const h = buildHarness({
        transfer: {
          status: 'pending',
          is_external_destination: true,
          to_location_id: null,
        },
      });

      await expect(
        h.service.update(1, { to_location_id: 9 } as any),
      ).rejects.toThrow(/destino externo no tiene bodega/);
      expect(h.tx.stock_transfers.update).not.toHaveBeenCalled();
    });
  });

  describe('scopes de transporte por organización', () => {
    // Datos de dos organizaciones: el tx simula el filtro que hace Postgres.
    function scopedTx() {
      const users = [
        { id: 8, organization_id: 1, first_name: 'Ana', last_name: 'Pérez' },
        { id: 80, organization_id: 2, first_name: 'Intruso', last_name: 'X' },
      ];
      const stores = [
        { id: 3, organization_id: 1 },
        { id: 30, organization_id: 2 },
      ];
      const vehicles = [
        { id: 55, store_id: 3 },
        { id: 550, store_id: 30 },
      ];
      const methods = [
        { id: 4, name: 'Propia', store_id: 3, is_active: true },
        { id: 40, name: 'Ajena', store_id: 30, is_active: true },
        { id: 5, name: 'Sistema', store_id: null, is_active: true },
      ];
      const orgOfStore = (storeId: number | null) =>
        stores.find((store) => store.id === storeId)?.organization_id;
      return {
        users: {
          findFirst: jest.fn(async ({ where }: any) =>
            users.find(
              (user) =>
                user.id === where.id &&
                (where.organization_id === undefined ||
                  user.organization_id === where.organization_id),
            ) ?? null,
          ),
        },
        vehicles: {
          findFirst: jest.fn(async ({ where }: any) =>
            vehicles.find(
              (vehicle) =>
                vehicle.id === where.id &&
                (where.store?.organization_id === undefined ||
                  orgOfStore(vehicle.store_id) ===
                    where.store.organization_id),
            ) ?? null,
          ),
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 56 }),
        },
        shipping_methods: {
          findFirst: jest.fn(async ({ where }: any) => {
            const orgId = where.OR?.[1]?.store?.organization_id;
            return (
              methods.find(
                (method) =>
                  method.id === where.id &&
                  (orgId === undefined ||
                    method.store_id === null ||
                    orgOfStore(method.store_id) === orgId),
              ) ?? null
            );
          }),
        },
      };
    }

    // Origen en bodega central: no hay tienda contra la cual comparar.
    const central = { organization_id: 1, store_id: null };

    it('rechaza un conductor de otra organización (no copia su nombre)', async () => {
      const tx = scopedTx();
      await expect(
        resolveTransferTransport(
          tx,
          { transport_method: 'internal_carrier', driver_user_id: 80 },
          central,
        ),
      ).rejects.toThrow(/El transportador elegido ya no está disponible/);

      const ok = await resolveTransferTransport(
        tx,
        { transport_method: 'internal_carrier', driver_user_id: 8 },
        central,
      );
      expect(ok.driver_name).toBe('Ana Pérez');
    });

    it('rechaza el conductor de otra organización también con vehículo propio', async () => {
      const tx = scopedTx();
      await expect(
        resolveTransferTransport(
          tx,
          {
            transport_method: 'internal_vehicle',
            vehicle_id: 55,
            driver_user_id: 80,
          },
          { organization_id: 1, store_id: 3 },
        ),
      ).rejects.toThrow(/El transportador elegido ya no está disponible/);
    });

    it('rechaza un vehículo de otra organización aunque el origen sea bodega central', async () => {
      const tx = scopedTx();
      await expect(
        resolveTransferTransport(
          tx,
          { transport_method: 'internal_vehicle', vehicle_id: 550 },
          central,
        ),
      ).rejects.toThrow(/El vehículo #550 no existe/);

      const ok = await resolveTransferTransport(
        tx,
        { transport_method: 'internal_vehicle', vehicle_id: 55 },
        central,
      );
      expect(ok.vehicle_id).toBe(55);
    });

    it('rechaza el conductor principal de otra organización en un vehículo inline', async () => {
      const tx = scopedTx();
      await expect(
        resolveTransferTransport(
          tx,
          {
            transport_method: 'internal_vehicle',
            vehicle: { plate: 'NEW-001', primary_driver_id: 80 },
          },
          { organization_id: 1, store_id: 3 },
        ),
      ).rejects.toThrow(/El transportador elegido ya no está disponible/);
      expect(tx.vehicles.create).not.toHaveBeenCalled();
    });

    it('rechaza un método de envío de otra organización y acepta los de sistema', async () => {
      const tx = scopedTx();
      await expect(
        resolveTransferTransport(
          tx,
          { transport_method: 'external_shipping_method', shipping_method_id: 40 },
          central,
        ),
      ).rejects.toThrow(/El método de envío #40 no existe/);

      const system = await resolveTransferTransport(
        tx,
        { transport_method: 'external_shipping_method', shipping_method_id: 5 },
        central,
      );
      expect(system.shipping_method_id).toBe(5);
    });
  });

  describe('fixes de re-review P2', () => {
    const TERMINAL = ['completed', 'received', 'closed_with_loss', 'cancelled'];
    const dispatchedItems = () => [
      { id: 11, product_id: 1, product_variant_id: 10, quantity: 5, quantity_received: 0, quantity_dispatched: 5, quantity_lost: 0 },
    ];

    it('N1: cancelar toma el candado condicionado por estado antes de leer', async () => {
      const h = buildHarness({
        transfer: { dispatched_at: new Date(), status: 'in_transit' },
        items: dispatchedItems(),
      });

      await h.service.cancel(1);

      expect(h.tx.stock_transfers.updateMany).toHaveBeenCalledWith({
        where: { id: 1, status: { notIn: TERMINAL } },
        data: { updated_at: expect.any(Date) },
      });
      expect(
        h.tx.stock_transfers.updateMany.mock.invocationCallOrder[0],
      ).toBeLessThan(h.tx.stock_transfers.findUnique.mock.invocationCallOrder[0]);
    });

    it('N1: si una recepción concurrente ya cerró la transferencia, cancelar se rechaza sin mover stock', async () => {
      const h = buildHarness({
        transfer: { dispatched_at: new Date(), status: 'in_transit' },
        items: dispatchedItems(),
      });
      // La recepción hizo commit primero: el candado ya no encuentra un estado
      // cancelable y la relectura ve `received`.
      h.tx.stock_transfers.updateMany.mockImplementation(async () => {
        h.transfer.status = 'received';
        h.items[0].quantity_received = 5;
        return { count: 0 };
      });

      await expect(h.service.cancel(1)).rejects.toThrow(BadRequestException);
      expect(h.stockLevelManager.updateStock).not.toHaveBeenCalled();
      expect(
        h.stockLevelManager.releaseReservationsByReference,
      ).not.toHaveBeenCalled();
      expect(h.tx.stock_transfers.update).not.toHaveBeenCalled();
    });

    it('N1: con el candado sin efecto y estado aún cancelable, responde conflicto sin mover stock', async () => {
      const h = buildHarness({
        transfer: { dispatched_at: new Date(), status: 'in_transit' },
        items: dispatchedItems(),
      });
      h.tx.stock_transfers.updateMany.mockResolvedValue({ count: 0 });

      await expect(h.service.cancel(1)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(h.stockLevelManager.updateStock).not.toHaveBeenCalled();
      expect(h.tx.stock_transfers.update).not.toHaveBeenCalled();
    });

    it('N1: cancelar devuelve al origen solo el saldo releído después del candado', async () => {
      const h = buildHarness({
        transfer: { dispatched_at: new Date(), status: 'in_transit' },
        items: dispatchedItems(),
      });
      // Una recepción parcial de 3 hizo commit mientras se esperaba el candado.
      h.tx.stock_transfers.updateMany.mockImplementation(async () => {
        h.transfer.status = 'partially_received';
        h.items[0].quantity_received = 3;
        return { count: 1 };
      });

      const result = await h.service.cancel(1);

      expect(
        h.stockLevelManager.updateStock.mock.calls.map((call: any) => call[0]),
      ).toEqual([
        expect.objectContaining({ location_id: 7, quantity_change: 2 }),
      ]);
      expect(result.status).toBe('cancelled');
    });

    it('N2: una transferencia con modo avanzado no se recibe sin despacho', async () => {
      for (const movement_mode of ['with_dispatch_notes', 'mass_only']) {
        const h = buildHarness({
          transfer: { status: 'in_transit', dispatched_at: null, movement_mode },
        });

        await expect(
          h.service.receive(1, [{ id: 11, quantity_received: 5 }]),
        ).rejects.toThrow(/Despacha la transferencia antes de recibirla/);
        expect(h.stockLevelManager.updateStock).not.toHaveBeenCalled();
        expect(
          h.stockLevelManager.releaseReservationsByReference,
        ).not.toHaveBeenCalled();
        expect(h.tx.dispatch_notes.create).not.toHaveBeenCalled();
      }
    });

    it('N2: una transferencia con modo avanzado no se cierra con pérdida sin despacho', async () => {
      const h = buildHarness({
        transfer: { status: 'in_transit', dispatched_at: null },
      });

      await expect(
        h.service.closeWithLoss(1, 'Se perdió en ruta'),
      ).rejects.toThrow(/Despacha la transferencia antes de cerrarla/);
      expect(h.stockLevelManager.updateStock).not.toHaveBeenCalled();
      expect(h.tx.stock_transfer_items.update).not.toHaveBeenCalled();
    });

    it('N2: una fila sin modo (flujo anterior) sigue recibiéndose sin despacho y descuenta el origen', async () => {
      const h = buildHarness({
        transfer: { status: 'in_transit', dispatched_at: null, movement_mode: null },
        items: [
          { id: 11, product_id: 1, product_variant_id: 10, quantity: 5, quantity_received: 0, quantity_dispatched: null, quantity_lost: 0 },
        ],
      });

      const result = await h.service.receive(1, [
        { id: 11, quantity_received: 5 },
      ]);

      expect(
        h.stockLevelManager.updateStock.mock.calls.map((call: any) => call[0]),
      ).toEqual([
        expect.objectContaining({ location_id: 7, quantity_change: -5 }),
        expect.objectContaining({ location_id: 9, quantity_change: 5 }),
      ]);
      expect(result.status).toBe('received');
    });

    describe('N3: remisiones con alcance de organización desde otra tienda', () => {
      // Contexto: tienda 3. Origen en la tienda 4, destino en la 3.
      const orgScope = (h: any) =>
        h.operatingScope.validateLocationScope.mockImplementation(
          async (_org: number, ids: number[]) => ({
            scope: 'ORGANIZATION',
            locations: ids.map((id) => ({
              id,
              organization_id: 1,
              store_id: id === 7 ? 4 : 3,
            })),
          }),
        );

      it('el despacho usa la tienda del contexto para candado, consecutivo y documento', async () => {
        const h = buildHarness({ transfer: { status: 'approved' } });
        orgScope(h);

        await h.service.dispatch(1, {});

        expect(h.tx.$executeRawUnsafe).toHaveBeenCalledWith(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          'dispatch_notes:number:3',
        );
        const numberLookup = h.tx.dispatch_notes.findFirst.mock.calls.find(
          (call: any) => call[0]?.where?.dispatch_number,
        );
        expect(numberLookup[0].where.store_id).toBe(3);
        expect(h.tx.dispatch_notes.create.mock.calls[0][0].data.store_id).toBe(3);
      });

      it('la remisión de entrada queda en la tienda que recibe (contexto)', async () => {
        const h = buildHarness({
          transfer: { status: 'in_transit', dispatched_at: new Date() },
          items: dispatchedItems(),
        });
        orgScope(h);

        await h.service.receive(1, [{ id: 11, quantity_received: 2 }]);

        expect(h.tx.$executeRawUnsafe).toHaveBeenCalledWith(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          'dispatch_notes:number:3',
        );
        const created = h.tx.dispatch_notes.create.mock.calls[0][0].data;
        expect(created.store_id).toBe(3);
        expect(created.subtype).toBe('transfer_in');
      });

      it('no duplica la remisión de entrada si la anterior está en otra tienda', async () => {
        const h = buildHarness({
          transfer: {
            status: 'partially_received',
            dispatched_at: new Date(),
            receipt_note_id: 777,
          },
          items: [
            { id: 11, product_id: 1, product_variant_id: 10, quantity: 5, quantity_received: 2, quantity_dispatched: 5, quantity_lost: 0 },
          ],
        });
        orgScope(h);
        // Con scope de tienda, la nota 777 (de otra tienda) no se encuentra.

        await expect(
          h.service.receive(1, [{ id: 11, quantity_received: 3 }]),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(h.tx.dispatch_notes.create).not.toHaveBeenCalled();
        expect(h.tx.stock_transfers.update).not.toHaveBeenCalled();
      });

      it('R3-1: rechaza la remisión de salida si la tienda del contexto no es origen ni destino', async () => {
        const h = buildHarness({ transfer: { status: 'approved' } });
        // Origen en la tienda 4 y destino en la 5: el contexto (3) es ajeno.
        h.operatingScope.validateLocationScope.mockImplementation(
          async (_org: number, ids: number[]) => ({
            scope: 'ORGANIZATION',
            locations: ids.map((id) => ({
              id,
              organization_id: 1,
              store_id: id === 7 ? 4 : 5,
            })),
          }),
        );

        await expect(h.service.dispatch(1, {})).rejects.toThrow(
          /tienda de origen o la de destino/,
        );
        expect(h.tx.dispatch_notes.create).not.toHaveBeenCalled();
      });

      it('R3-1: rechaza la recepción con remisión antes de mover stock si la tienda es ajena', async () => {
        const h = buildHarness({
          transfer: { status: 'in_transit', dispatched_at: new Date() },
          items: dispatchedItems(),
        });
        h.operatingScope.validateLocationScope.mockImplementation(
          async (_org: number, ids: number[]) => ({
            scope: 'ORGANIZATION',
            locations: ids.map((id) => ({
              id,
              organization_id: 1,
              store_id: id === 7 ? 4 : 5,
            })),
          }),
        );

        await expect(
          h.service.receive(1, [{ id: 11, quantity_received: 2 }]),
        ).rejects.toThrow(/tienda de origen o la de destino/);
        expect(h.stockLevelManager.updateStock).not.toHaveBeenCalled();
        expect(h.tx.dispatch_notes.create).not.toHaveBeenCalled();
      });

      it('sin tienda en el contexto no emite remisión con otra tienda', async () => {
        const h = buildHarness({ transfer: { status: 'approved' } });
        orgScope(h);
        (RequestContextService.getStoreId as jest.Mock).mockReturnValue(
          undefined,
        );

        await expect(h.service.dispatch(1, {})).rejects.toThrow(
          /Elige la tienda/,
        );
        expect(h.tx.dispatch_notes.create).not.toHaveBeenCalled();
      });

      it('la acumulación de entrada del cliente sin scope sigue creando si el documento se borró', async () => {
        const h = buildHarness();
        const id = await accumulateTransferReceiptNoteInTx(h.tx, {
          existing_note_id: 123,
          store_id: 3,
          direction: 'inbound',
          subtype: 'transfer_in',
          from_location_id: 7,
          to_location_id: 9,
          items: [{ product_id: 1, quantity: 1 }],
        });
        expect(id).toBe(900);
        expect(h.tx.dispatch_notes.create).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('numeración de remisiones', () => {
    const noteParams = {
      store_id: 3,
      direction: 'outbound' as const,
      subtype: 'transfer_out' as const,
      from_location_id: 7,
      to_location_id: 9,
      items: [{ product_id: 1, quantity: 2 }],
    };

    it('toma el candado de la tienda antes de calcular el número', async () => {
      const h = buildHarness();
      await createTransferNoteInTx(h.tx, noteParams);

      expect(h.tx.$executeRawUnsafe).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        'dispatch_notes:number:3',
      );
      const lockOrder = h.tx.$executeRawUnsafe.mock.invocationCallOrder[0];
      const numberOrder =
        h.tx.dispatch_notes.findFirst.mock.invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(numberOrder);
    });

    it('un choque de número no se reintenta en la transacción abortada: conflicto claro', async () => {
      const h = buildHarness();
      h.tx.dispatch_notes.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(createTransferNoteInTx(h.tx, noteParams)).rejects.toThrow(
        ConflictException,
      );
      expect(h.tx.dispatch_notes.create).toHaveBeenCalledTimes(1);
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
