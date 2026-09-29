import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { KitchenFireService, isPostCancelRemake, isWasteRemakeType } from './kitchen-fire.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RecipesService } from '../recipes/recipes.service';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { StockValidatorService } from '../inventory/shared/services/stock-validator.service';
import { NotificationsSseService } from '../notifications/notifications-sse.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';

// El servicio resuelve OrderFlowService con un require perezoso (evita el ciclo
// de imports). Se sustituye el módulo para desacoplar estos tests de su
// compilación; el token real no importa porque ModuleRef está mockeado.
jest.mock('../orders/order-flow/order-flow.service', () => ({
  OrderFlowService: class OrderFlowService {},
}));

interface FakeStockLevel {
  id: number;
  product_id: number;
  product_variant_id: number | null;
  location_id: number;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
  cost_per_unit: any;
}

describe('KitchenFireService.cancelTicket — stock disposition by KDS stage', () => {
  const harness = (status: 'pending' | 'in_preparation' | 'ready') => {
    const ticket = {
      id: 55, order_id: 100, store_id: 1, kds_id: 2, status,
      items: [{ id: 501, order_item_id: 77, status }],
    };
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 100, state: 'processing' }]),
      kitchen_tickets: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        // H2 — `findTicketConsumedLeaves` reads the ticket's own `fired_at`
        // as the consumption window's upper bound.
        findFirst: jest.fn().mockResolvedValue({ fired_at: new Date('2026-01-01T00:00:00Z') }),
      },
      kitchen_ticket_items: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        // H2 — no sibling tickets for this order_item_id in this harness:
        // the consumption window has no lower bound.
        findMany: jest.fn().mockResolvedValue([]),
      },
      audit_logs: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 9 }),
      },
      inventory_transactions: { findMany: jest.fn().mockResolvedValue([{
        organization_id: 3, product_id: 400, product_variant_id: null,
        quantity_change: -2, unit_cost: 5, total_cost: 10,
      }]) },
      inventory_cost_layers: { create: jest.fn().mockResolvedValue({ id: 1 }) },
      order_items: { findMany: jest.fn().mockResolvedValue([{ id: 77 }]) },
    };
    const prisma: any = {
      kitchen_tickets: {
        findFirst: jest.fn().mockResolvedValue(ticket),
        findMany: jest.fn().mockResolvedValue([{ status: 'cancelled' }]),
      },
      $transaction: jest.fn((fn: (tx: any) => Promise<unknown>) => fn(tx)),
    };
    const stock = {
      getDefaultLocationForProduct: jest.fn().mockResolvedValue(8),
      updateStock: jest.fn().mockResolvedValue({}),
    };
    const accounting = { onPreparedDishDisposition: jest.fn().mockResolvedValue({ id: 7 }) };
    const orderSync = {
      isOrderPaidForKitchenCancel: jest.fn().mockResolvedValue(false),
      cancelItemsFromKitchenInTx: jest.fn().mockResolvedValue(undefined),
    };
    const moduleRef = { get: jest.fn().mockReturnValue(orderSync) };
    const service = new KitchenFireService(
      prisma, {} as any, stock as any, {} as any,
      { emit: jest.fn() } as any, { push: jest.fn() } as any,
      { assertCanMutateStationTicket: jest.fn(), attributeOpenSessionToTicketConsumption: jest.fn() } as any,
      undefined, accounting as any, moduleRef as any,
    );
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: 1, organization_id: 3, user_id: 9,
    } as any);
    return { service, tx, stock, accounting, orderSync, moduleRef };
  };

  afterEach(() => jest.restoreAllMocks());

  it('pending restores each consumed leaf once and reverses COGS even when waste was requested', async () => {
    const { service, tx, stock, accounting } = harness('pending');
    await service.cancelTicket(55, 'waste');
    expect(stock.updateStock).toHaveBeenCalledWith(expect.objectContaining({
      product_id: 400, quantity_change: 2, movement_type: 'return',
      allow_negative: true,
    }), tx);
    expect(tx.inventory_cost_layers.create).toHaveBeenCalledTimes(1);
    expect(accounting.onPreparedDishDisposition).toHaveBeenCalledWith(expect.objectContaining({
      disposition: 'reuse', total_cost: 10,
    }));
  });

  it('R1 — cancelar ticket con orden sin pagar cancela las líneas vivas de la orden y omite las ya canceladas', async () => {
    const { service, tx, orderSync } = harness('ready');
    tx.order_items.findMany.mockResolvedValue([{ id: 77 }]);
    await service.cancelTicket(55, 'waste');
    expect(tx.order_items.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: [77] }, order_id: 100, cancelled_at: null },
    }));
    expect(orderSync.cancelItemsFromKitchenInTx).toHaveBeenCalledWith(tx, {
      orderId: 100, orderItemIds: [77], disposition: 'waste',
      reason: 'Cancelado en cocina', ticketId: 55, wasPending: false,
    });
  });

  it('R1 — si todas las líneas ya estaban canceladas en la orden no se vuelve a cancelar nada', async () => {
    const { service, tx, orderSync } = harness('pending');
    tx.order_items.findMany.mockResolvedValue([]);
    await service.cancelTicket(55);
    expect(orderSync.cancelItemsFromKitchenInTx).not.toHaveBeenCalled();
  });

  it('R1 — pending marca wasPending y reuse', async () => {
    const { service, orderSync } = harness('pending');
    await service.cancelTicket(55, 'waste');
    expect(orderSync.cancelItemsFromKitchenInTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      disposition: 'reuse', wasPending: true,
    }));
  });

  it('R1 — orden pagada: rechaza sin cancelar ni devolver inventario', async () => {
    const { service, tx, stock, orderSync } = harness('pending');
    orderSync.isOrderPaidForKitchenCancel.mockResolvedValue(true);
    await expect(service.cancelTicket(55)).rejects.toMatchObject({ errorCode: 'KITCHEN_TICKET_INVALID_STATE' });
    expect(tx.kitchen_tickets.updateMany).not.toHaveBeenCalled();
    expect(stock.updateStock).not.toHaveBeenCalled();
    expect(orderSync.cancelItemsFromKitchenInTx).not.toHaveBeenCalled();
  });

  it('R1 — pago concurrente: el re-chequeo bajo lock aborta la tx sin tocar inventario', async () => {
    const { service, tx, stock, orderSync } = harness('pending');
    orderSync.isOrderPaidForKitchenCancel
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    await expect(service.cancelTicket(55)).rejects.toMatchObject({ errorCode: 'KITCHEN_TICKET_INVALID_STATE' });
    expect(orderSync.isOrderPaidForKitchenCancel).toHaveBeenLastCalledWith(100, tx);
    expect(tx.kitchen_tickets.updateMany).not.toHaveBeenCalled();
    expect(stock.updateStock).not.toHaveBeenCalled();
  });

  it('R1 — OrderFlowService no resoluble: falla cerrado sin abrir transacción', async () => {
    const { service, moduleRef, stock } = harness('pending');
    moduleRef.get.mockImplementation(() => { throw new Error('not found'); });
    await expect(service.cancelTicket(55)).rejects.toMatchObject({ errorCode: 'SYS_INTERNAL_001' });
    expect((service as any).prisma.$transaction).not.toHaveBeenCalled();
    expect(stock.updateStock).not.toHaveBeenCalled();
  });

  it('in preparation requires a choice before any transaction starts', async () => {
    const { service, tx } = harness('in_preparation');
    await expect(service.cancelTicket(55)).rejects.toMatchObject({ errorCode: 'KITCHEN_TICKET_INVALID_STATE' });
    expect(tx.kitchen_tickets.updateMany).not.toHaveBeenCalled();
  });

  it('advanced waste keeps stock out and reclassifies COGS', async () => {
    const { service, tx, stock, accounting } = harness('ready');
    await service.cancelTicket(55, 'waste');
    expect(stock.updateStock).not.toHaveBeenCalled();
    expect(accounting.onPreparedDishDisposition).toHaveBeenCalledWith(expect.objectContaining({ disposition: 'waste' }));
    expect(tx.audit_logs.create).toHaveBeenCalledTimes(1);
  });

  it('a concurrent second cancellation loses the ticket claim and cannot return stock twice', async () => {
    const { service, tx, stock } = harness('pending');
    tx.kitchen_tickets.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.cancelTicket(55)).rejects.toMatchObject({ errorCode: 'KITCHEN_TICKET_INVALID_STATE' });
    expect(stock.updateStock).not.toHaveBeenCalled();
  });

  it('item cancellation leaves a shared ticket active until its sibling leaves', async () => {
    const { service } = harness('pending');
    const tx: any = {
      kitchen_ticket_items: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(1),
      },
      kitchen_tickets: { update: jest.fn() },
    };
    await expect(service.cancelTicketItemInTx(tx, 55, 77)).resolves.toBe('updated');
    expect(tx.kitchen_tickets.update).not.toHaveBeenCalled();
    expect(tx.kitchen_ticket_items.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { kitchen_ticket_id: 55, order_item_id: 77, status: 'pending' },
    }));
  });

  it('H2 — cancelling a remake ticket refunds only its own consumption, not the original ticket\'s', async () => {
    const { service, tx, stock, accounting } = harness('pending');
    // Two fires of the SAME order_item_id: ticket 54 (the original fire,
    // already cancelled/disposed earlier) and ticket 55 (this remake —
    // matches the harness's ticket id, fired_at 2026-01-01).
    tx.kitchen_ticket_items.findMany.mockResolvedValue([
      { kitchen_ticket: { fired_at: new Date('2025-12-31T00:00:00Z') } },
    ]);
    const allConsumption = [
      // Ticket 54's own consumption — BEFORE the lower bound, must be excluded.
      {
        organization_id: 3, product_id: 400, product_variant_id: null,
        quantity_change: -2, unit_cost: 5, total_cost: 10,
        created_at: new Date('2025-12-30T12:00:00Z'),
      },
      // Ticket 55's own consumption — inside (prevFiredAt, thisFiredAt].
      {
        organization_id: 3, product_id: 400, product_variant_id: null,
        quantity_change: -3, unit_cost: 5, total_cost: 15,
        created_at: new Date('2025-12-31T12:00:00Z'),
      },
    ];
    tx.inventory_transactions.findMany.mockImplementation(async ({ where }: any) => {
      return allConsumption.filter((row) => {
        if (row.created_at > where.created_at.lte) return false;
        if (where.created_at.gt && row.created_at <= where.created_at.gt) return false;
        return true;
      });
    });

    await service.cancelTicket(55, 'waste');

    // Only ticket 55's own 3-unit consumption is returned — ticket 54's
    // 2-unit row (before the lower bound) never enters the disposition.
    expect(stock.updateStock).toHaveBeenCalledTimes(1);
    expect(stock.updateStock).toHaveBeenCalledWith(expect.objectContaining({
      product_id: 400, quantity_change: 3, movement_type: 'return',
    }), tx);
    expect(tx.audit_logs.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metadata: expect.objectContaining({ ticket_id: 55, consumed_cost: 15 }),
      }),
    }));
    expect(accounting.onPreparedDishDisposition).toHaveBeenCalledWith(
      expect.objectContaining({ total_cost: 15 }),
    );
  });

  it('H2 — a second ticket of the same order_item_id is not swallowed by the first ticket\'s already-recorded disposition', async () => {
    const { service, tx, stock } = harness('pending');
    // A prior disposition row exists, but for a DIFFERENT ticket (54) of the
    // same order_item_id — the idempotency key is (order_item_id, ticket_id),
    // so this call (for ticket 55) must NOT match it.
    tx.audit_logs.findFirst.mockImplementation(async ({ where }: any) => {
      const ticketIdClause = (where.AND as any[]).find(
        (c) => c.metadata?.path?.[0] === 'ticket_id',
      );
      return ticketIdClause?.metadata.equals === 54 ? { id: 1 } : null;
    });

    await service.cancelTicket(55, 'waste');

    expect(tx.audit_logs.findFirst).toHaveBeenCalledWith({
      where: {
        action: 'order_item.prepared_disposition',
        resource_id: 100,
        AND: [
          { metadata: { path: ['order_item_id'], equals: 77 } },
          { metadata: { path: ['ticket_id'], equals: 55 } },
        ],
      },
      select: { id: true },
    });
    // Not swallowed: ticket 55's own disposition still gets posted.
    expect(stock.updateStock).toHaveBeenCalledTimes(1);
    expect(tx.audit_logs.create).toHaveBeenCalledTimes(1);
  });
});

describe('KitchenFireService — post-cancel remake vocabulary', () => {
  const item = (cancellation_type: string | null) => ({ cancellation_type });

  it.each(['after_fire_reused', 'after_fire_waste', 'delivered_restock', 'delivered_waste'])(
    'accepts %s on a cancelled order only for remake_dish', (type) => {
      expect(isPostCancelRemake('cancelled', 'remake_dish', [item(type)])).toBe(true);
      expect(isPostCancelRemake('cancelled', 'lost_command', [item(type)])).toBe(false);
      expect(isPostCancelRemake('refunded', 'remake_dish', [item(type)])).toBe(false);
    },
  );

  it('rejects before_fire, unknown, empty, and mixed undecided selections', () => {
    expect(isPostCancelRemake('cancelled', 'remake_dish', [item('before_fire')])).toBe(false);
    expect(isPostCancelRemake('cancelled', 'remake_dish', [item('inventado')])).toBe(false);
    expect(isPostCancelRemake('cancelled', 'remake_dish', [])).toBe(false);
    expect(isPostCancelRemake('cancelled', 'remake_dish', [item('after_fire_reused'), item(null)])).toBe(false);
  });

  it('reconsumes waste aliases but not reuse aliases', () => {
    expect(isWasteRemakeType('after_fire_waste')).toBe(true);
    expect(isWasteRemakeType('delivered_waste')).toBe(true);
    expect(isWasteRemakeType('after_fire_reused')).toBe(false);
    expect(isWasteRemakeType('delivered_restock')).toBe(false);
  });
});

describe('KitchenFireService — remake consumption after D2 reuse', () => {
  const orderItem = (id: number, cancellation_type: string) => ({
    id, product_id: id + 100, product_name: `Plato ${id}`, quantity: 1,
    product_variant_id: null, notes: null, inventory_consumed_at_fire: true,
    cancellation_type, cancelled_at: new Date('2026-09-23T10:00:00Z'),
    products: { id: id + 100, kds_id: null }, product_variants: null,
  });

  const harness = (items = [orderItem(7, 'after_fire_reused')]) => {
    const order = { id: 100, store_id: 1, order_number: 'ORD-100', table_sessions: [], order_items: items };
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 100 }]),
      $executeRaw: jest.fn().mockResolvedValue(1),
      orders: { findFirst: jest.fn().mockResolvedValue({ id: 100, state: 'cancelled' }) },
      order_items: { findMany: jest.fn().mockResolvedValue(items), updateMany: jest.fn().mockResolvedValue({ count: items.length }) },
      kitchen_ticket_items: { findFirst: jest.fn().mockResolvedValue(null) },
      kitchen_tickets: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({ id: 55, items: [] }) },
    };
    const prisma: any = {
      stores: { findUnique: jest.fn().mockResolvedValue({ industries: ['restaurant'] }) },
      orders: { findFirst: jest.fn().mockResolvedValue(order), findUnique: jest.fn().mockResolvedValue({ state: 'cancelled' }) },
      kds: { findFirst: jest.fn().mockResolvedValue({ id: 5 }) },
      kitchen_tickets: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: (tx: any) => Promise<unknown>) => fn(tx)),
    };
    const events = { emit: jest.fn() };
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 1, organization_id: 2, user_id: 3 } as any);
    const stockValidator = {
      assertIngredientsAvailable: jest.fn().mockResolvedValue(undefined),
    };
    const service = new KitchenFireService(prisma, {} as any, {} as any, stockValidator as any, events as any, {} as any, {} as any);
    jest.spyOn(service as any, 'getBusinessDate').mockResolvedValue('2026-09-23');
    const fireContext = { firedItemIds: items.map((it) => it.id), skippedItemIds: [] };
    const prepare = jest.spyOn(service, 'prepareFireContext').mockResolvedValue(fireContext as any);
    const fire = jest.spyOn(service, 'fireOrderItemsInTx').mockResolvedValue({
      ticketId: 55, ticketIds: [55], firedItemSnapshots: items.map((it) => ({ orderItemId: it.id })),
      cogsTotal: 29, consumedLineCount: 3,
    } as any);
    return { service, prisma, tx, events, prepare, fire };
  };

  it('reconsumes a reused dish via canonical fire and emits one COGS event', async () => {
    const { service, tx, events, prepare, fire } = harness();
    const result = await service.resendOrderItems({ order_id: 100, order_item_ids: [7], reason: 'remake_dish' });
    expect(prepare).toHaveBeenCalledWith(100, [7], tx);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith(tx, 1, expect.any(Object));
    expect(tx.kitchen_tickets.create).not.toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith('kitchen.fired', expect.objectContaining({
      order_id: 100, total_cost: 29, consumed_line_count: 3,
    }));
    expect(result.ticketIds).toEqual([55]);
  });

  it('consumes mixed reuse+waste once each, not through two fire passes', async () => {
    const { service, prepare, fire, events, tx } = harness([
      orderItem(7, 'after_fire_reused'), orderItem(8, 'after_fire_waste'),
    ]);
    await service.resendOrderItems({ order_id: 100, order_item_ids: [7, 8], reason: 'remake_dish' });
    expect(prepare).toHaveBeenCalledWith(100, [7, 8], tx);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('rolls back a failed canonical fire without COGS event or plain ticket', async () => {
    const { service, fire, tx, events } = harness();
    fire.mockRejectedValueOnce(new Error('stock unavailable'));
    await expect(service.resendOrderItems({ order_id: 100, order_item_ids: [7], reason: 'remake_dish' }))
      .rejects.toThrow('stock unavailable');
    expect(tx.kitchen_tickets.create).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('el remake con consumo delega el historial al fire canónico con resend: true', async () => {
    const { service, fire } = harness();
    await service.resendOrderItems({ order_id: 100, order_item_ids: [7], reason: 'remake_dish' });
    expect(fire).toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.objectContaining({ historyExtras: { resend: true, reason: 'remake_dish' } }),
    );
  });

  it('el reenvío sin consumo (lost_command) registra kitchen_fired con resend: true en el tx del ticket', async () => {
    const { service, prisma, tx, fire } = harness([orderItem(7, 'after_fire_reused')]);
    prisma.orders.findUnique.mockResolvedValue({ state: 'processing' });
    prisma.kitchen_ticket_items = { findMany: jest.fn().mockResolvedValue([]) };
    const record = jest.fn().mockResolvedValue({ id: 1 });
    (service as any).orderHistoryService = { record };

    await service.resendOrderItems({ order_id: 100, order_item_ids: [7], reason: 'lost_command' });

    expect(fire).not.toHaveBeenCalled();
    expect(tx.kitchen_tickets.create).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(tx, {
      orderId: 100,
      storeId: 1,
      organizationId: 2,
      type: 'kitchen_fired',
      payload: {
        ticket_ids: [55],
        order_item_ids: [7],
        kds_ids: [5],
        resend: true,
        reason: 'lost_command',
      },
    });
  });

  it('rejects a replay after a post-cancel remake ticket without a second stock exit', async () => {
    const { service, tx, fire, events } = harness();
    tx.kitchen_ticket_items.findFirst.mockResolvedValueOnce({ id: 901 });
    await expect(service.resendOrderItems({ order_id: 100, order_item_ids: [7], reason: 'remake_dish' }))
      .rejects.toMatchObject({ errorCode: 'KITCHEN_FIRE_NOT_RESENDABLE' });
    expect(fire).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });
});

/**
 * Targeted unit tests for `KitchenFireService.fireOrderItems()`.
 *
 * These tests exercise the heart of Fase D:
 *  - 3 prepared order_items (1 with merma, 1 with sub-recipe, 1 raw)
 *    are consumed via StockLevelManager.updateStock with
 *    `movement_type='consumption'` and a negative `quantity_change`.
 *  - `order_items.inventory_consumed_at_fire` is flipped to TRUE.
 *  - The COGS total emitted on the `kitchen.fired` event equals the sum
 *    of `cost_snapshot.total_cost` returned by every consumption.
 *  - Idempotency: re-firing the same order_item does NOT trigger
 *    additional stock updates and re-emits a `KITCHEN_FIRE_ALL_ALREADY_CONSUMED`
 *    style error.
 *
 * The test mocks `RecipesService.explodeBom` to return synthetic BOMs
 * (no need to walk the recursive recipe graph) and stubs
 * `StockLevelManager.updateStock` to return deterministic
 * `cost_snapshot` values per call.
 */
describe('KitchenFireService — fireOrderItems() (Fase D smoke)', () => {
  let service: KitchenFireService;
  let recipesService: any;
  let stockLevelManager: jest.Mocked<
    Pick<StockLevelManager, 'updateStock' | 'getDefaultLocationForProduct'>
  >;
  let stockValidatorService: jest.Mocked<
    Pick<StockValidatorService, 'assertIngredientsAvailable' | 'resolveInventoryPolicy'>
  >;
  let eventEmitter: jest.Mocked<Pick<EventEmitter2, 'emit'>>;
  let prismaMock: any;

  const ctx = {
    store_id: 1,
    organization_id: 1,
    user_id: 42,
    is_super_admin: false,
  };

  const makeOrderItem = (
    id: number,
    productId: number,
    productType: string,
    alreadyFired = false,
  ) => ({
    id,
    order_id: 100,
    product_id: productId,
    product_name: `Plato ${id}`,
    quantity: 2,
    inventory_consumed_at_fire: alreadyFired,
    products: {
      id: productId,
      name: `Plato ${id}`,
      product_type: productType,
      track_inventory: true,
      store_id: 1,
    },
  });

  /**
   * CP-POLLO-ARABE-727 A.6 — helper de order_item con la variante vendida.
   * Modela el include real de `fireOrderItems`:
   *   - `product_variant_id` (columna de order_items, nullable)
   *   - `product_variants` (relación, nullable — `name` para `variant_label`,
   *     `product_id` para validar pertenencia ERR-15)
   *   - `products._count.product_variants` (para el warn "producto con variantes")
   */
  const makeVariantOrderItem = (
    id: number,
    productId: number,
    opts: {
      variantId?: number | null;
      variantName?: string | null;
      variantProductId?: number;
      variantCount?: number;
      productType?: string;
      quantity?: number;
      alreadyFired?: boolean;
    } = {},
  ) => ({
    id,
    order_id: 100,
    product_id: productId,
    product_name: `Plato ${id}`,
    quantity: opts.quantity ?? 2,
    product_variant_id: opts.variantId ?? null,
    variant_attributes: null,
    variant_sku: null,
    inventory_consumed_at_fire: opts.alreadyFired ?? false,
    products: {
      id: productId,
      name: `Plato ${id}`,
      product_type: opts.productType ?? 'prepared',
      track_inventory: true,
      store_id: 1,
      _count: { product_variants: opts.variantCount ?? 0 },
    },
    product_variants:
      opts.variantId != null
        ? {
            id: opts.variantId,
            name: opts.variantName ?? 'Picante',
            product_id: opts.variantProductId ?? productId,
          }
        : null,
  });

  /**
   * CP-POLLO-ARABE-727 A.6 — tx de prueba para el fire (mismo shape que el
   * mock corregido del test 1): KDS por defecto, sesión abierta por estación,
   * update/findMany de order_items y contadores. `kitchen_tickets` se aporta
   * por test para poder inspeccionar el `.create({})`.
   */
  const buildFireTxMock = (opts: { orderItemId?: number } = {}) => ({
    kds: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
    kds_sessions: { findFirst: jest.fn().mockResolvedValue(null) },
    order_items: {
      update: jest.fn().mockResolvedValue({ id: opts.orderItemId ?? 10 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    kitchen_ticket_items: {
      update: jest.fn().mockResolvedValue({}),
    },
    kitchen_ticket_item_exclusions: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $executeRaw: jest.fn().mockResolvedValue(undefined),
  });

  const makeTxTicket = (id: number, orderItemId: number, productId: number) => ({
    id,
    items: [
      { id: 1, order_item_id: orderItemId, product_id: productId, quantity: 2, status: 'pending' },
    ],
  });

  /**
   * CP-POLLO-ARABE-727 A.6 — configura el contexto de fire para un item
   * `prepared`: orden, receta activa (o `noRecipe` para recipe-less), BOM y
   * costos deterministas.
   */
  const setupFireableContext = (
    orderItems: any[],
    opts: { recipe?: any; bom?: any[]; noRecipe?: boolean } = {},
  ) => {
    prismaMock.orders.findFirst.mockResolvedValue({
      id: 100,
      store_id: 1,
      order_number: `ORD-${orderItems[0].id}`,
      order_items: orderItems,
    });
    // CP-POLLO-ARABE-727 A.7 — `fireOrderItems` pre-carga las recetas activas
    // con un único `recipes.findMany`, no un `findFirst` por línea. devuelve el
    // array de recetas activas (vacío para recipe-less).
    prismaMock.recipes.findMany.mockResolvedValue(
      opts.noRecipe
        ? []
        : [
            opts.recipe ?? {
              id: 7,
              product_id: orderItems[0].product_id,
              is_active: true,
            },
          ],
    );
    recipesService.explodeBom.mockResolvedValue(
      opts.bom ?? [
        {
          component_product_id: 201,
          quantity: 0.25,
          unit_cost: 4000,
          depth: 1,
          path_recipe_ids: [7],
        },
      ],
    );
    stockLevelManager.getDefaultLocationForProduct.mockResolvedValue(1);
    stockLevelManager.updateStock.mockResolvedValue({
      cost_snapshot: { total_cost: 1000 },
    } as any);
  };

  /** Configura `$transaction` del fire y devuelve el mock de `kitchen_tickets.create`. */
  const setupFireTransaction = (orderItemId: number): jest.Mock => {
    const ticketCreate = jest
      .fn()
      .mockResolvedValue(makeTxTicket(555, orderItemId, 50));
    prismaMock.$transaction.mockImplementation(async (cb: any) =>
      cb({
        ...buildFireTxMock({ orderItemId }),
        kitchen_tickets: {
          create: ticketCreate,
          count: jest.fn().mockResolvedValue(0),
        },
      }),
    );
    return ticketCreate;
  };

  beforeEach(() => {
    recipesService = {
      explodeBom: jest.fn(),
    };

    stockLevelManager = {
      updateStock: jest.fn(),
      getDefaultLocationForProduct: jest.fn(),
    } as any;

    // No-overselling guard (docs/plans/no-overselling-stock-guard-plan.md,
    // step 6): resolves as available by default so the pre-existing smoke
    // tests are unaffected; tests exercising the guard itself override this.
    // Step 9: `resolveInventoryPolicy` defaults to the strict/pre-switch
    // policy (no oversell, ingredient overuse allowed only via warn) so the
    // existing smoke tests keep exercising the step-6 blocking guard;
    // tests exercising the step-9 switches override this per-case.
    stockValidatorService = {
      assertIngredientsAvailable: jest.fn().mockResolvedValue([]),
      resolveInventoryPolicy: jest.fn().mockResolvedValue({
        allowOversell: false,
        allowIngredientOveruse: false,
      }),
    } as any;

    eventEmitter = { emit: jest.fn() } as any;

    prismaMock = {
      orders: {
        findFirst: jest.fn(),
      },
      // CP-POLLO-ARABE-727 A.6 — `splitLinesForExclusions` lee las líneas
      // originales a partir del DTO (para una línea partida por exclusión).
      order_items: {
        findMany: jest.fn(),
      },
      recipes: {
        findMany: jest.fn(),
      },
      stores: {
        findUnique: jest.fn().mockResolvedValue({
          industries: ['restaurant'],
        }),
      },
      store_settings: {
        findUnique: jest.fn().mockResolvedValue({
          settings: { general: { timezone: 'America/Bogota' } },
        }),
      },
      $transaction: jest.fn(),
    };

    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue(ctx as any);

    service = new KitchenFireService(
      prismaMock as any,
      recipesService as RecipesService,
      stockLevelManager as any,
      stockValidatorService as any,
      eventEmitter as any,
      { push: jest.fn() } as any,
      { attributeOpenSessionToTicketConsumption: jest.fn() } as any,
      undefined,
      undefined,
      {
        get: jest.fn().mockReturnValue({
          isOrderPaidForKitchenCancel: jest.fn().mockResolvedValue(false),
          cancelItemsFromKitchenInTx: jest.fn().mockResolvedValue(undefined),
        }),
      } as any,
    );
  });

  it('rejects an undecided cancelled-order remake with KITCHEN_FIRE_NOT_RESENDABLE', async () => {
    prismaMock.orders.findFirst.mockResolvedValue({
      id: 100,
      store_id: 1,
      order_items: [{ id: 7, inventory_consumed_at_fire: true, cancellation_type: 'before_fire' }],
    });
    prismaMock.orders.findUnique = jest.fn().mockResolvedValue({ state: 'cancelled' });

    await expect(service.resendOrderItems({
      order_id: 100, order_item_ids: [7], reason: 'remake_dish',
    })).rejects.toMatchObject({ errorCode: 'KITCHEN_FIRE_NOT_RESENDABLE' });
  });

  it('C.4 — snapshot and ticket list select order delivery_type without changing takeaway selection', async () => {
    const ticket = {
      id: 1,
      order: { order_number: 'ORD-1', delivery_type: 'home_delivery' },
      items: [{ order_item: { is_takeaway: true } }],
    };
    prismaMock.kitchen_tickets = {
      findMany: jest.fn().mockResolvedValue([ticket]),
      count: jest.fn().mockResolvedValue(1),
    };
    jest.spyOn(service as any, 'getBusinessDate').mockResolvedValue('2026-09-22');

    const snapshot = await service.getActiveTicketsSnapshot();
    const list = await service.findTickets({ order_id: 100 });

    expect(snapshot.data[0].order.delivery_type).toBe('home_delivery');
    expect(list.data[0].order.delivery_type).toBe('home_delivery');
    for (const [query] of prismaMock.kitchen_tickets.findMany.mock.calls) {
      expect(query.include).toMatchObject({
        order: { select: { delivery_type: true } },
        items: { include: { order_item: { select: { is_takeaway: true } } } },
      });
    }
  });

  it('consumes 3 leaf components (merma + sub-recipe + direct), flips flag, emits kitchen.fired with COGS', async () => {
    // Order has 1 prepared order_item (id=10, product=50) and the
    // operator asked to fire only that one. The other 2 items in the
    // request are non-prepared (services) and are skipped.
    prismaMock.orders.findFirst.mockResolvedValue({
      id: 100,
      store_id: 1,
      order_number: 'ORD-1',
      order_items: [
        makeOrderItem(10, 50, 'prepared', false), // ← fires
        makeOrderItem(11, 51, 'service', false), // ← skipped (service)
        makeOrderItem(12, 52, 'physical', false), // ← skipped (physical)
      ],
    });

    prismaMock.recipes.findMany.mockResolvedValue([
      { id: 7, product_id: 50, is_active: true },
    ]);

    // explodeBom returns 3 leaves:
    //   - product 99 (harina, direct, qty 1 per unit — merma-free
    //     integer to keep post-Math.round consumption exact)
    //   - product 80 (sub-recipe 'salsa', already resolved at the leaf)
    //   - product 70 (insumo directo)
    // multiplied by qty=2 (order_item.quantity) at the call site.
    // Production rounds consumedQty = Math.round(line.quantity * orderQty),
    // so we pick integer-friendly line values to assert exact consumption.
    recipesService.explodeBom.mockResolvedValue([
      { component_product_id: 99, quantity: 1, depth: 1, path_recipe_ids: [] },
      { component_product_id: 80, quantity: 0.5, depth: 1, path_recipe_ids: [] },
      { component_product_id: 70, quantity: 3, depth: 1, path_recipe_ids: [] },
    ]);

    stockLevelManager.getDefaultLocationForProduct.mockImplementation(
      async (pid: number) => 100 + pid,
    );

    // Per-leaf FIFO cost snapshot. Production passes quantity_change
    // = -Math.round(line.quantity * orderQty), so we mirror that:
    //   - harina: 1 * 2 = 2 → cost 0.20 × 2 = 0.40
    //   - salsa:  0.5 * 2 = 1 → cost 0.50 × 1 = 0.50
    //   - insumo: 3 * 2 = 6 → cost 0.10 × 6 = 0.60
    //   total = 1.50
    stockLevelManager.updateStock.mockImplementation(async (params) => {
      let cost = 0;
      if (params.product_id === 99) cost = 0.2 * 2; // harina: 0.20 × 2
      else if (params.product_id === 80) cost = 0.5 * 1; // salsa: 0.50 × 1
      else if (params.product_id === 70) cost = 0.1 * 6; // insumo: 0.10 × 6
      return {
        stock_level: { id: params.product_id } as FakeStockLevel,
        transaction: { id: params.product_id } as any,
        previous_quantity: 100,
        cost_snapshot: {
          unit_cost: cost / Math.abs(params.quantity_change),
          total_cost: cost,
          stock_value: 0,
        },
      };
    });

    // $transaction executes the callback with a fake tx that supports
    // order_items.update, kitchen_tickets.create (with nested items.create).
    // CP-POLLO-ARABE-727 A.6 — `fireOrderItemsInTx` arranca resolviendo el KDS
    // por defecto (`tx.kds.findFirst`) y la sesión abierta por estación
    // (`tx.kds_sessions.findFirst`), y después lee la nota de cada item
    // (`tx.order_items.findMany`). El mock original sólo tenía
    // `order_items.update`, así que la suite fallaba en esa cascada KDS
    // (`tx.kds.findFirst is undefined`).
    const orderItemUpdate = jest.fn().mockResolvedValue({ id: 10 });
    const ticketCreate = jest.fn().mockResolvedValue({
      id: 555,
      items: [
        { id: 1, order_item_id: 10, product_id: 50, quantity: 2, status: 'pending' },
      ],
    });
    prismaMock.$transaction.mockImplementation(async (cb: any) =>
      cb({
        kds: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
        kds_sessions: { findFirst: jest.fn().mockResolvedValue(null) },
        order_items: {
          update: orderItemUpdate,
          findMany: jest.fn().mockResolvedValue([]),
        },
        kitchen_tickets: {
          create: ticketCreate,
          count: jest.fn().mockResolvedValue(0),
        },
        kitchen_ticket_items: {
          update: jest.fn().mockResolvedValue({}),
        },
        kitchen_ticket_item_exclusions: {
          createMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        $executeRaw: jest.fn().mockResolvedValue(undefined),
      }),
    );

    // 1) Call
    const result = await service.fireOrderItems({
      order_id: 100,
      order_item_ids: [10, 11, 12],
    });

    // 2) Assertions
    // (a) 3 updateStock calls — one per leaf, all 'consumption' negative
    expect(stockLevelManager.updateStock).toHaveBeenCalledTimes(3);
    for (const call of stockLevelManager.updateStock.mock.calls) {
      expect(call[0].movement_type).toBe('consumption');
      expect(call[0].quantity_change).toBeLessThan(0);
      expect(call[0].source_module).toBe('kitchen_fire');
    }
    // (b) The leaf product ids were 99, 80, 70 in that order (order of
    //     the bomLines array is preserved)
    const calledProductIds = stockLevelManager.updateStock.mock.calls.map(
      (c) => c[0].product_id,
    );
    expect(calledProductIds).toEqual([99, 80, 70]);
    // (c) Quantities reflect qty=2 multiplier: 1*2=2, 0.5*2=1, 3*2=6
    //     (production rounds: Math.round(line.quantity * orderQty))
    expect(stockLevelManager.updateStock.mock.calls[0][0].quantity_change).toBeCloseTo(
      -2,
      4,
    );
    expect(stockLevelManager.updateStock.mock.calls[1][0].quantity_change).toBeCloseTo(
      -1,
      4,
    );
    expect(stockLevelManager.updateStock.mock.calls[2][0].quantity_change).toBeCloseTo(
      -6,
      4,
    );

    // (d) Flag flipped on the prepared order_item only
    expect(orderItemUpdate).toHaveBeenCalledTimes(1);
    expect(orderItemUpdate).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { inventory_consumed_at_fire: true },
    });

    // (e) Ticket created with the nested items
    expect(ticketCreate).toHaveBeenCalledTimes(1);
    const ticketArgs = ticketCreate.mock.calls[0][0];
    expect(ticketArgs.data.store_id).toBe(1);
    expect(ticketArgs.data.order_id).toBe(100);
    expect(ticketArgs.data.status).toBe('pending');
    expect(ticketArgs.data.items.create).toHaveLength(1);

    // (f) Returned result includes the right fired/skipped partition
    expect(result.fired_item_ids).toEqual([10]);
    expect(result.skipped_item_ids).toEqual([11, 12]);
    expect(result.kitchen_ticket_id).toBe(555);
    expect(result.consumed_line_count).toBe(3);

    // (g) COGS = 0.40 + 0.50 + 0.60 = 1.50
    expect(result.cogs_total).toBeCloseTo(1.5, 2);

    // (h) kitchen.fired event emitted once with the right payload
    expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'kitchen.fired',
      expect.objectContaining({
        kitchen_ticket_id: 555,
        order_id: 100,
        organization_id: 1,
        store_id: 1,
        consumed_line_count: 3,
        total_cost: expect.closeTo(1.5, 2),
        user_id: 42,
      }),
    );
  });

  it('is idempotent: re-firing the same already-consumed item is a no-op (no stock movement, no event)', async () => {
    // Order has the only target item already flagged
    prismaMock.orders.findFirst.mockResolvedValue({
      id: 100,
      store_id: 1,
      order_number: 'ORD-2',
      order_items: [makeOrderItem(10, 50, 'prepared', true)],
    });

    // No stock updates, no transaction, no event
    await expect(
      service.fireOrderItems({ order_id: 100, order_item_ids: [10] }),
    ).rejects.toBeInstanceOf(VendixHttpException);

    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a fire request that contains only non-prepared items', async () => {
    prismaMock.orders.findFirst.mockResolvedValue({
      id: 100,
      store_id: 1,
      order_number: 'ORD-3',
      order_items: [makeOrderItem(11, 51, 'service', false)],
    });

    await expect(
      service.fireOrderItems({ order_id: 100, order_item_ids: [11] }),
    ).rejects.toBeInstanceOf(VendixHttpException);

    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  // Orden #8513: una linea cancelada (`cancelled_at`) se disparo igual y
  // consumio insumos. El fire debe excluirla en el where de Prisma.
  it('excluye lineas canceladas: solo dispara y consume la linea viva', async () => {
    const live = makeVariantOrderItem(10, 50);
    const cancelled = { ...makeVariantOrderItem(11, 51), cancelled_at: new Date() };
    setupFireableContext([live]);
    // Mock fiel al where real: aplica `cancelled_at: null` sobre las lineas.
    prismaMock.orders.findFirst.mockImplementation(async (args: any) => {
      const w = args.select.order_items.where;
      const rows = [live, { ...cancelled }].filter(
        (i: any) =>
          w.id.in.includes(i.id) &&
          (w.cancelled_at === null ? !i.cancelled_at : true),
      );
      return { id: 100, store_id: 1, order_number: 'ORD-8513', order_items: rows };
    });
    const ticketCreate = setupFireTransaction(10);

    await service.fireOrderItems({ order_id: 100, order_item_ids: [10, 11] });

    const where = prismaMock.orders.findFirst.mock.calls[0][0].select.order_items.where;
    expect(where.cancelled_at).toBeNull();
    const created = ticketCreate.mock.calls[0][0].data.items.create;
    expect(created).toHaveLength(1);
    expect(created[0].order_item_id).toBe(10);
    // Solo la linea viva consume insumos.
    expect(recipesService.explodeBom).toHaveBeenCalledTimes(1);
    expect(stockLevelManager.updateStock).toHaveBeenCalledTimes(1);
  });

  it('un fire solo de lineas canceladas cae en KITCHEN_FIRE_ITEM_NOT_FOUND sin consumir', async () => {
    // El where filtra la linea cancelada: la orden llega sin order_items.
    prismaMock.orders.findFirst.mockResolvedValue({
      id: 100,
      store_id: 1,
      order_number: 'ORD-8513',
      order_items: [],
    });

    await expect(
      service.fireOrderItems({ order_id: 100, order_item_ids: [11] }),
    ).rejects.toMatchObject({ errorCode: 'KITCHEN_FIRE_ITEM_NOT_FOUND' });

    const where = prismaMock.orders.findFirst.mock.calls[0][0].select.order_items.where;
    expect(where.cancelled_at).toBeNull();
    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // CP-POLLO-ARABE-727 A.6 — la variante vendida viaja a `kitchen_ticket_items`.
  // Matriz: producto variantizado, producto simple, línea partida por exclusión
  // (splitLinesForExclusions) y línea recipe-less (el segundo `push()`).
  // --------------------------------------------------------------------------

  // Historial de orden — `kitchen_fired` en `order_events`, mismo tx del ticket.
  it('registra kitchen_fired en order_events dentro del mismo tx que crea el ticket', async () => {
    const record = jest.fn().mockResolvedValue({ id: 1 });
    (service as any).orderHistoryService = { record };
    setupFireableContext([makeVariantOrderItem(10, 50)]);
    const ticketCreate = setupFireTransaction(10);

    await service.fireOrderItems({ order_id: 100, order_item_ids: [10] });

    expect(record).toHaveBeenCalledTimes(1);
    const [txArg, evt] = record.mock.calls[0];
    // El tx del evento es el MISMO que creó el ticket (atomicidad).
    expect(txArg.kitchen_tickets.create).toBe(ticketCreate);
    expect(evt).toEqual({
      orderId: 100,
      storeId: 1,
      organizationId: 1,
      type: 'kitchen_fired',
      payload: { ticket_ids: [555], order_item_ids: [10], kds_ids: [1] },
    });
  });

  it('un fire sin OrderHistoryService cableado sigue funcionando (inyección opcional)', async () => {
    (service as any).orderHistoryService = undefined;
    setupFireableContext([makeVariantOrderItem(10, 50)]);
    setupFireTransaction(10);

    await expect(
      service.fireOrderItems({ order_id: 100, order_item_ids: [10] }),
    ).resolves.toMatchObject({ kitchen_ticket_id: 555 });
  });

  it('si registrar el evento falla, el fire hace rollback (no se traga el error)', async () => {
    (service as any).orderHistoryService = {
      record: jest.fn().mockRejectedValue(new Error('order_events down')),
    };
    setupFireableContext([makeVariantOrderItem(10, 50)]);
    setupFireTransaction(10);

    await expect(
      service.fireOrderItems({ order_id: 100, order_item_ids: [10] }),
    ).rejects.toThrow('order_events down');
    expect(eventEmitter.emit).not.toHaveBeenCalledWith('kitchen.fired', expect.anything());
  });

  it('persists product_variant_id and variant_label for a prepared item with a variant', async () => {
    setupFireableContext([
      makeVariantOrderItem(10, 50, {
        variantId: 5,
        variantName: 'Picante',
        variantCount: 2,
      }),
    ]);
    const ticketCreate = setupFireTransaction(10);

    await service.fireOrderItems({ order_id: 100, order_item_ids: [10] });

    expect(ticketCreate).toHaveBeenCalledTimes(1);
    const create = ticketCreate.mock.calls[0][0].data.items.create;
    expect(create).toHaveLength(1);
    expect(create[0]).toMatchObject({
      product_variant_id: 5,
      variant_label: 'Picante',
    });
  });

  it('keeps product_variant_id and variant_label NULL for a product without variants', async () => {
    setupFireableContext([
      makeVariantOrderItem(10, 50, { variantId: null, variantCount: 0 }),
    ]);
    const ticketCreate = setupFireTransaction(10);

    await service.fireOrderItems({ order_id: 100, order_item_ids: [10] });

    const create = ticketCreate.mock.calls[0][0].data.items.create;
    expect(create[0]).toMatchObject({
      product_variant_id: null,
      variant_label: null,
    });
  });

  it('persists the variant for a recipe-less item (second push)', async () => {
    setupFireableContext(
      [
        makeVariantOrderItem(10, 50, {
          variantId: 9,
          variantName: 'Familiar',
          variantCount: 1,
        }),
      ],
      { noRecipe: true },
    );
    const ticketCreate = setupFireTransaction(10);

    await service.fireOrderItems({ order_id: 100, order_item_ids: [10] });

    // Recipe-less: no BOM → sin consumo de stock.
    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    const create = ticketCreate.mock.calls[0][0].data.items.create;
    expect(create).toHaveLength(1);
    expect(create[0]).toMatchObject({
      product_variant_id: 9,
      variant_label: 'Familiar',
    });
  });

  it('keeps the variant on a line split by exclusion (splitLinesForExclusions)', async () => {
    const original = {
      ...makeVariantOrderItem(10, 50, {
        variantId: 5,
        variantName: 'Picante',
        quantity: 3,
        variantCount: 2,
      }),
      unit_price: 20,
      total_price: 60,
      item_type: 'physical',
      cost_price: 10,
      is_price_overridden: false,
      inventory_committed: false,
      is_takeaway: false,
      notes: null,
      skip_kds: false,
      split_from_order_item_id: null,
    };
    prismaMock.order_items.findMany.mockResolvedValue([original]);
    const splitCreate = jest.fn().mockResolvedValue({ id: 20 });
    const splitUpdate = jest.fn().mockResolvedValue({});
    prismaMock.$transaction.mockImplementation(async (cb: any) =>
      cb({ order_items: { update: splitUpdate, create: splitCreate } }),
    );

    const res = await (service as any).splitLinesForExclusions({
      order_id: 100,
      order_item_ids: [10],
      exclusions: [
        { order_item_id: 10, component_product_ids: [99], applies_to_units: 1 },
      ],
    });

    expect(splitCreate).toHaveBeenCalledTimes(1);
    // La línea NUEVA (la que lleva la exclusión) hereda la variante de la original.
    expect(splitCreate.mock.calls[0][0].data.product_variant_id).toBe(5);
    // `product_variant_id` ya se preservaba; A.6 solo exige que no se regrese.
    expect(splitCreate.mock.calls[0][0].data.quantity).toBe(1);
    expect(res.orderItemIds).toContain(20);
    const remapped = res.exclusions.find(
      (e: any) => e.order_item_id === 20,
    );
    expect(remapped).toEqual({ order_item_id: 20, component_product_ids: [99] });
  });

  // --------------------------------------------------------------------------
  // CP-POLLO-ARABE-727 C.5 — regresión cruzada QUI-655 (exclusiones/split) ×
  // QUI-736 (variantes). Matriz conceptual 2×2×2: {con variante, sin variante}
  // × {con exclusión, sin exclusión} × {línea partida, línea entera}. Se
  // colapsa a 6 casos reales porque la línea SOLO se parte cuando la exclusión
  // es PARCIAL (`applies_to_units < quantity`): total o ausente ⇒ línea entera.
  // La invariante del cruce: cada fragmento hereda SIEMPRE la misma variante
  // (o su NULL) que la línea madre — jamás la pierde ni inventa una.
  // --------------------------------------------------------------------------
  it.each([
    // label                                                | variantId | variantName | variantCount | appliesTo | expectSplit
    ['con variante · sin exclusión · línea entera',          5,     'Picante', 2,   null, false],
    ['con variante · con exclusión total · línea entera',    5,     'Picante', 2,   3,    false],
    ['con variante · con exclusión parcial · línea partida', 5,     'Picante', 2,   1,    true],
    ['sin variante · sin exclusión · línea entera',          null,  null,      0,   null, false],
    ['sin variante · con exclusión total · línea entera',    null,  null,      0,   3,    false],
    ['sin variante · con exclusión parcial · línea partida', null,  null,      0,   1,    true],
  ])(
    'C.5 — %s preserva la variante de la línea madre',
    async (
      _label,
      variantId,
      variantName,
      variantCount,
      appliesTo,
      expectSplit,
    ) => {
      const original = {
        ...makeVariantOrderItem(10, 50, {
          variantId,
          variantName,
          quantity: 3,
          variantCount,
        }),
        unit_price: 20,
        total_price: 60,
        item_type: 'physical',
        cost_price: 10,
        is_price_overridden: false,
        inventory_committed: false,
        is_takeaway: false,
        notes: null,
        skip_kds: false,
        split_from_order_item_id: null,
      };
      prismaMock.order_items.findMany.mockResolvedValue([original]);
      const splitCreate = jest.fn().mockResolvedValue({ id: 20 });
      const splitUpdate = jest.fn().mockResolvedValue({});
      prismaMock.$transaction.mockImplementation(async (cb: any) =>
        cb({ order_items: { update: splitUpdate, create: splitCreate } }),
      );

      const exclusions =
        appliesTo != null
          ? [
              {
                order_item_id: 10,
                component_product_ids: [99],
                applies_to_units: appliesTo,
              },
            ]
          : [];

      const res = await (service as any).splitLinesForExclusions({
        order_id: 100,
        order_item_ids: [10],
        exclusions,
      });

      if (expectSplit) {
        // La línea se partió: el fragmento NUEVO (lleva la exclusión) hereda la
        // variante de la madre. `variant_label` se deriva al fire; aquí solo se
        // garantiza que `product_variant_id` sobrevive al split.
        expect(splitCreate).toHaveBeenCalledTimes(1);
        expect(splitCreate.mock.calls[0][0].data.product_variant_id).toBe(
          variantId ?? null,
        );
        expect(splitCreate.mock.calls[0][0].data.quantity).toBe(appliesTo);
        // El fragmento ORIGINAL se redujo y conserva su variante (el update no
        // la toca), así que AMBOS fragmentos la llevan.
        expect(splitUpdate).toHaveBeenCalledTimes(1);
        expect(splitUpdate.mock.calls[0][0].where.id).toBe(10);
        expect(
          (res.exclusions as any[]).find((e: any) => e.order_item_id === 20),
        ).toEqual({
          order_item_id: 20,
          component_product_ids: [99],
        });
      } else {
        // Línea entera: no se parte, no se crea fragmento nuevo.
        expect(splitCreate).not.toHaveBeenCalled();
        expect(splitUpdate).not.toHaveBeenCalled();
      }
    },
  );

  it('throws PRODUCT_VARIANT_MISMATCH when the variant does not belong to the product', async () => {
    prismaMock.orders.findFirst.mockResolvedValue({
      id: 100,
      store_id: 1,
      order_number: 'ORD-MM',
      order_items: [
        makeVariantOrderItem(10, 50, {
          variantId: 5,
          variantName: 'Ajeno',
          variantProductId: 999,
          variantCount: 2,
        }),
      ],
    });

    await expect(
      service.fireOrderItems({ order_id: 100, order_item_ids: [10] }),
    ).rejects.toMatchObject({ errorCode: 'PRODUCT_VARIANT_MISMATCH' });

    // La validación ocurre ANTES de abrir la transacción.
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('updates order_items notes and passes notes to kitchen_ticket_items when item_notes are provided', async () => {
    const item = makeOrderItem(10, 50, 'prepared', false);
    setupFireableContext([item]);

    const txMock = buildFireTxMock({ orderItemId: 10 });
    const createMock = jest.fn().mockResolvedValue(makeTxTicket(77, 10, 50));
    (txMock as any).kitchen_tickets = {
      count: jest.fn().mockResolvedValue(0),
      create: createMock,
    };
    prismaMock.$transaction.mockImplementation((cb: any) => cb(txMock));

    const result = await service.fireOrderItems({
      order_id: 100,
      order_item_ids: [10],
      item_notes: [{ order_item_id: 10, notes: 'Sin cebolla, bien cocido' }],
    });

    expect(result.kitchen_ticket_id).toBe(77);
    expect(txMock.order_items.updateMany).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { notes: 'Sin cebolla, bien cocido', updated_at: expect.any(Date) },
    });
    expect(txMock.kitchen_ticket_items.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { notes: 'Sin cebolla, bien cocido', updated_at: expect.any(Date) },
    });
  });

  // --------------------------------------------------------------------------
  // Recetas-por-variante (paso 5) — consumo a cocina por variante: dos líneas
  // del mismo plato con distinta variante consumen BOM distintos en el mismo
  // disparo; sin receta propia la variante cae a la base (compatibilidad); sin
  // ninguna la línea sigue «sin receta» (Fase K, ya cubierto arriba).
  // --------------------------------------------------------------------------

  it('paso 5 — two lines of the same product with different variants explode different BOMs', async () => {
    prismaMock.orders.findFirst.mockResolvedValue({
      id: 100,
      store_id: 1,
      order_number: 'ORD-P5',
      order_items: [
        makeVariantOrderItem(10, 50, {
          variantId: 5,
          variantName: 'Picante',
          variantCount: 2,
        }),
        makeVariantOrderItem(11, 50, {
          variantId: 6,
          variantName: 'No Picante',
          variantCount: 2,
        }),
      ],
    });
    prismaMock.recipes.findMany.mockResolvedValue([
      { id: 7, product_id: 50, product_variant_id: 5, is_active: true },
      { id: 8, product_id: 50, product_variant_id: 6, is_active: true },
    ]);
    // BOM distintos por variante: Picante lleva el insumo exclusivo 201,
    // No Picante solo el compartido 202.
    recipesService.explodeBom.mockImplementation(async (recipeId: number) => {
      if (recipeId === 7) {
        return [
          {
            component_product_id: 201,
            quantity: 2,
            depth: 1,
            path_recipe_ids: [7],
          },
        ];
      }
      return [
        {
          component_product_id: 202,
          quantity: 3,
          depth: 1,
          path_recipe_ids: [8],
        },
      ];
    });
    stockLevelManager.getDefaultLocationForProduct.mockResolvedValue(1);
    stockLevelManager.updateStock.mockResolvedValue({
      cost_snapshot: { total_cost: 100 },
    } as any);
    const ticketCreate = setupFireTransaction(10);

    const result = await service.fireOrderItems({
      order_id: 100,
      order_item_ids: [10, 11],
    });

    // Cada variante explotó SU receta (una explosión por recipe_id).
    expect(recipesService.explodeBom).toHaveBeenCalledTimes(2);
    const explodedIds = recipesService.explodeBom.mock.calls.map(
      (c) => c[0] as number,
    );
    expect(explodedIds.sort()).toEqual([7, 8]);
    // El insumo exclusivo de Picante se movió UNA sola vez (qty 2 × 2 uds),
    // y el de No Picante otra (qty 3 × 2 uds). Contar las filas, no el 201.
    expect(stockLevelManager.updateStock).toHaveBeenCalledTimes(2);
    const movements = stockLevelManager.updateStock.mock.calls.map(
      (c) => ({
        product_id: c[0].product_id as number,
        quantity_change: c[0].quantity_change as number,
      }),
    );
    expect(movements).toContainEqual({ product_id: 201, quantity_change: -4 });
    expect(movements).toContainEqual({ product_id: 202, quantity_change: -6 });
    expect(result.fired_item_ids).toEqual([10, 11]);
    expect(result.skipped_item_ids).toEqual([]);
    expect(ticketCreate).toHaveBeenCalledTimes(1);
  });

  it('paso 5 — variant without its own recipe falls back to the product base recipe', async () => {
    setupFireableContext(
      [
        makeVariantOrderItem(10, 50, {
          variantId: 6,
          variantName: 'No Picante',
          variantCount: 2,
        }),
      ],
      {
        recipe: {
          id: 7,
          product_id: 50,
          product_variant_id: null,
          is_active: true,
        },
        bom: [
          {
            component_product_id: 201,
            quantity: 2,
            depth: 1,
            path_recipe_ids: [7],
          },
        ],
      },
    );
    setupFireTransaction(10);

    const result = await service.fireOrderItems({
      order_id: 100,
      order_item_ids: [10],
    });

    // La variante consumió la receta base heredada: no es «sin receta».
    expect(recipesService.explodeBom).toHaveBeenCalledTimes(1);
    expect(recipesService.explodeBom.mock.calls[0][0]).toBe(7);
    expect(stockLevelManager.updateStock).toHaveBeenCalledTimes(1);
    expect(stockLevelManager.updateStock.mock.calls[0][0]).toMatchObject({
      product_id: 201,
      quantity_change: -4,
    });
    expect(result.fired_item_ids).toEqual([10]);
  });

  // --------------------------------------------------------------------------
  // Plan recetas-kds paso 2 — `startPreparation` re-resuelve contra la tabla
  // FRESCA (`is_active=true`, exacta→base→null por par): un ticket atascado se
  // libera tras reactivar/crear sin re-fire; entregar/cancelar nunca se
  // bloquean por falta de receta (solo `pending → in_preparation` se bloquea).
  // --------------------------------------------------------------------------
  describe('paso 2 — startPreparation contra recetas frescas (desatascar ticket)', () => {
    const makeTicketItem = (
      id: number,
      productId: number,
      variantId: number | null = null,
    ) => ({
      id,
      product_id: productId,
      product_variant_id: variantId,
      // Snapshot viejo del ticket: la receta figuraba inactiva al firear.
      // `startPreparation` debe IGNORARLO y mandar la tabla fresca.
      product: {
        recipes: [{ id: 7, is_active: false, product_variant_id: null }],
      },
      // Paso 3 — `KITCHEN_TICKET_INCLUDE` siempre trae
      // `order_item.is_takeaway`; el mock lo refleja para que
      // `markDelivered` no rechace por takeaway en estos tests.
      order_item: { is_takeaway: true },
    });
    const makeTicket = (status: string, items: any[]) => ({
      id: 555,
      store_id: 1,
      order_id: 100,
      kds_id: 1,
      status,
      items,
    });

    beforeEach(() => {
      (service as any).kdsSessionsService = {
        assertCanMutateStationTicket: jest.fn().mockResolvedValue(undefined),
        attributeOpenSessionToTicketConsumption: jest
          .fn()
          .mockResolvedValue(undefined),
      };
      prismaMock.kitchen_tickets = {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      };
      prismaMock.kitchen_ticket_items = {
        updateMany: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      };
      prismaMock.order_items.updateMany = jest
        .fn()
        .mockResolvedValue({ count: 1 });
      // B16 (release-855): `markDelivered` now queries `table_sessions`.
      // Default (no open session) matches this block's counter-style
      // fixtures — the takeaway guard must not apply here.
      prismaMock.table_sessions = { findFirst: jest.fn() };
    });

    const setupStartTx = () => {
      prismaMock.$transaction.mockImplementation(async (cb: any) =>
        cb({
          kitchen_tickets: {
            update: jest.fn().mockResolvedValue({}),
          },
          kitchen_ticket_items: {
            updateMany: jest.fn().mockResolvedValue({}),
          },
        }),
      );
    };

    it('libera el ticket atascado tras reactivar: el snapshot viejo decía inactiva pero la tabla fresca manda', async () => {
      prismaMock.kitchen_tickets.findFirst.mockResolvedValue(
        makeTicket('pending', [makeTicketItem(11, 50)]),
      );
      // Tabla FRESCA: la receta se reactivó DESPUÉS del fire.
      prismaMock.recipes.findMany.mockResolvedValue([
        { id: 7, product_id: 50, product_variant_id: null, is_active: true },
      ]);
      setupStartTx();

      const result = await service.startPreparation(555);

      expect(prismaMock.recipes.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { product_id: { in: [50] }, is_active: true },
        }),
      );
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ id: 555 });
    });

    it('conserva KITCHEN_TICKET_NO_RECIPE con recipe_less_item_ids + hint cuando de verdad no hay activa', async () => {
      prismaMock.kitchen_tickets.findFirst.mockResolvedValue(
        makeTicket('pending', [makeTicketItem(11, 50)]),
      );
      prismaMock.recipes.findMany.mockResolvedValue([]);

      const err = await service.startPreparation(555).catch((e) => e);
      expect(err).toMatchObject({ errorCode: 'KITCHEN_TICKET_NO_RECIPE' });
      const body = (err as any).getResponse?.() ?? {};
      expect(body.details).toMatchObject({
        ticket_id: 555,
        recipe_less_item_ids: [11],
      });
      expect(body.details.hint).toMatch(/receta activa/);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('variante disparada sin product_variant_id resuelve la receta base', async () => {
      prismaMock.kitchen_tickets.findFirst.mockResolvedValue(
        makeTicket('pending', [makeTicketItem(11, 50, null)]),
      );
      prismaMock.recipes.findMany.mockResolvedValue([
        { id: 7, product_id: 50, product_variant_id: null, is_active: true },
      ]);
      setupStartTx();

      await service.startPreparation(555);

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });

    it('variante sin receta propia cae a la base (compatibilidad pre-variantes)', async () => {
      prismaMock.kitchen_tickets.findFirst.mockResolvedValue(
        makeTicket('pending', [makeTicketItem(11, 50, 6)]),
      );
      prismaMock.recipes.findMany.mockResolvedValue([
        { id: 7, product_id: 50, product_variant_id: null, is_active: true },
      ]);
      setupStartTx();

      await service.startPreparation(555);

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });

    it('variante con receta exacta propia pasa aunque solo exista esa', async () => {
      prismaMock.kitchen_tickets.findFirst.mockResolvedValue(
        makeTicket('pending', [makeTicketItem(11, 50, 5)]),
      );
      prismaMock.recipes.findMany.mockResolvedValue([
        { id: 8, product_id: 50, product_variant_id: 5, is_active: true },
      ]);
      setupStartTx();

      await service.startPreparation(555);

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });

    it('entregar/cancelar nunca se bloquean por falta de receta', async () => {
      // Entregar: ticket en ready SIN receta activa en la tabla fresca.
      prismaMock.kitchen_tickets.findFirst.mockResolvedValue(
        makeTicket('ready', [makeTicketItem(11, 50)]),
      );
      prismaMock.kitchen_ticket_items.findMany.mockResolvedValue([
        { order_item_id: 10 },
      ]);
      prismaMock.kitchen_tickets.findMany.mockResolvedValue([
        { status: 'delivered' },
      ]);

      await service.markDelivered(555);

      expect(prismaMock.recipes.findMany).not.toHaveBeenCalled();

      // Cancelar: ticket en pending SIN receta activa en la tabla fresca.
      prismaMock.kitchen_tickets.findFirst.mockResolvedValue(
        makeTicket('pending', [makeTicketItem(11, 50)]),
      );
      prismaMock.$transaction.mockImplementation(async (cb: any) =>
        cb({
          $queryRaw: jest.fn().mockResolvedValue([{ id: 100, state: 'processing' }]),
          kitchen_tickets: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          audit_logs: { findFirst: jest.fn().mockResolvedValue(null) },
          inventory_transactions: { findMany: jest.fn().mockResolvedValue([]) },
          kitchen_ticket_items: {
            updateMany: jest.fn().mockResolvedValue({}),
          },
          order_items: { findMany: jest.fn().mockResolvedValue([]) },
        }),
      );

      await service.cancelTicket(555);

      expect(prismaMock.recipes.findMany).not.toHaveBeenCalled();
    });

    it('markReady desde pending NO aplica el guard de receta: es la única salida del plato sin receta hacia la entrega', async () => {
      // `markDelivered` rechaza `pending` y `deliverOrderItem` exige `ready`
      // para un `prepared`: si `ready` también bloqueara, el plato quedaría
      // atascado (solo cancelable).
      prismaMock.kitchen_tickets.findFirst.mockResolvedValue(
        makeTicket('pending', [makeTicketItem(11, 50)]),
      );
      prismaMock.recipes.findMany.mockResolvedValue([]);
      setupStartTx();

      const result = await service.markReady(555);

      expect(result).toMatchObject({ id: 555 });
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(prismaMock.recipes.findMany).not.toHaveBeenCalled();
    });

    it('el plato sin receta en pending sigue sin poder entregarse directo (KITCHEN_TICKET_NOT_READY)', async () => {
      prismaMock.kitchen_tickets.findFirst.mockResolvedValue(
        makeTicket('pending', [makeTicketItem(11, 50)]),
      );

      await expect(service.markDelivered(555)).rejects.toMatchObject({
        errorCode: 'KITCHEN_TICKET_NOT_READY',
      });
    });
  });

  describe('pasos 1+3 — puente compartido y entrega solo takeaway', () => {
    const takeawayItem = (
      id: number,
      takeaway: boolean,
      status = 'ready',
    ) => ({
      id,
      order_item_id: 10 + id,
      product_id: 50,
      status,
      order_item: { is_takeaway: takeaway },
    });
    const makeTicket = (status: string, items: any[]) => ({
      id: 555,
      store_id: 1,
      order_id: 100,
      kds_id: 1,
      status,
      items,
    });

    beforeEach(() => {
      (service as any).kdsSessionsService = {
        assertCanMutateStationTicket: jest.fn().mockResolvedValue(undefined),
        attributeOpenSessionToTicketConsumption: jest
          .fn()
          .mockResolvedValue(undefined),
      };
      prismaMock.kitchen_tickets = {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      };
      prismaMock.kitchen_ticket_items = {
        updateMany: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      };
      prismaMock.order_items.updateMany = jest
        .fn()
        .mockResolvedValue({ count: 1 });
      // B16 (release-855): `markDelivered` now queries `table_sessions` to
      // scope the takeaway-only guard to orders with an OPEN table session.
      // Default (no open session) — tests that don't call
      // `.mockResolvedValue(...)` on it exercise the counter/delivery path
      // where the guard must NOT apply. Tests naming "ticket de mesa" set
      // an explicit open session below.
      prismaMock.table_sessions = { findFirst: jest.fn() };
    });

    const setupCancelTx = () => {
      prismaMock.$transaction.mockImplementation(async (cb: any) =>
        cb({
          $queryRaw: jest.fn().mockResolvedValue([{ id: 100, state: 'processing' }]),
          kitchen_tickets: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            // H2 — `findTicketConsumedLeaves` reads the ticket's own `fired_at`.
            findFirst: jest.fn().mockResolvedValue({ fired_at: new Date('2026-01-01T00:00:00Z') }),
          },
          audit_logs: { findFirst: jest.fn().mockResolvedValue(null) },
          inventory_transactions: { findMany: jest.fn().mockResolvedValue([]) },
          kitchen_ticket_items: {
            updateMany: jest.fn().mockResolvedValue({}),
            // H2 — no sibling tickets for this order_item_id in this harness.
            findMany: jest.fn().mockResolvedValue([]),
          },
          order_items: { findMany: jest.fn().mockResolvedValue([]) },
        }),
      );
    };

    it('paso 1 — cancelar el último ticket pendiente emite kitchen.order_all_delivered', async () => {
      prismaMock.kitchen_tickets.findFirst.mockResolvedValue(
        makeTicket('pending', [takeawayItem(11, true, 'pending')]),
      );
      setupCancelTx();
      // El otro ticket de la orden ya fue entregado; este cancel deja
      // todos terminal con ≥1 delivered y cierra el handoff.
      prismaMock.kitchen_tickets.findMany.mockResolvedValue([
        { status: 'delivered' },
        { status: 'cancelled' },
      ]);

      await service.cancelTicket(555);

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'kitchen.order_all_delivered',
        { orderId: 100, storeId: 1 },
      );
    });

    it('paso 1 — cancelar sin completar el handoff no emite el puente', async () => {
      prismaMock.kitchen_tickets.findFirst.mockResolvedValue(
        makeTicket('pending', [takeawayItem(11, true, 'pending')]),
      );
      setupCancelTx();
      // Queda otro ticket pendiente: el handoff sigue abierto.
      prismaMock.kitchen_tickets.findMany.mockResolvedValue([
        { status: 'pending' },
        { status: 'cancelled' },
      ]);

      await service.cancelTicket(555);

      expect(eventEmitter.emit).not.toHaveBeenCalledWith(
        'kitchen.order_all_delivered',
        expect.anything(),
      );
    });

    it('paso 3 — ticket 100 % takeaway se entrega y evalúa el puente', async () => {
      prismaMock.kitchen_tickets.findFirst.mockResolvedValue(
        makeTicket('ready', [takeawayItem(11, true), takeawayItem(12, true)]),
      );
      prismaMock.kitchen_ticket_items.findMany.mockResolvedValue([
        { order_item_id: 21 },
        { order_item_id: 22 },
      ]);
      prismaMock.kitchen_tickets.findMany.mockResolvedValue([
        { status: 'delivered' },
      ]);

      const result = await service.markDelivered(555);

      expect(result).toMatchObject({ id: 555 });
      expect(prismaMock.kitchen_tickets.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 555 } }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'kitchen.order_all_delivered',
        { orderId: 100, storeId: 1 },
      );
    });

    it('paso 3 — ticket de mesa se bloquea completo con KITCHEN_TICKET_NOT_TAKEAWAY', async () => {
      prismaMock.kitchen_tickets.findFirst.mockResolvedValue(
        makeTicket('ready', [takeawayItem(11, false), takeawayItem(12, false)]),
      );
      // B16 (release-855): the guard only applies with an OPEN table session.
      prismaMock.table_sessions.findFirst.mockResolvedValue({ id: 9 });

      const err = await service.markDelivered(555).catch((e) => e);

      expect(err).toMatchObject({ errorCode: 'KITCHEN_TICKET_NOT_TAKEAWAY' });
      const body = (err as any).getResponse?.() ?? {};
      expect((err as VendixHttpException).getStatus()).toBe(422);
      expect(body.message).toContain('Entrégalos desde la mesa');
      expect(body.details).toMatchObject({
        hint: 'Solo los platos para llevar se entregan en cocina',
      });
      expect(prismaMock.kitchen_tickets.update).not.toHaveBeenCalled();
      expect(
        prismaMock.kitchen_ticket_items.updateMany,
      ).not.toHaveBeenCalled();
    });

    it('paso 3 — ticket mixto (una fila no-takeaway) se bloquea completo', async () => {
      prismaMock.kitchen_tickets.findFirst.mockResolvedValue(
        makeTicket('ready', [takeawayItem(11, true), takeawayItem(12, false)]),
      );
      // B16 (release-855): the guard only applies with an OPEN table session.
      prismaMock.table_sessions.findFirst.mockResolvedValue({ id: 9 });

      const err = await service.markDelivered(555).catch((e) => e);

      expect(err).toMatchObject({ errorCode: 'KITCHEN_TICKET_NOT_TAKEAWAY' });
      expect(prismaMock.kitchen_tickets.update).not.toHaveBeenCalled();
      expect(
        prismaMock.kitchen_ticket_items.updateMany,
      ).not.toHaveBeenCalled();
    });

    it('B16 (release-855) — mostrador/domicilio sin sesión de mesa: cocina entrega aunque no haya is_takeaway', async () => {
      // Sin sesión de mesa abierta, cocina es la ÚNICA superficie de
      // entrega — el guard de "solo takeaway" no debe bloquear un pedido de
      // mostrador cuyas líneas nunca llevaron `is_takeaway=true` estampado.
      prismaMock.kitchen_tickets.findFirst.mockResolvedValue(
        makeTicket('ready', [takeawayItem(11, false), takeawayItem(12, false)]),
      );
      prismaMock.table_sessions.findFirst.mockResolvedValue(null);
      prismaMock.kitchen_ticket_items.findMany.mockResolvedValue([
        { order_item_id: 21 },
        { order_item_id: 22 },
      ]);
      prismaMock.kitchen_tickets.findMany.mockResolvedValue([
        { status: 'delivered' },
      ]);

      const result = await service.markDelivered(555);

      expect(result).toMatchObject({ id: 555 });
      expect(prismaMock.kitchen_tickets.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 555 } }),
      );
    });

    it('paso 3 — fila cancelada no-takeaway no bloquea la entrega', async () => {
      prismaMock.kitchen_tickets.findFirst.mockResolvedValue(
        makeTicket('ready', [
          takeawayItem(11, false, 'cancelled'),
          takeawayItem(12, true),
        ]),
      );
      prismaMock.kitchen_ticket_items.findMany.mockResolvedValue([
        { order_item_id: 22 },
      ]);
      prismaMock.kitchen_tickets.findMany.mockResolvedValue([
        { status: 'delivered' },
      ]);

      const result = await service.markDelivered(555);

      expect(result).toMatchObject({ id: 555 });
      expect(prismaMock.kitchen_tickets.update).toHaveBeenCalled();
    });
  });

  describe('C.2 — revertTicket delivery stamp invariant', () => {
    const lines: Array<{
      id: number;
      orderId: number;
      ticketId: number;
      deliveredAt: Date | null;
      deliveredBy: number | null;
    }> = [
      { id: 21, orderId: 100, ticketId: 555, deliveredAt: new Date(), deliveredBy: 42 },
      { id: 22, orderId: 100, ticketId: 556, deliveredAt: new Date(), deliveredBy: 42 },
    ];
    let ticketStatus: string;
    let tx: any;

    beforeEach(() => {
      ticketStatus = 'delivered';
      for (const line of lines) {
        line.deliveredAt = new Date();
        line.deliveredBy = 42;
      }
      (service as any).kdsSessionsService = {
        assertCanMutateStationTicket: jest.fn().mockResolvedValue(undefined),
      };
      prismaMock.kitchen_tickets = {
        findFirst: jest.fn().mockImplementation(async () => ({
          id: 555,
          store_id: 1,
          order_id: 100,
          kds_id: 1,
          status: ticketStatus,
          items: [],
        })),
      };
      prismaMock.orders.findFirst.mockResolvedValue({ state: 'delivered' });
      tx = {
        kitchen_tickets: {
          update: jest.fn().mockImplementation(async ({ data }: any) => {
            ticketStatus = data.status;
          }),
        },
        kitchen_ticket_items: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        order_items: {
          updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
            // Model the Prisma relation filter, not a global order_id update.
            for (const line of lines) {
              if (line.ticketId === where.kitchen_ticket_items?.some?.kitchen_ticket_id &&
                  line.deliveredAt != null) {
                line.deliveredAt = data.delivered_at;
                line.deliveredBy = data.delivered_by_user_id;
              }
            }
            return { count: 1 };
          }),
        },
      };
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
    });

    it('clears only this delivered ticket’s line stamps inside the ticket transaction, then emits the reversal', async () => {
      await service.revertTicket(555);

      // H1 — a 'delivered' ticket is not the 'cancelled' full-ticket case, so
      // the item revert excludes any line that was individually cancelled
      // (`cancelTicketItemInTx`) instead of resurrecting it.
      expect(tx.kitchen_ticket_items.updateMany).toHaveBeenCalledWith({
        where: { kitchen_ticket_id: 555, status: { not: 'cancelled' } },
        data: { status: 'ready', updated_at: expect.any(Date) },
      });
      expect(tx.order_items.updateMany).toHaveBeenCalledWith({
        where: {
          kitchen_ticket_items: { some: { kitchen_ticket_id: 555 } },
          delivered_at: { not: null },
        },
        data: {
          delivered_at: null,
          delivered_by_user_id: null,
          updated_at: expect.any(Date),
        },
      });
      expect(lines[0]).toMatchObject({ deliveredAt: null, deliveredBy: null });
      expect(lines[1].deliveredAt).toBeInstanceOf(Date);
      expect(lines[1].deliveredBy).toBe(42);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'kitchen.order_delivery_reverted',
        { orderId: 100, storeId: 1 },
      );
    });

    it('does not erase a dispatch/single-line stamp on non-delivered ticket reversals', async () => {
      ticketStatus = 'ready';
      await service.revertTicket(555);

      expect(tx.order_items.updateMany).not.toHaveBeenCalled();
      expect(lines[0].deliveredAt).toBeInstanceOf(Date);
      expect(eventEmitter.emit).not.toHaveBeenCalledWith(
        'kitchen.order_delivery_reverted',
        expect.anything(),
      );
    });

    it('rejects finished orders without clearing any line or starting a transaction', async () => {
      prismaMock.orders.findFirst.mockResolvedValue({ state: 'finished' });

      await expect(service.revertTicket(555)).rejects.toMatchObject({
        errorCode: 'KITCHEN_TICKET_REVERT_ORDER_FINISHED',
      });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(lines[0].deliveredAt).toBeInstanceOf(Date);
    });
  });

  describe('H1/H4 — cancelled-line isolation on delivery/revert and cross-path revert guard', () => {
    it('H1 — markDelivered excludes a KDS-cancelled line from delivered status and from delivered_at', async () => {
      (service as any).kdsSessionsService = {
        assertCanMutateStationTicket: jest.fn().mockResolvedValue(undefined),
        attributeOpenSessionToTicketConsumption: jest.fn().mockResolvedValue(undefined),
      };
      prismaMock.kitchen_tickets = {
        findFirst: jest.fn().mockResolvedValue({
          id: 555, store_id: 1, order_id: 100, kds_id: 1, status: 'ready',
          items: [
            { id: 11, order_item_id: 21, status: 'cancelled', order_item: { is_takeaway: false } },
            { id: 12, order_item_id: 22, status: 'ready', order_item: { is_takeaway: false } },
          ],
        }),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([{ status: 'delivered' }]),
      };
      prismaMock.kitchen_ticket_items = {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        // Only the non-cancelled line (order_item_id 22) comes back — the
        // cancelled one (21) must never be selected for the delivered_at stamp.
        findMany: jest.fn().mockResolvedValue([{ order_item_id: 22 }]),
      };
      prismaMock.order_items = {
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      };
      prismaMock.table_sessions = { findFirst: jest.fn().mockResolvedValue(null) };

      await service.markDelivered(555);

      expect(prismaMock.kitchen_ticket_items.updateMany).toHaveBeenCalledWith({
        where: { kitchen_ticket_id: 555, status: { notIn: ['delivered', 'cancelled'] } },
        data: { status: 'delivered', updated_at: expect.any(Date) },
      });
      expect(prismaMock.kitchen_ticket_items.findMany).toHaveBeenCalledWith({
        where: { kitchen_ticket_id: 555, status: { not: 'cancelled' } },
        select: { order_item_id: true },
      });
      expect(prismaMock.order_items.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [22] }, delivered_at: null },
        data: expect.objectContaining({ delivered_at: expect.any(Date) }),
      });
    });

    it('H1 — revertTicket does not resurrect a line cancelled individually via cancelTicketItemInTx', async () => {
      const items = [
        { id: 11, order_item_id: 21, status: 'cancelled' },
        { id: 12, order_item_id: 22, status: 'delivered' },
      ];
      (service as any).kdsSessionsService = {
        assertCanMutateStationTicket: jest.fn().mockResolvedValue(undefined),
      };
      prismaMock.kitchen_tickets = {
        findFirst: jest.fn().mockResolvedValue({
          id: 555, store_id: 1, order_id: 100, kds_id: 1, status: 'delivered', items,
        }),
      };
      prismaMock.orders = { findFirst: jest.fn().mockResolvedValue({ state: 'delivered' }) };
      const tx = {
        kitchen_tickets: { update: jest.fn().mockResolvedValue({}) },
        kitchen_ticket_items: {
          // Models Prisma's real filtering semantics against the `items` array
          // so the assertion proves BEHAVIOR, not just the call args.
          updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
            let count = 0;
            for (const item of items) {
              if (where.status?.not === 'cancelled' && item.status === 'cancelled') continue;
              item.status = data.status;
              count++;
            }
            return { count };
          }),
        },
        order_items: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };
      prismaMock.$transaction = jest.fn((cb: any) => cb(tx));

      await service.revertTicket(555);

      expect(items.find((i) => i.order_item_id === 21)!.status).toBe('cancelled');
      expect(items.find((i) => i.order_item_id === 22)!.status).toBe('ready');
    });

    it('H4 — revertTicket is blocked when the order-cancellation path already recorded THIS ticket\'s disposition', async () => {
      (service as any).kdsSessionsService = {
        assertCanMutateStationTicket: jest.fn().mockResolvedValue(undefined),
      };
      prismaMock.kitchen_tickets = {
        findFirst: jest.fn().mockResolvedValue({
          id: 555, store_id: 1, order_id: 100, kds_id: 1, status: 'cancelled',
          items: [{ id: 11, order_item_id: 77, status: 'cancelled' }],
        }),
      };
      // Written by `OrderFlowService.auditPreparedDispositionInTx` (order
      // cancellation side), now carrying `ticket_id` per the H4 fix.
      prismaMock.audit_logs = {
        findMany: jest.fn().mockResolvedValue([
          { metadata: { order_id: 100, order_item_id: 77, ticket_id: 555, destination: 'waste' } },
        ]),
      };

      const err = await service.revertTicket(555).catch((e: any) => e);

      expect(err).toMatchObject({ errorCode: 'KITCHEN_TICKET_CANNOT_REVERT' });
      expect(prismaMock.audit_logs.findMany).toHaveBeenCalledWith({
        where: {
          action: 'order_item.prepared_disposition',
          resource_id: 100,
          OR: [{ metadata: { path: ['order_item_id'], equals: 77 } }],
        },
        select: { metadata: true },
      });
    });

    it('revertTicket de un ticket cancelado se bloquea si su línea ya está cancelada en la orden', async () => {
      (service as any).kdsSessionsService = {
        assertCanMutateStationTicket: jest.fn().mockResolvedValue(undefined),
      };
      prismaMock.kitchen_tickets = {
        findFirst: jest.fn().mockResolvedValue({
          id: 555, store_id: 1, order_id: 100, kds_id: 1, status: 'cancelled',
          items: [{ id: 11, order_item_id: 77, status: 'cancelled' }],
        }),
      };
      prismaMock.audit_logs = { findMany: jest.fn().mockResolvedValue([]) };
      prismaMock.order_items.count = jest.fn().mockResolvedValue(1);
      prismaMock.$transaction = jest.fn();

      const err = await service.revertTicket(555).catch((e: any) => e);

      expect(err).toMatchObject({ errorCode: 'KITCHEN_TICKET_INVALID_STATE' });
      expect(prismaMock.order_items.count).toHaveBeenCalledWith({
        where: { id: { in: [77] }, order_id: 100, cancelled_at: { not: null } },
      });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('H4 — a disposition tagged with a DIFFERENT ticket_id does not block reverting this ticket', async () => {
      (service as any).kdsSessionsService = {
        assertCanMutateStationTicket: jest.fn().mockResolvedValue(undefined),
      };
      prismaMock.kitchen_tickets = {
        findFirst: jest.fn().mockResolvedValue({
          id: 555, store_id: 1, order_id: 100, kds_id: 1, status: 'cancelled',
          items: [{ id: 11, order_item_id: 77, status: 'cancelled' }],
        }),
      };
      // Belongs to a sibling ticket (999) of the same order_item_id — must
      // NOT block THIS ticket's revert.
      prismaMock.audit_logs = {
        findMany: jest.fn().mockResolvedValue([
          { metadata: { order_id: 100, order_item_id: 77, ticket_id: 999, destination: 'waste' } },
        ]),
      };
      prismaMock.orders = { findFirst: jest.fn().mockResolvedValue({ state: 'processing' }) };
      // Ticket legado: ninguna línea cancelada en la orden.
      prismaMock.order_items.count = jest.fn().mockResolvedValue(0);
      const tx = {
        kitchen_tickets: { update: jest.fn().mockResolvedValue({}) },
        kitchen_ticket_items: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        order_items: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      };
      prismaMock.$transaction = jest.fn((cb: any) => cb(tx));

      await service.revertTicket(555);

      expect(tx.kitchen_tickets.update).toHaveBeenCalledWith({
        where: { id: 555 }, data: { status: 'ready', updated_at: expect.any(Date) },
      });
    });
  });

  describe('no-overselling ingredient guard (docs/plans/no-overselling-stock-guard-plan.md, step 6)', () => {
    it('rejects an insufficient tracked ingredient BEFORE opening the transaction — no stock movement, no ticket', async () => {
      setupFireableContext([makeOrderItem(10, 50, 'prepared', false)]);

      const insufficiencyError = new VendixHttpException(
        ErrorCodes.INV_STOCK_INSUFFICIENT_LINES,
        'Insumo sin stock suficiente: Harina (requerido 2, disponible 1).',
        {
          items: [
            {
              product_id: 201,
              product_variant_id: null,
              product_name: 'Harina',
              kind: 'ingredient',
              requested: 2,
              available: 1,
              used_by: ['Plato 10'],
            },
          ],
        },
      );
      stockValidatorService.assertIngredientsAvailable.mockRejectedValueOnce(
        insufficiencyError,
      );

      let caught: any;
      try {
        await service.fireOrderItems({ order_id: 100, order_item_ids: [10] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      expect(caught.errorCode).toBe('INV_STOCK_INSUFFICIENT_LINES');
      expect(caught.getResponse()).toMatchObject({
        details: {
          items: [expect.objectContaining({ kind: 'ingredient' })],
        },
      });

      // Nothing was consumed and no transaction was even opened — the
      // check runs BEFORE `fireOrderItems` calls `this.prisma.$transaction`.
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    });

    it('consumes normally once the guard resolves (untracked ingredient / sufficient stock)', async () => {
      setupFireableContext([makeOrderItem(10, 50, 'prepared', false)]);
      setupFireTransaction(10);

      const result = await service.fireOrderItems({
        order_id: 100,
        order_item_ids: [10],
      });

      // The guard ran once, BEFORE the transaction, with the exploded BOM
      // demand — and resolved (an untracked ingredient / sufficient stock is
      // the validator's call, kitchen-fire only trusts its verdict).
      expect(stockValidatorService.assertIngredientsAvailable).toHaveBeenCalledTimes(1);
      expect(stockValidatorService.assertIngredientsAvailable).toHaveBeenCalledWith(
        [expect.objectContaining({ product_id: 201, used_by: 'Plato 10' })],
        // Plan step 9 — the pre-check now also carries the store's resolved
        // "Permitir sobre-uso de insumos" policy alongside the demand array.
        expect.objectContaining({ allowIngredientOveruse: expect.any(Boolean) }),
      );

      // Consumption still happens — the guard passing does not short-circuit
      // the real per-leaf `updateStock` call, which validates again in-tx
      // as defense-in-depth (`validate_availability: true`).
      expect(stockLevelManager.updateStock).toHaveBeenCalledTimes(1);
      expect(stockLevelManager.updateStock.mock.calls[0][0]).toMatchObject({
        product_id: 201,
        validate_availability: true,
      });
      expect(result.fired_item_ids).toEqual([10]);
    });

    it('sums an ingredient shared by 2 dishes in ONE validator call, not one per dish', async () => {
      prismaMock.orders.findFirst.mockResolvedValue({
        id: 100,
        store_id: 1,
        order_number: 'ORD-1',
        order_items: [
          makeOrderItem(10, 110, 'prepared', false),
          makeOrderItem(20, 120, 'prepared', false),
        ],
      });
      prismaMock.recipes.findMany.mockResolvedValue([
        { id: 7, product_id: 110, is_active: true },
        { id: 8, product_id: 120, is_active: true },
      ]);
      // Both recipes explode to the SAME shared ingredient (201).
      recipesService.explodeBom.mockImplementation(async (recipeId: number) => [
        { component_product_id: 201, quantity: 1, depth: 1, path_recipe_ids: [recipeId] },
      ]);
      stockLevelManager.getDefaultLocationForProduct.mockResolvedValue(1);
      stockLevelManager.updateStock.mockResolvedValue({
        cost_snapshot: { total_cost: 100 },
      } as any);
      setupFireTransaction(10);

      await service.fireOrderItems({
        order_id: 100,
        order_item_ids: [10, 20],
      });

      // ONE call carrying BOTH dishes' demand for product 201 — the
      // validator (`StockValidatorService.findInsufficientLines`) is the one
      // that aggregates by `(product_id, product_variant_id)`; if
      // kitchen-fire validated per-dish instead of batching, each call would
      // see only half the real demand and a shared-ingredient overselling
      // bug would slip through invisibly.
      expect(stockValidatorService.assertIngredientsAvailable).toHaveBeenCalledTimes(1);
      const demands = (
        stockValidatorService.assertIngredientsAvailable as jest.Mock
      ).mock.calls[0][0];
      const sharedLines = demands.filter((d: any) => d.product_id === 201);
      expect(sharedLines).toHaveLength(2);
      expect(sharedLines.map((d: any) => d.used_by).sort()).toEqual([
        'Plato 10',
        'Plato 20',
      ]);
      expect(sharedLines.every((d: any) => d.quantity === 2)).toBe(true);
    });
  });
});
