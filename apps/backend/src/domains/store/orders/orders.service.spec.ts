import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { S3Service } from '@common/services/s3.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SettingsService } from '../settings/settings.service';
import { ScheduleValidationService } from '../settings/schedule-validation.service';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { SellableStockAllocator } from '../inventory/shared/services/sellable-stock-allocator.service';
import { ShippingCalculatorService } from '../shipping/shipping-calculator.service';
import { OrderFlowService } from './order-flow/order-flow.service';
import { OrderSseService } from './services/order-sse.service';
import { PromotionEngineService } from '../promotions/promotion-engine/promotion-engine.service';
import { CouponsService } from '../coupons/coupons.service';
import { AuditService } from '@common/audit/audit.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Prisma, order_channel_enum, order_delivery_type_enum, order_state_enum } from '@prisma/client';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';

/**
 * Fila de `products.findMany` con la forma que lee
 * `resolveLineTaxesForOrder`: una asignación de catálogo con UNA tasa.
 * P0-1/P0-4: el editor y `PUT /:id/items` resuelven el impuesto por esta vía
 * (antes el editor leía `product_tax_assignments.findMany`).
 */
const productTaxRow = (
  productId: number,
  rate: { id: number; name: string; rate: number; is_inclusive: boolean },
  taxType = 'iva',
  extra: Record<string, unknown> = {},
) => ({
  id: productId,
  ...extra,
  product_tax_assignments: [
    {
      is_inclusive: rate.is_inclusive,
      tax_categories: {
        tax_type: taxType,
        tax_rates: [{ ...rate, is_compound: false, priority: 1 }],
      },
    },
  ],
});

describe('OrdersService', () => {
  let service: OrdersService;

  const mockPrismaService = {
    orders: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      deleteMany: jest.fn(),
    },
    order_items: {
      create: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    // C.8 — F-035/F-047: `assertNoPersistedTaxBreakdown` consulta esto ANTES
    // del `deleteMany` de `order_items` en `updateOrderItems` /
    // `updateOrderFromEditor`. Default `null` en el beforeEach (ninguna
    // orden de prueba tiene desglose fiscal salvo que un spec lo sobrescriba).
    // P0-4: el editor y `updateOrderItems` borran el desglose previo
    // (`deleteMany`) en la misma tx antes de recrearlo anidado por línea.
    order_item_taxes: { findFirst: jest.fn(), deleteMany: jest.fn() },
    order_promotions: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    coupons: {
      update: jest.fn(),
      // Round 3.5 · ERR-10 spec. `updateMany` is the ONLY idempotent
      // primitive the editor uses to cross `current_uses`. Mock it
      // explicitly so tests can simulate the race-loss branch (count=0).
      updateMany: jest.fn(),
    },
    coupon_uses: {
      // Round 3.5 · F.18 coupon_uses.findFirst guard spec.
      // Mocked so the order-flow.service.ts commit guard test can
      // assert the idempotency check is in place.
      findFirst: jest.fn(),
    },
    products: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    product_variants: { findMany: jest.fn(), findUnique: jest.fn() },
    // C.8 — el editor ahora resuelve la tarifa de catálogo server-side
    // (ADR-05) en vez de confiar en `tax_amount_item` del DTO. Mock
    // explícito con default `[]` en el beforeEach para que las specs de
    // gates que no ejercitan impuestos no truenen por relación no mockeada.
    product_tax_assignments: { findMany: jest.fn() },
    store_users: { findFirst: jest.fn() },
    shipping_methods: { findFirst: jest.fn() },
    shipping_rates: { findFirst: jest.fn() },
    addresses: { findFirst: jest.fn() },
    users: { findUnique: jest.fn() },
    stores: { findFirst: jest.fn() },
    payments: { findFirst: jest.fn() },
    table_sessions: {
      // ADR-07: los dos escritores de ítems consultan la sesión ABIERTA
      // vigente, y solo sin ella preguntan por historial de mesa.
      findFirst: jest.fn(),
    },
    // Release-854 follow-up paso 2: findOne() consulta la sales_invoice
    // vigente. Default null (sin factura) para no alterar specs existentes.
    invoices: { findFirst: jest.fn() },
    audit_logs: {
      findMany: jest.fn(),
      // Round 3.5 · idempotency spec. The editor's idempotency
      // short-circuit looks up a recent `audit_logs` row by
      // `metadata->>'idempotency_key'`; mock the call here.
      findFirst: jest.fn(),
    },
    withoutScope: jest.fn(),
    $transaction: jest.fn((callback) => callback(mockPrismaService)),
  };

  /**
   * H1 (Round 3, lote 3) · QUI-832 — antes `withoutScope()` devolvía
   * literalmente `mockPrismaService` (`mockReturnValue(mockPrismaService)`),
   * así que la ruta SIN scope de tenant y la ruta CON scope eran el MISMO
   * objeto dentro del test: ninguna aserción podía distinguir por cuál ruta
   * pasó una consulta, y una fuga entre tiendas habría pasado en verde por
   * construcción.
   *
   * Censo original: `OrdersService` no llamaba a `withoutScope()` en ningún
   * método cubierto por este spec. QUI-INC lo cambió: `create` →
   * `resolveDeclaredTaxCategories` lee `stores` y `tax_categories` por acá,
   * porque `tax_categories` está en `store_scoped_models` y el cliente con
   * scope forzaría `store_id = contexto`, dejando fuera las categorías de
   * nivel ORGANIZACIÓN (`store_id IS NULL`) que la tienda sí puede usar. Por
   * eso el predicado OR va escrito a mano en el servicio y se verifica abajo.
   * El test de seam sigue demostrando que el atajo peligroso (devolver el
   * MISMO objeto con scope) vuelve a fallar si alguien lo reintroduce.
   */
  const mockUnscopedPrismaService = {
    orders: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    stores: { findFirst: jest.fn(), findUnique: jest.fn() },
    products: { findFirst: jest.fn(), findMany: jest.fn() },
    // QUI-INC — segunda fuente de catálogo del desglose fiscal: la categoría
    // que la línea declara (`tax_category_id`). Default `[]` en el beforeEach:
    // ninguna spec preexistente declara categoría, así que `create` sigue sin
    // consultar nada (el servicio corta antes con la lista vacía).
    tax_categories: { findMany: jest.fn() },
  };

  const mockS3Service = {
    signUrl: jest.fn(async (url: string) => url),
    getPresignedUrl: jest.fn(async (key: string) => `signed:${key}`),
  };

  const mockEventEmitter = { emit: jest.fn() };
  const mockSettingsService = {
    getStoreCurrency: jest.fn(async () => 'COP'),
  };
  const mockScheduleValidation = { validateOrThrow: jest.fn() };
  const mockStockLevelManager = {
    reserveStock: jest.fn(),
    releaseReservation: jest.fn(),
    releaseReservationsByReference: jest.fn(),
    getDefaultLocationForProduct: jest.fn(async () => 1),
  };
  const mockSellableStockAllocator = {
    allocateForLine: jest.fn(async () => ({
      slices: [{ location_id: 1, quantity: 1 }],
      allocated: 1,
      available: 1,
      shortfall: 0,
    })),
  };
  const mockShippingCalculator = { calculateRates: jest.fn() };
  const mockOrderFlowService = {
    cancelOrder: jest.fn(),
    forceOrderState: jest.fn(),
  };
  const mockPromotionEngine = {
    quoteDiscounts: jest.fn(async () => ({
      subtotal: 100,
      total_discount: 0,
      promotional_subtotal: 100,
      applied_promotions: [],
      items: [],
      order_promotions_snapshot: [],
      tier_progress: [],
    })),
  };
  const mockCouponsService = {
    validate: jest.fn(async () => ({
      valid: true,
      coupon_id: 1,
      code: 'TEST',
      discount_amount: 0,
    })),
  };
  const mockAuditService = {
    logCustom: jest.fn(),
    logCreate: jest.fn(),
    logUpdate: jest.fn(),
    logDelete: jest.fn(),
    log: jest.fn(),
  };

  const mockRequestContextService = {
    getContext: jest.fn(),
  };

  // FIX admin-orders-filters — `OrdersService` constructor gained
  // `OrderSseService` (index 12) in a recent commit. The spec was not
  // updated, so Nest refused to build the TestingModule and every test
  // failed at module init. Mock mínimo sólo para que DI resuelva;
  // `findAll` no usa SSE.
  // CP-orders-sales-sse-realtime — el hub real expone `pushOrderEvent`
  // (no `pushEvent`); sin esta clave los tests que emiten
  // order.created/status_changed mueren con TypeError is not a function.
  const mockOrderSseService = {
    emit: jest.fn(),
    pushEvent: jest.fn(),
    pushOrderEvent: jest.fn(),
    subscribe: jest.fn(),
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-12-01T12:00:00Z'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: StorePrismaService, useValue: mockPrismaService },
        { provide: RequestContextService, useValue: mockRequestContextService },
        { provide: S3Service, useValue: mockS3Service },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: ScheduleValidationService, useValue: mockScheduleValidation },
        { provide: StockLevelManager, useValue: mockStockLevelManager },
        { provide: SellableStockAllocator, useValue: mockSellableStockAllocator },
        { provide: ShippingCalculatorService, useValue: mockShippingCalculator },
        { provide: OrderFlowService, useValue: mockOrderFlowService },
        { provide: PromotionEngineService, useValue: mockPromotionEngine },
        { provide: CouponsService, useValue: mockCouponsService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: OrderSseService, useValue: mockOrderSseService },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);

    // H1 (Round 3, lote 3) · QUI-832 — objeto DISTINTO de `mockPrismaService`,
    // no el mismo mock. Ver comentario en la declaración de
    // `mockUnscopedPrismaService` más arriba.
    mockPrismaService.withoutScope.mockReturnValue(mockUnscopedPrismaService);
    // Default: sin tarifas de catálogo mockeadas explícitamente, el editor
    // resuelve la línea con cero tasas (impuesto 0), no truena. Las specs
    // que sí necesitan una tasa concreta sobrescriben esto en su propio
    // cuerpo con `.mockResolvedValue([...])`.
    mockPrismaService.product_tax_assignments.findMany.mockResolvedValue([]);
    // C.8 — F-035/F-047: default sin desglose fiscal persistido, así que el
    // guard nuevo no bloquea ninguna spec existente. El spec dedicado abajo
    // sobrescribe esto con una fila para probar el 409.
    mockPrismaService.order_item_taxes.findFirst.mockResolvedValue(null);
    mockPrismaService.order_item_taxes.deleteMany.mockResolvedValue({
      count: 0,
    } as any);
    mockPrismaService.order_items.create.mockResolvedValue({} as any);
    // QUI-INC — defaults del carril sin scope que usa
    // `resolveDeclaredTaxCategories`. Sólo se tocan cuando una línea declara
    // `tax_category_id`; las specs que sí lo hacen los sobrescriben.
    mockUnscopedPrismaService.stores.findUnique.mockResolvedValue({
      organization_id: 1,
    } as any);
    mockUnscopedPrismaService.tax_categories.findMany.mockResolvedValue(
      [] as any,
    );
    mockRequestContextService.getContext.mockReturnValue({
      store_id: 1,
      organization_id: 1,
      is_super_admin: false,
      user_id: 99,
      request_id: 'req-test-001',
    });

    jest.clearAllMocks();
    mockPrismaService.table_sessions.findFirst.mockReset().mockResolvedValue(null);
    mockPrismaService.invoices.findFirst.mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('remove — conserva evidencia financiera (E.4)', () => {
    let contextSpy: jest.SpyInstance;

    beforeEach(() => {
      contextSpy = jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
        store_id: 1,
      } as any);
    });

    afterEach(() => contextSpy.mockRestore());

    const emptyOrder = () => ({
      state: 'draft',
      total_paid: new Prisma.Decimal(0),
      active_financial_split_id: null,
      order_items: [],
      payments: [],
      invoices: [],
      refunds: [],
      order_installments: [],
      financial_splits: [],
      cash_register_movements: [],
      payment_links: [],
    });

    it.each(['draft', 'created'])('permite borrar orden %s sin evidencia financiera', async (state) => {
      mockPrismaService.orders.findFirst.mockResolvedValue({ ...emptyOrder(), state } as any);
      mockPrismaService.orders.delete.mockResolvedValue({ id: 1 } as any);

      await expect(service.remove(1)).resolves.toEqual({ id: 1 });
      expect(mockPrismaService.orders.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 1, store_id: 1 },
      }));
      expect(mockPrismaService.orders.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it.each([
      ['payment', { payments: [{ id: 4 }] }],
      ['cancelled payment', { payments: [{ id: 4, state: 'cancelled' }] }],
      ['paid total', { total_paid: new Prisma.Decimal(100) }],
      ['invoice', { invoices: [{ id: 5 }] }],
      ['refund', { refunds: [{ id: 6 }] }],
      ['installment', { order_installments: [{ id: 7 }] }],
      ['financial split', { financial_splits: [{ id: 8 }] }],
      ['cash movement', { cash_register_movements: [{ id: 9 }] }],
      ['payment link', { payment_links: [{ id: 10 }] }],
      ['active split', { active_financial_split_id: 11 }],
    ])('rechaza %s sin borrar la fila', async (_caseName, evidence) => {
      mockPrismaService.orders.findFirst.mockResolvedValue({
        ...emptyOrder(), ...evidence,
      } as any);

      await expect(service.remove(1)).rejects.toMatchObject({
        errorCode: 'ORD_VALIDATE_001',
        response: expect.objectContaining({
          details: { state: 'draft', reason: 'financial_evidence' },
        }),
      });
      expect(mockPrismaService.orders.delete).not.toHaveBeenCalled();
    });

    it('rejects a populated draft with a typed error before DELETE', async () => {
      mockPrismaService.orders.findFirst.mockResolvedValue({
        ...emptyOrder(), order_items: [{ id: 17 }],
      } as any);

      await expect(service.remove(1)).rejects.toMatchObject({
        errorCode: 'ORD_VALIDATE_001',
        response: expect.objectContaining({
          details: { state: 'draft', reason: 'order_items_present' },
        }),
      });
      expect(mockPrismaService.orders.delete).not.toHaveBeenCalled();
    });

    it('maps a racing dependent FK to a typed error instead of HTTP 500', async () => {
      mockPrismaService.orders.findFirst.mockResolvedValue(emptyOrder() as any);
      mockPrismaService.orders.delete.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dependent FK', {
          code: 'P2003', clientVersion: '7.4.1',
        }),
      );

      await expect(service.remove(1)).rejects.toMatchObject({
        errorCode: 'ORD_VALIDATE_001',
        response: expect.objectContaining({
          details: { state: 'draft', reason: 'dependent_records' },
        }),
      });
    });

    it('no revela ni borra orden fuera del scope', async () => {
      mockPrismaService.orders.findFirst.mockResolvedValue(null);
      await expect(service.remove(1)).rejects.toMatchObject({ errorCode: 'ORD_FIND_001' });
      expect(mockPrismaService.orders.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 1, store_id: 1 },
      }));
      expect(mockPrismaService.orders.delete).not.toHaveBeenCalled();
    });
  });

  /**
   * FIX admin-orders-filters — regresión de los 3 bugs que rompían los
   * filtros del dropdown en `/admin/orders/sales`:
   *   A) `payment_status` se ignoraba silenciosamente (no estaba ni en el
   *      destructure ni en el `where`).
   *   B) `date_from` y `date_to` requerían ambos (cortocircuito `&&`).
   *   C) `status` y `dispatchable` ambos escribían `state` en el `where`
   *      y el último ganaba, descartando la selección de estado cuando
   *      "Despachable" estaba activo.
   *
   * Cada test mockea `findMany` + `count` para que `findAll` retorne sin
   * tocar la DB real, y luego inspecciona el `where` pasado al primer call.
   */
  describe('findAll — filtros (admin-orders-filters)', () => {
    beforeEach(() => {
      mockPrismaService.orders.findMany.mockResolvedValue([]);
      mockPrismaService.orders.count.mockResolvedValue(0);
    });

    // Helper: captura el `where` del primer call a `findMany`.
    const lastWhere = () =>
      mockPrismaService.orders.findMany.mock.calls[0][0].where;

    it('A) aplica payment_status via payments.some.state', async () => {
      await service.findAll({
        payment_status: 'succeeded',
      } as any);

      expect(lastWhere()).toEqual(
        expect.objectContaining({
          payments: { some: { state: 'succeeded' } },
        }),
      );
    });

    it('A-bis) NO agrega `payments` cuando payment_status viene undefined', async () => {
      await service.findAll({} as any);

      expect(lastWhere().payments).toBeUndefined();
    });

    it('B) aplica date_from solo (sin date_to)', async () => {
      await service.findAll({
        date_from: '2026-09-01T00:00:00Z',
      } as any);

      const where = lastWhere();
      expect(where.created_at).toBeDefined();
      expect(where.created_at.gte).toEqual(new Date('2026-09-01T00:00:00Z'));
      // Sin `date_to` no debe existir bound superior.
      expect(where.created_at.lte).toBeUndefined();
    });

    it('B) aplica date_to solo (sin date_from)', async () => {
      await service.findAll({
        date_to: '2026-09-30T23:59:59Z',
      } as any);

      const where = lastWhere();
      expect(where.created_at).toBeDefined();
      expect(where.created_at.lte).toEqual(new Date('2026-09-30T23:59:59Z'));
      expect(where.created_at.gte).toBeUndefined();
    });

    it('B) aplica ambos date_from y date_to juntos', async () => {
      await service.findAll({
        date_from: '2026-09-01T00:00:00Z',
        date_to: '2026-09-30T23:59:59Z',
      } as any);

      expect(lastWhere().created_at).toEqual({
        gte: new Date('2026-09-01T00:00:00Z'),
        lte: new Date('2026-09-30T23:59:59Z'),
      });
    });

    it('B-bis) NO agrega created_at si ambos bounds están ausentes', async () => {
      await service.findAll({} as any);

      expect(lastWhere().created_at).toBeUndefined();
    });

    it('C) status solo se aplica cuando dispatchable es false/undefined', async () => {
      await service.findAll({ status: 'finished' } as any);

      expect(lastWhere().state).toBe('finished');
    });

    it('C) dispatchable=true omite el state de status (dispatchable gana)', async () => {
      await service.findAll({
        status: 'finished',
        dispatchable: true,
      } as any);

      // dispatchable define su propio `state` (in [...]) — gana sobre status.
      expect(lastWhere().state).toEqual({
        in: ['processing', 'pending_payment'],
      });
    });

    it('C) dispatchable=true sin status igual define state vía dispatchable', async () => {
      await service.findAll({ dispatchable: true } as any);

      expect(lastWhere().state).toEqual({
        in: ['processing', 'pending_payment'],
      });
      expect(lastWhere().delivery_type).toEqual({
        notIn: ['direct_delivery', 'dine_in'],
      });
      expect(lastWhere().dispatch_fulfillment).toEqual({ not: 'full' });
    });
  });

  describe('read-side cancellation policy', () => {
    it('returns per-order policy and loads safety evidence in the page query without N+1', async () => {
      mockPrismaService.orders.findMany.mockResolvedValueOnce([
        { id: 1, state: 'processing', order_items: [{ inventory_committed: true }], payments: [] },
        { id: 2, state: 'created', order_items: [], payments: [] },
        { id: 3, state: 'processing', order_items: [], payments: [{ state: 'succeeded' }] },
      ]);
      mockPrismaService.orders.count.mockResolvedValueOnce(3);

      const result = await service.findAll({} as any);

      expect(result.data.map((order) => order.cancellation_policy)).toEqual([
        { can_cancel: false, can_cancel_payment: false, reason_code: 'ORD_CANCEL_STOCK_COMMITTED_001' },
        { can_cancel: true, can_cancel_payment: false, reason_code: null },
        { can_cancel: false, can_cancel_payment: false, reason_code: 'ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001' },
      ]);
      expect(mockPrismaService.orders.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.orders.findFirst).not.toHaveBeenCalled();
      expect(mockPrismaService.orders.findUnique).not.toHaveBeenCalled();
      expect(mockPrismaService.payments.findFirst).not.toHaveBeenCalled();
      const query = mockPrismaService.orders.findMany.mock.calls[0][0];
      expect(query.include.order_items.select).toMatchObject({
        inventory_committed: true, inventory_consumed_at_fire: true, delivered_at: true,
      });
      expect(query.include.payments.select.store_payment_method.select.system_payment_method.select)
        .toEqual({ processing_mode: true, type: true });
    });

    it('publishes the same monetary blocker on detail without an extra payment lookup', async () => {
      mockPrismaService.orders.findFirst.mockResolvedValueOnce({
        id: 7,
        state: 'processing',
        order_items: [],
        payments: [{
          state: 'succeeded',
          store_payment_method: { system_payment_method: { processing_mode: 'ONLINE', type: 'wompi' } },
        }],
      });

      const result = await service.findOne(7);

      expect(result.cancellation_policy).toEqual({
        can_cancel: false,
        can_cancel_payment: false,
        reason_code: 'ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001',
      });
      expect(mockPrismaService.orders.findFirst).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.payments.findFirst).not.toHaveBeenCalled();
      expect(mockPrismaService.orders.findFirst.mock.calls[0][0].include.payments.include
        .store_payment_method.include.system_payment_method).toBe(true);
    });

    it('preserves cash cancellation policy while exposing the existing payment snapshot', async () => {
      const payments = [{
        id: 8,
        state: 'succeeded',
        store_payment_method: { system_payment_method: { processing_mode: 'DIRECT', type: 'cash' } },
      }];
      mockPrismaService.orders.findFirst.mockResolvedValueOnce({
        id: 8, state: 'processing', order_items: [], payments,
      });

      const result = await service.findOne(8);

      expect(result.cancellation_policy).toEqual({
        can_cancel: true, can_cancel_payment: true, reason_code: null,
      });
      expect(result.payments).toEqual(payments);
    });
  });

  describe('findOne — discount snapshots', () => {
    it('includes order_promotions and coupon_uses in the detail query', async () => {
      mockPrismaService.orders.findFirst.mockResolvedValue({
        id: 1,
        order_number: 'ORD001',
        order_items: [],
        order_promotions: [],
        coupon_uses: [],
      });

      await service.findOne(1);

      expect(mockPrismaService.orders.findFirst).toHaveBeenCalledTimes(1);
      const args = mockPrismaService.orders.findFirst.mock.calls[0][0];
      expect(args.where).toEqual({ id: 1 });
      expect(args.include).toBeDefined();

      // Discount snapshots must be loaded so the detail view can show
      // exactly what was charged (not a recalculation).
      expect(args.include.order_promotions).toBeDefined();
      expect(args.include.order_promotions.select).toMatchObject({
        id: true,
        promotion_id: true,
        discount_amount: true,
      });
      expect(args.include.order_promotions.select.promotions).toBeDefined();
      expect(args.include.order_promotions.select.promotions.select).toMatchObject({
        id: true,
        name: true,
        code: true,
        type: true,
        scope: true,
      });

      expect(args.include.coupon_uses).toBeDefined();
      expect(args.include.coupon_uses.select).toMatchObject({
        id: true,
        coupon_id: true,
        discount_applied: true,
      });
      expect(args.include.coupon_uses.select.coupon).toBeDefined();
      expect(args.include.coupon_uses.select.coupon.select).toMatchObject({
        id: true,
        code: true,
        name: true,
        discount_type: true,
      });

      expect(args.include.table_sessions).toBeDefined();
      expect(args.include.table_sessions.select.table).toBeDefined();
    });

    it('returns the persisted promotion + coupon snapshots untouched (no recalculation)', async () => {
      const persistedOrder = {
        id: 42,
        order_number: 'ORD2412010042',
        subtotal_amount: '100.00',
        tax_amount: '0.00',
        shipping_cost: '5.00',
        discount_amount: '15.00',
        grand_total: '90.00',
        currency: 'COP',
        order_items: [],
        order_promotions: [
          {
            id: 11,
            promotion_id: 7,
            customer_id: 3,
            discount_amount: '10.00',
            created_at: new Date('2024-12-01T11:00:00Z'),
            promotions: {
              id: 7,
              name: '10% off bebidas',
              code: null,
              type: 'percentage',
              scope: 'category',
              value: '10',
            },
          },
        ],
        coupon_uses: [
          {
            id: 22,
            coupon_id: 5,
            customer_id: 3,
            discount_applied: '5.00',
            used_at: new Date('2024-12-01T11:30:00Z'),
            coupon: {
              id: 5,
              code: 'WELCOME5',
              name: 'Bienvenida',
              discount_type: 'fixed',
              discount_value: '5.00',
            },
          },
        ],
      };

      mockPrismaService.orders.findFirst.mockResolvedValue(persistedOrder);

      const result = await service.findOne(42);

      // Service returns the persisted snapshot as-is.
      expect(result.discount_amount).toBe('15.00');
      expect(result.grand_total).toBe('90.00');
      expect(result.order_promotions).toHaveLength(1);
      expect(result.order_promotions[0]).toMatchObject({
        promotion_id: 7,
        discount_amount: '10.00',
        promotions: { name: '10% off bebidas', scope: 'category' },
      });
      expect(result.coupon_uses).toHaveLength(1);
      expect(result.coupon_uses[0]).toMatchObject({
        coupon_id: 5,
        discount_applied: '5.00',
        coupon: { code: 'WELCOME5', name: 'Bienvenida' },
      });
    });

    it('returns empty snapshot arrays when no discounts were applied', async () => {
      mockPrismaService.orders.findFirst.mockResolvedValue({
        id: 99,
        order_number: 'ORD2412010099',
        subtotal_amount: '50.00',
        discount_amount: '0.00',
        grand_total: '50.00',
        order_items: [],
        order_promotions: [],
        coupon_uses: [],
      });

      const result = await service.findOne(99);

      expect(result.order_promotions).toEqual([]);
      expect(result.coupon_uses).toEqual([]);
      expect(result.discount_amount).toBe('0.00');
    });

    it('throws when order is not found', async () => {
      mockPrismaService.orders.findFirst.mockResolvedValue(null);

      await expect(service.findOne(404)).rejects.toBeInstanceOf(
        VendixHttpException,
      );
    });

    // ----------------------------------------------------------------
    // C.8 — R-1: el payload de FB-04 (`GET /store/orders/:id`) gana
    // `unit_price_gross`/`line_total_gross` como campos ADITIVOS; la
    // sombra `final_*` (:1086-1092) sigue viva y `unit_price`/
    // `total_price` NUNCA cambian de magnitud para un lector que no pidió
    // el campo nuevo. Prueba de regresión permanente.
    // ----------------------------------------------------------------
    it('F-004/F-049 — unit_price_gross y line_total_gross son aditivos: unit_price/total_price conservan la base', async () => {
      mockPrismaService.orders.findFirst.mockResolvedValue({
        id: 7,
        order_number: 'ORD007',
        order_items: [
          {
            id: 70,
            product_id: 3,
            unit_price: 100,
            quantity: 2,
            total_price: 200,
            products: {},
          },
        ],
        order_promotions: [],
        coupon_uses: [],
      });
      mockPrismaService.product_tax_assignments.findMany.mockResolvedValue([
        {
          product_id: 3,
          tax_categories: {
            is_inclusive: false,
            tax_rates: [{ rate: 0.19, is_inclusive: false }],
          },
        },
      ] as any);

      const result = await service.findOne(7);
      const item = (result as any).order_items[0];

      // Campos aditivos nuevos: bruto resuelto server-side desde el
      // catálogo (100 × 1,19 = 119 por unidad; × 2 = 238 la línea).
      expect(item.unit_price_gross).toBe(119);
      expect(item.line_total_gross).toBe(238);
      // R-1 — el lector viejo (uno que sólo conoce `unit_price`/
      // `total_price`) sigue viendo EXACTAMENTE lo mismo que antes: la
      // base, no el bruto.
      expect(item.unit_price).toBe(100);
      expect(item.total_price).toBe(200);
      // La sombra histórica (`final_*`) sobrevive intacta — matarla
      // dejaría el bruto en NULL (F-049).
      expect(item.final_unit_price).toBe(119);
      expect(item.final_total_price).toBe(238);
    });

    it('F-008 (contraste) — sin tasas de catálogo resueltas, el bruto aditivo colapsa a la base (cero regresión histórica)', async () => {
      mockPrismaService.orders.findFirst.mockResolvedValue({
        id: 8,
        order_number: 'ORD008',
        order_items: [
          {
            id: 80,
            product_id: null, // línea custom/servicio: sin catálogo que resolver
            unit_price: 50,
            quantity: 1,
            total_price: 50,
            products: {},
          },
        ],
        order_promotions: [],
        coupon_uses: [],
      });

      const result = await service.findOne(8);
      const item = (result as any).order_items[0];

      expect(item.unit_price_gross).toBe(50);
      expect(item.line_total_gross).toBe(50);
      expect(item.unit_price).toBe(50);
      expect(item.total_price).toBe(50);
    });
  });

  /**
   * QUI-557 — El vector de corrupción que hacía reaparecer el ticket.
   *
   * `UpdateOrderDto extends PartialType(CreateOrderDto)` reexpone `state`, así
   * que un `PATCH /store/orders/:id {"state":...}` escribía el estado en crudo:
   * con `cancelled` la orden quedaba cancelada pero sus `stock_reservations`
   * seguían activas restando de `quantity_available`, y la siguiente remisión
   * reportaba "sin stock" con las existencias intactas. Con `shipped` el daño
   * era el simétrico: sin emitir `order.shipped`, la reserva original de una
   * orden de alcance ORGANIZATION nunca se consumía.
   *
   * `OrdersService.update` delega ahora TODO cambio de estado en
   * `forceOrderState`. La invariante que fijan estos tests: `state` no llega
   * jamás al `prisma.orders.update` de este método.
   */
  /**
   * C.8 — F-006 (major): 1º de los 3 sitios que el hallazgo nombra
   * (`create` `:509`, editor, `updateOrderItems`). Antes, `create` escribía
   * `final_unit_price: item.final_unit_price ?? item.unit_price` — sin
   * override explícito del cliente, el bruto quedaba degradado al NETO.
   * Ahora deriva el bruto server-side con `resolveFinalUnitPriceServerSide`
   * (mismas tasas de catálogo que ya resuelve para `order_item_taxes`).
   */
  describe('create — E.3 delivery type and channel', () => {
    let contextSpy: jest.SpyInstance;
    const makeDto = (extra: Record<string, unknown> = {}) => ({
      order_number: 'ORD-E3-1',
      subtotal: 100,
      total_amount: 100,
      skip_schedule_validation: true,
      items: [{ product_name: 'Custom item', quantity: 1, unit_price: 100, total_price: 100 }],
      ...extra,
    }) as CreateOrderDto;

    beforeEach(() => {
      contextSpy = jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
        store_id: 1, organization_id: 1, user_id: 99, request_id: 'req-e3',
      } as any);
      mockPrismaService.orders.create.mockImplementation(async ({ data }: any) => ({
        id: 930,
        store_id: 1,
        order_number: data.order_number,
        delivery_type: data.delivery_type ?? order_delivery_type_enum.direct_delivery,
        channel: data.channel ?? order_channel_enum.pos,
        state: data.state,
        grand_total: data.grand_total,
        currency: data.currency,
        order_items: [{ product_id: null, product_variant_id: null, quantity: 1, products: null }],
      }));
    });

    afterEach(() => contextSpy.mockRestore());

    it('persists dine_in and whatsapp instead of falling through to schema defaults', async () => {
      const order = await service.create(makeDto({ delivery_type: order_delivery_type_enum.dine_in, channel: order_channel_enum.whatsapp }), { id: 99 });
      expect(order).toMatchObject({ delivery_type: order_delivery_type_enum.dine_in, channel: order_channel_enum.whatsapp, state: order_state_enum.created });
      expect(mockPrismaService.orders.create.mock.calls[0][0].data).toMatchObject({ delivery_type: order_delivery_type_enum.dine_in, channel: order_channel_enum.whatsapp });
    });

    it('writes explicit direct_delivery/pos defaults and never pickup when omitted', async () => {
      const order = await service.create(makeDto(), { id: 99 });
      expect(order).toMatchObject({ delivery_type: order_delivery_type_enum.direct_delivery, channel: order_channel_enum.pos });
      expect(mockPrismaService.orders.create.mock.calls[0][0].data).toMatchObject({ delivery_type: order_delivery_type_enum.direct_delivery, channel: order_channel_enum.pos });
    });

    it('keeps home_delivery + prepared in pending_delivery', async () => {
      const dto = makeDto({ delivery_type: order_delivery_type_enum.home_delivery });
      dto.items[0].product_type = 'prepared';
      const order = await service.create(dto, { id: 99 });
      expect(order).toMatchObject({ delivery_type: order_delivery_type_enum.home_delivery, state: order_state_enum.pending_delivery });
    });

    it('accepts every schema channel and rejects an invalid channel and unknown field through DTO validation', () => {
      for (const channel of Object.values(order_channel_enum)) {
        const dto = plainToInstance(CreateOrderDto, makeDto({ channel }));
        expect(validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
      }
      for (const extra of [{ channel: 'telegram' }, { canal: 'pos' }, { delivery_type: 'takeaway' }]) {
        const dto = plainToInstance(CreateOrderDto, makeDto(extra));
        expect(validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length).toBeGreaterThan(0);
      }
    });
  });

  describe('create — F-006 final_unit_price server-side (C.8)', () => {
    const contextSpy = () =>
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
        store_id: 1,
        organization_id: 1,
        is_super_admin: false,
        is_owner: false,
        user_id: 99,
        request_id: 'req-test-create-001',
      } as any);

    it('deriva final_unit_price del catálogo (19%) cuando el DTO NO manda override', async () => {
      const spy = contextSpy();
      try {
        // Un solo mock de `products.findUnique` sirve tanto para
        // `assertVariantRequiredForPrepared` (id/name/product_type/variants)
        // como para `resolveCostPrice` (cost_price): mismo objeto, más
        // campos de los que cada caller lee.
        mockPrismaService.products.findUnique.mockResolvedValue({
          id: 1,
          name: 'Test product',
          product_type: 'simple',
          product_variants: [],
          cost_price: 50,
        } as any);
        // Igual que arriba: sirve para `normalizePriceUnitLines`
        // (price_unit_quantity) y para `resolveLineTaxesForOrder`
        // (product_tax_assignments) — misma tasa 19% exclusiva que el resto
        // de las specs de C.8 usan como canon.
        mockPrismaService.products.findMany.mockResolvedValue([
          {
            id: 1,
            price_unit_quantity: 1,
            product_tax_assignments: [
              {
                is_inclusive: false,
                tax_categories: {
                  tax_type: 'iva',
                  tax_rates: [
                    {
                      id: 10,
                      name: 'IVA 19%',
                      rate: 0.19,
                      is_compound: false,
                      is_inclusive: false,
                      priority: 1,
                    },
                  ],
                },
              },
            ],
          },
        ] as any);
        const createdOrder = {
          id: 900,
          store_id: 1,
          order_number: 'ORD-TEST-0001',
          grand_total: 119,
          currency: 'COP',
          order_items: [
            {
              product_id: 1,
              product_variant_id: null,
              quantity: 1,
              stock_units_consumed: null,
              products: { track_inventory: false },
            },
          ],
        };
        mockPrismaService.orders.create.mockResolvedValue(createdOrder as any);

        const dto = {
          order_number: 'ORD-TEST-0001',
          subtotal: 100,
          tax_amount: 19,
          total_amount: 119,
          skip_schedule_validation: true,
          items: [
            {
              product_id: 1,
              product_name: 'Test product',
              quantity: 1,
              unit_price: 100,
              total_price: 100,
              tax_amount_item: 19,
              tax_rate: 0.19,
              // Sin `final_unit_price`: es justo el caso que F-006 cierra.
            },
          ],
        } as any;

        await service.create(dto, { id: 99 });

        expect(mockPrismaService.orders.create).toHaveBeenCalledTimes(1);
        const writtenItems = (
          mockPrismaService.orders.create.mock.calls[0][0] as any
        ).data.order_items.create;
        expect(writtenItems).toHaveLength(1);
        // 100 NETO × 1.19 = 119 BRUTO — antes de este fix, quedaba en 100
        // (degradado al NETO por `?? item.unit_price`).
        expect(Number(writtenItems[0].final_unit_price)).toBeCloseTo(119, 2);
      } finally {
        spy.mockRestore();
      }
    });

    it('honra el override explícito del carril de órdenes cuando el DTO SÍ manda final_unit_price', async () => {
      const spy = contextSpy();
      try {
        mockPrismaService.products.findUnique.mockResolvedValue({
          id: 1,
          name: 'Test product',
          product_type: 'simple',
          product_variants: [],
          cost_price: 50,
        } as any);
        mockPrismaService.products.findMany.mockResolvedValue([
          { id: 1, price_unit_quantity: 1, product_tax_assignments: [] },
        ] as any);
        const createdOrder = {
          id: 901,
          store_id: 1,
          order_number: 'ORD-TEST-0002',
          grand_total: 150,
          currency: 'COP',
          order_items: [
            {
              product_id: 1,
              product_variant_id: null,
              quantity: 1,
              stock_units_consumed: null,
              products: { track_inventory: false },
            },
          ],
        };
        mockPrismaService.orders.create.mockResolvedValue(createdOrder as any);

        const dto = {
          order_number: 'ORD-TEST-0002',
          subtotal: 100,
          tax_amount: 0,
          total_amount: 150,
          skip_schedule_validation: true,
          items: [
            {
              product_id: 1,
              product_name: 'Test product',
              quantity: 1,
              unit_price: 100,
              total_price: 100,
              tax_amount_item: 0,
              tax_rate: 0,
              final_unit_price: 150, // Override explícito del carril de órdenes.
            },
          ],
        } as any;

        await service.create(dto, { id: 99 });

        const writtenItems = (
          mockPrismaService.orders.create.mock.calls[0][0] as any
        ).data.order_items.create;
        expect(Number(writtenItems[0].final_unit_price)).toBe(150);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('update — todo cambio de estado pasa por el seam de OrderFlowService', () => {
    const processingOrder = {
      id: 590,
      order_number: 'ORD590',
      state: 'processing',
      subtotal_amount: '1000.00',
      tax_amount: '0.00',
      discount_amount: '0.00',
    };

    /** Todos los estados que la UI manda hoy por el PATCH genérico. */
    const UI_STATES = ['cancelled', 'shipped', 'delivered'] as const;

    it('el DTO admite motivo string pero rechaza uno no textual', () => {
      expect(validateSync(plainToInstance(UpdateOrderDto, {
        state: 'processing', reason: 'Entrega equivocada',
      }), { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
      expect(validateSync(plainToInstance(UpdateOrderDto, {
        state: 'processing', reason: 123,
      }), { whitelist: true, forbidNonWhitelisted: true }).length).toBeGreaterThan(0);
    });

    it.each([undefined, '', '   '])(
      'rechaza delivered -> processing sin motivo del usuario (%s) antes de cualquier write',
      async (reason) => {
        mockPrismaService.orders.findFirst.mockResolvedValue({ ...processingOrder, state: 'delivered' });
        await expect(service.update(590, {
          state: 'processing', reason, internal_notes: 'nota',
        } as any)).rejects.toMatchObject({
          errorCode: 'ORD_DELIVERED_REVERSAL_REASON_REQUIRED_001',
        });
        expect(mockPrismaService.orders.update).not.toHaveBeenCalled();
        expect(mockOrderFlowService.forceOrderState).not.toHaveBeenCalled();
      },
    );

    it.each([false, true])(
      'delega motivo del usuario para delivered -> processing (con metadata=%s)',
      async (withMetadata) => {
        mockPrismaService.orders.findFirst.mockResolvedValue({ ...processingOrder, state: 'delivered' });
        mockPrismaService.orders.update.mockResolvedValue(processingOrder);
        await service.update(590, {
          state: 'processing', reason: '  Entrega equivocada  ',
          ...(withMetadata ? { internal_notes: 'nota' } : {}),
        } as any);
        expect(mockOrderFlowService.forceOrderState).toHaveBeenCalledWith(590, 'processing', {
          reason: 'Entrega equivocada',
        });
        for (const [call] of mockPrismaService.orders.update.mock.calls) {
          expect(call.data.reason).toBeUndefined();
          expect(call.data.state).toBeUndefined();
        }
      },
    );

    it.each(UI_STATES)(
      'delega state=%s en forceOrderState y no escribe el estado en crudo',
      async (state) => {
        mockPrismaService.orders.findFirst.mockResolvedValue(processingOrder);

        await service.update(590, { state } as any);

        expect(mockOrderFlowService.forceOrderState).toHaveBeenCalledWith(
          590,
          state,
          expect.objectContaining({ reason: expect.any(String) }),
        );
        expect(mockPrismaService.orders.update).not.toHaveBeenCalled();
      },
    );

    it('no fuerza nada cuando el estado pedido es el actual', async () => {
      mockPrismaService.orders.findFirst.mockResolvedValue(processingOrder);

      await service.update(590, { state: 'processing' } as any);

      expect(mockOrderFlowService.forceOrderState).not.toHaveBeenCalled();
      // Y tampoco reescribe la fila: sin más campos, no hay nada que aplicar.
      expect(mockPrismaService.orders.update).not.toHaveBeenCalled();
    });

    it('aplica el resto de la metadata cuando el PATCH trae state y otros campos', async () => {
      mockPrismaService.orders.findFirst.mockResolvedValue(processingOrder);
      mockPrismaService.orders.update.mockResolvedValue(processingOrder);

      await service.update(590, {
        state: 'cancelled',
        internal_notes: 'cliente desistió',
      } as any);

      expect(mockOrderFlowService.forceOrderState).toHaveBeenCalled();
      const writtenData = mockPrismaService.orders.update.mock.calls[0][0].data;
      expect(writtenData.internal_notes).toBe('cliente desistió');
      expect(writtenData.state).toBeUndefined();
    });

    it('escribe la metadata ANTES de forzar el estado, o la traza se pierde', async () => {
      /**
       * Regresión encontrada en la verificación E2E. `forceOrderState` persiste
       * su traza (`forced_transition`, `delivered_at`, `previous_state`) como
       * JSON dentro de `internal_notes`. Si el PATCH trae `state` E
       * `internal_notes` y se forzaba primero, el update genérico sobrescribía
       * ese JSON con el texto plano del operador y la traza desaparecía —con
       * ella el `previous_state` que `reactivateOrder` necesita—.
       *
       * Invirtiendo el orden, `appendFlowMetadata` encuentra la nota como texto
       * plano y la conserva en el campo `notes` del sobre.
       */
      mockPrismaService.orders.findFirst.mockResolvedValue(processingOrder);

      const callOrder: string[] = [];
      mockPrismaService.orders.update.mockImplementation(async () => {
        callOrder.push('prisma.update');
        return processingOrder;
      });
      mockOrderFlowService.forceOrderState.mockImplementation(async () => {
        callOrder.push('forceOrderState');
        return processingOrder;
      });

      await service.update(590, {
        state: 'delivered',
        internal_notes: 'entregada en mostrador',
      } as any);

      expect(callOrder).toEqual(['prisma.update', 'forceOrderState']);
    });

    it('sin state no fuerza nada y devuelve el row del update, no un findOne extra', async () => {
      // El PATCH de solo metadata es el caso mayoritario: no debe pagar una
      // lectura extra ni cambiar la forma del payload que ya consume la UI.
      mockPrismaService.orders.findFirst.mockResolvedValue(processingOrder);
      const updated = { ...processingOrder, internal_notes: 'nota' };
      mockPrismaService.orders.update.mockResolvedValue(updated);

      const result = await service.update(590, {
        internal_notes: 'nota',
      } as any);

      expect(mockOrderFlowService.forceOrderState).not.toHaveBeenCalled();
      expect(result).toBe(updated);
    });

    it('nunca escribe state en crudo, ni para un estado que la UI no usa hoy', async () => {
      // Blindaje contra el reingreso del bug: si mañana alguien manda
      // `refunded` por esta vía, tampoco debe llegar al update crudo.
      mockPrismaService.orders.findFirst.mockResolvedValue(processingOrder);
      mockPrismaService.orders.update.mockResolvedValue(processingOrder);

      await service.update(590, {
        state: 'refunded',
        internal_notes: 'nota',
      } as any);

      expect(mockOrderFlowService.forceOrderState).toHaveBeenCalledWith(
        590,
        'refunded',
        expect.anything(),
      );
      const writtenData = mockPrismaService.orders.update.mock.calls[0][0].data;
      expect(writtenData.state).toBeUndefined();
    });

    /**
     * F-086 punto (b) — el recálculo de `grand_total` al cambiar
     * `shipping_cost` ignoraba la propina persistida y no acotaba en cero.
     * Ver el comentario junto al cálculo en `orders.service.ts` para el
     * detalle del bug y la invariante I-6.
     */
    it('F-086 (b): incluye la propina persistida al recalcular grand_total por shipping_cost', async () => {
      const orderWithTip = {
        ...processingOrder,
        subtotal_amount: '100000.00',
        tax_amount: '19000.00',
        discount_amount: '0.00',
        tip_amount: '20000.00',
      };
      mockPrismaService.orders.findFirst.mockResolvedValue(orderWithTip);
      mockPrismaService.orders.update.mockResolvedValue(orderWithTip);

      await service.update(590, { shipping_cost: 5000 } as any);

      const writtenData = mockPrismaService.orders.update.mock.calls[0][0].data;
      // 100000 + 19000 - 0 + 5000 + 20000 = 144000. Antes del fix la
      // propina se perdía y el resultado quedaba en 124000.
      expect(writtenData.grand_total).toBe(144000);
    });

    it('F-086 (b) / I-6: acota grand_total en 0 cuando el paréntesis daría negativo', async () => {
      const heavilyDiscountedOrder = {
        ...processingOrder,
        subtotal_amount: '10000.00',
        tax_amount: '1900.00',
        discount_amount: '15000.00',
        tip_amount: '0.00',
      };
      mockPrismaService.orders.findFirst.mockResolvedValue(
        heavilyDiscountedOrder,
      );
      mockPrismaService.orders.update.mockResolvedValue(
        heavilyDiscountedOrder,
      );

      await service.update(590, { shipping_cost: 0 } as any);

      const writtenData = mockPrismaService.orders.update.mock.calls[0][0].data;
      // 10000 + 1900 - 15000 + 0 + 0 = -3100. Sin el clamp, ese negativo
      // habría llegado crudo a `grand_total`.
      expect(writtenData.grand_total).toBe(0);
    });
  });

  /**
   * CP-POS-CREAR-EDITAR-COBRAR-001 — C.1/C.2/C.3 · updateOrderFromEditor
   *
   * Dos invariantes críticas del editor:
   *  1. Customer gate: si el customer_id no pertenece al store del contexto,
   *     el servicio lanza 403 `ORD_EDIT_CUSTOMER_STORE_MISMATCH_001` ANTES
   *     de tomar el claim atómico del estado (no contamina la fila).
   *  2. Atomic state claim: si dos llamadas concurrentes editan la misma
   *     orden, el `updateMany` con filtro de estado sólo actualiza una. La
   *     segunda recibe 409 `ORD_EDIT_INVALID_STATE_001`.
   *
   * El resto del flujo (promociones, cupones, shipping, stock) se cubre con
   * verificaciones de integración contra el flujo canónico
   * `flow/pay`/`flow/cancel` y con `npm run test:path` para no
   * arrastrar mocks pesados.
   */
  describe('updateOrderFromEditor — gates previos al commit', () => {
    const editableOrder = {
      id: 500,
      store_id: 1,
      state: 'created',
      customer_id: 99,
      coupon_id: null,
      coupon_code: null,
      subtotal_amount: '100.00',
      tax_amount: '19.00',
      shipping_cost: '0.00',
      discount_amount: '0.00',
      grand_total: '119.00',
      notes: 'nota original',
      internal_notes: null,
      delivery_type: 'pickup',
      billing_address_id: null,
      shipping_address_id: null,
      shipping_method_id: null,
      shipping_rate_id: null,
    };

    const minimalDto = {
      customer_id: 99,
      items: [
        {
          product_id: 1,
          product_name: 'Test product',
          quantity: 1,
          unit_price: 100,
          total_price: 100,
          tax_amount_item: 19,
          tax_rate: 0.19,
        },
      ],
    } as any;

    const setupContext = () => {
      mockRequestContextService.getContext.mockReturnValue({
        store_id: 1,
        organization_id: 1,
        is_super_admin: false,
        user_id: 99,
        request_id: 'req-test-001',
      });
    };

    /**
     * El servicio usa el método estático `RequestContextService.getContext()`
     * (no la instancia inyectada). Lo interceptamos con `jest.spyOn` para
     * que devuelva un RequestContext válido.
     */
    const spyContext = () =>
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
        store_id: 1,
        organization_id: 1,
        is_super_admin: false,
        is_owner: false,
        user_id: 99,
        request_id: 'req-test-001',
      });

    it('lanza 403 ORD_EDIT_CUSTOMER_STORE_MISMATCH_001 si el cliente no pertenece al store', async () => {
      setupContext();
      const contextSpy = spyContext();
      try {
        // 1) La orden existe y está en estado editable.
        mockPrismaService.orders.findFirst.mockResolvedValue(editableOrder);
        // 2) Pero el cliente NO tiene store_users para este store.
        mockPrismaService.store_users.findFirst.mockResolvedValue(null);

        let caught: VendixHttpException | null = null;
        try {
          await service.updateOrderFromEditor(500, minimalDto);
        } catch (err) {
          caught = err as VendixHttpException;
        }

        expect(caught).toBeInstanceOf(VendixHttpException);

        // El claim atómico del estado NUNCA debe dispararse si el cliente falla
        // el gate — eso sería escribir un cliente inválido sobre la fila.
        expect(mockPrismaService.orders.updateMany).not.toHaveBeenCalled();

        // El error tipado correcto.
        expect(caught!.errorCode).toBe(
          ErrorCodes.ORD_EDIT_CUSTOMER_STORE_MISMATCH_001.code,
        );
      } finally {
        contextSpy.mockRestore();
      }
    });

    it('lanza 409 ORD_EDIT_STATE_CHANGED_001 cuando el claim pierde la carrera y el estado sigue siendo editable', async () => {
      setupContext();
      const contextSpy = spyContext();
      try {
        // Claim falla en count=0 (otro operador ganó la carrera).
        // Round 1 MAJOR #6: ahora diferenciamos 3 causas. El estado leído
        // sigue siendo `created` (editableOrder.state), lo que el nuevo
        // contrato mapea a ORD_EDIT_STATE_CHANGED_001 — la UI debe pedirle
        // al cliente "recargue y reintente", no un error permanente.
        mockPrismaService.orders.findFirst.mockResolvedValue(editableOrder);
        mockPrismaService.store_users.findFirst.mockResolvedValue({ id: 1 });
        mockPrismaService.products.findMany.mockResolvedValue([{ id: 1 }]);
        // F-164 — `assertVariantRequiredForPrepared` (dentro de la
        // transacción, ANTES del claim atómico) resuelve por
        // `products.findUnique`, no por `findMany`. Sin este mock el
        // producto #1 "no existe" y el test corta en SYS_NOT_FOUND_001
        // antes de llegar al claim que dice estar probando.
        mockPrismaService.products.findUnique.mockResolvedValue({
          id: 1,
          name: 'Test product',
          product_type: 'simple',
          product_variants: [],
        } as any);
        mockPrismaService.orders.updateMany.mockResolvedValue({
          count: 0,
        } as any);

        let caught: VendixHttpException | null = null;
        try {
          await service.updateOrderFromEditor(500, minimalDto);
        } catch (err) {
          caught = err as VendixHttpException;
        }

        expect(caught).toBeInstanceOf(VendixHttpException);
        expect(caught!.errorCode).toBe(
          ErrorCodes.ORD_EDIT_STATE_CHANGED_001.code,
        );
      } finally {
        contextSpy.mockRestore();
      }
    });

    it('lanza 409 ORD_EDIT_NOT_ALLOWED_001 cuando el claim falla y el estado ya es terminal', async () => {
      setupContext();
      const contextSpy = spyContext();
      try {
        // Round 1 MAJOR #6: si el estado leído es terminal/avanzado, el
        // error correcto es ORD_EDIT_NOT_ALLOWED_001 (la orden ya no es
        // editable por construcción, no por race).
        const lockedOrder = {
          ...editableOrder,
          state: 'processing',
        };
        mockPrismaService.orders.findFirst
          .mockResolvedValueOnce(editableOrder) // first: pre-claim lookup
          .mockResolvedValueOnce(lockedOrder); // second: post-claim state lookup
        mockPrismaService.store_users.findFirst.mockResolvedValue({ id: 1 });
        mockPrismaService.products.findMany.mockResolvedValue([{ id: 1 }]);
        // F-164 — mismo mock que el test anterior: sin `findUnique` el
        // validator corta el pipeline antes del claim atómico que este
        // test necesita ejercitar.
        mockPrismaService.products.findUnique.mockResolvedValue({
          id: 1,
          name: 'Test product',
          product_type: 'simple',
          product_variants: [],
        } as any);
        mockPrismaService.orders.updateMany.mockResolvedValue({
          count: 0,
        } as any);

        let caught: VendixHttpException | null = null;
        try {
          await service.updateOrderFromEditor(500, minimalDto);
        } catch (err) {
          caught = err as VendixHttpException;
        }

        expect(caught).toBeInstanceOf(VendixHttpException);
        expect(caught!.errorCode).toBe(
          ErrorCodes.ORD_EDIT_NOT_ALLOWED_001.code,
        );
      } finally {
        contextSpy.mockRestore();
      }
    });

    it('lanza 409 ORD_EDIT_INVALID_STATE_001 cuando el claim falla y el estado es desconocido (catch-all)', async () => {
      setupContext();
      const contextSpy = spyContext();
      try {
        // El catch-all del Round 1 MAJOR #6: estado missing / null tras
        // un claim fallido. El código genérico sirve de red de seguridad.
        mockPrismaService.orders.findFirst
          .mockResolvedValueOnce(editableOrder)
          .mockResolvedValueOnce(null);
        mockPrismaService.store_users.findFirst.mockResolvedValue({ id: 1 });
        mockPrismaService.products.findMany.mockResolvedValue([{ id: 1 }]);
        // F-164 — idem: el validator de variantes corre antes del claim y
        // necesita `findUnique`, no `findMany`.
        mockPrismaService.products.findUnique.mockResolvedValue({
          id: 1,
          name: 'Test product',
          product_type: 'simple',
          product_variants: [],
        } as any);
        mockPrismaService.orders.updateMany.mockResolvedValue({
          count: 0,
        } as any);

        let caught: VendixHttpException | null = null;
        try {
          await service.updateOrderFromEditor(500, minimalDto);
        } catch (err) {
          caught = err as VendixHttpException;
        }

        expect(caught).toBeInstanceOf(VendixHttpException);
        expect(caught!.errorCode).toBe(
          ErrorCodes.ORD_EDIT_INVALID_STATE_001.code,
        );
      } finally {
        contextSpy.mockRestore();
      }
    });

    // ----------------------------------------------------------------
    // CP-POS-CREAR-EDITAR-COBRAR-001 — G.1
    //
    // Camino feliz e invariantes restantes del editor: orden terminal,
    // stock insuficiente y cupón inválido. Cada caso asserta un error
    // tipado distinto Y que la fila no quedó a medias (`updateMany`, el
    // claim atómico, nunca corrió).
    // ----------------------------------------------------------------
    const draftOrder = {
      ...editableOrder,
      state: 'draft',
      delivery_type: 'home_delivery',
    };

    /** DTO completo: items + cliente + notas + envío validado por servidor. */
    const fullDto = {
      customer_id: 99,
      notes: 'nota editada',
      internal_notes: 'interna',
      delivery_type: 'home_delivery',
      shipping_method_id: 5,
      shipping_rate_id: 7,
      shipping_address_id: 33,
      shipping_cost: 10,
      promotion_ids: [],
      items: [
        {
          product_id: 1,
          product_name: 'Test product',
          quantity: 1,
          unit_price: 100,
          total_price: 100,
          tax_amount_item: 19,
          tax_rate: 0.19,
        },
      ],
    } as any;

    /** Fila devuelta por el read final dentro de la transacción. */
    const persistedOrder = {
      ...draftOrder,
      subtotal_amount: 100,
      tax_amount: 19,
      discount_amount: 0,
      shipping_cost: 10,
      grand_total: 129,
      order_items: [],
      users: { id: 99, first_name: 'Juan' },
      order_promotions: [],
      coupon_uses: [],
      order_installments: [],
    };

    /** Arranque común del camino que llega hasta el commit. */
    const arrangeEditableDraft = () => {
      mockPrismaService.orders.findFirst
        .mockResolvedValueOnce(draftOrder as any)
        .mockResolvedValue(persistedOrder as any);
      mockPrismaService.store_users.findFirst.mockResolvedValue({ id: 1 });
      // P0-1: el editor resuelve la tasa con `resolveLineTaxesForOrder`
      // (`products.findMany` → asignaciones). IVA 19 % AGREGADO sobre la base
      // 100 ⇒ 19, el mismo número que `persistedOrder` declara.
      mockPrismaService.products.findMany.mockResolvedValue([
        productTaxRow(1, {
          id: 10,
          name: 'IVA 19%',
          rate: 0.19,
          is_inclusive: false,
        }),
      ] as any);
      mockPrismaService.product_variants.findMany.mockResolvedValue([]);
      mockPrismaService.shipping_methods.findFirst.mockResolvedValue({
        id: 5,
        store_id: 1,
        type: 'delivery',
        is_active: true,
      });
      mockPrismaService.shipping_rates.findFirst.mockResolvedValue({
        id: 7,
        shipping_method_id: 5,
        base_cost: 10,
        is_active: true,
      });
      mockPrismaService.orders.updateMany.mockResolvedValue({ count: 1 } as any);
      mockPrismaService.orders.update.mockResolvedValue({} as any);
      mockPrismaService.order_items.deleteMany.mockResolvedValue({ count: 0 });
      mockPrismaService.order_items.createMany.mockResolvedValue({ count: 1 });
      mockPrismaService.order_items.findMany.mockResolvedValue([]);
      mockPrismaService.order_promotions.deleteMany.mockResolvedValue({
        count: 0,
      });
      // C.8 — el editor ahora resuelve el IVA de la línea del catálogo
      // (ADR-05) en vez de confiar en `tax_amount_item` del DTO. `fullDto`
      // trae `product_id: 1, unit_price: 100, tax_rate: 0.19`; esta tasa
      // hace que el servidor resuelva el mismo 19 (`tax_amount: 19`) que
      // `persistedOrder` ya declaraba, pero por el camino correcto.
      mockPrismaService.product_tax_assignments.findMany.mockResolvedValue([
        {
          product_id: 1,
          tax_categories: {
            is_inclusive: false,
            tax_rates: [{ rate: 0.19, is_inclusive: false }],
          },
        },
      ] as any);
    };

    it('actualiza un draft con items + cliente + envío y devuelve la orden completa', async () => {
      setupContext();
      const contextSpy = spyContext();
      try {
        arrangeEditableDraft();
        // F-164 — `arrangeEditableDraft` no cubre `products.findUnique`;
        // el validator de variantes (dentro de la transacción, antes del
        // claim) lo necesita para no cortar en SYS_NOT_FOUND_001. Mismo
        // patrón que las specs "PERMITE editar..." más abajo.
        mockPrismaService.products.findUnique.mockResolvedValue({
          id: 1,
          name: 'Test product',
          product_type: 'simple',
          product_variants: [],
        } as any);

        const result = await service.updateOrderFromEditor(500, fullDto);

        // La respuesta es la orden persistida completa, no un eco del DTO.
        expect(result).toBeDefined();
        expect((result as any).id).toBe(500);
        expect(Number((result as any).grand_total)).toBe(129);
        expect((result as any).order_items).toBeDefined();
        expect((result as any).users).toBeDefined();

        // Claim atómico ejecutado sobre estados editables únicamente.
        expect(mockPrismaService.orders.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              id: 500,
              store_id: 1,
              state: { in: ['created', 'draft'] },
            }),
          }),
        );

        // Draft: no se libera ni se crea reserva de stock.
        expect(
          mockStockLevelManager.releaseReservationsByReference,
        ).not.toHaveBeenCalled();
      } finally {
        contextSpy.mockRestore();
      }
    });

    // ----------------------------------------------------------------
    // Impuesto opcional por tarifa de envío — copia en el editor.
    // ----------------------------------------------------------------
    describe('impuesto del envío en el editor', () => {
      const INC_SNAPSHOT = {
        shipping_tax_rate_id: 77,
        shipping_tax_name: 'INC 8%',
        shipping_tax_type: 'inc',
        shipping_tax_rate: 0.08,
        shipping_tax_amount: 0.74,
      };
      let snapshotForRate: jest.Mock;
      const arrangeProduct = () =>
        mockPrismaService.products.findUnique.mockResolvedValue({
          id: 1, name: 'Test product', product_type: 'simple', product_variants: [],
        } as any);
      const headerUpdate = () =>
        mockPrismaService.orders.update.mock.calls
          .map((c: any[]) => c[0])
          .find((a: any) => a?.where?.id === 500 && 'grand_total' in (a.data ?? {}))?.data;

      beforeEach(() => {
        snapshotForRate = jest.fn().mockResolvedValue({ ...INC_SNAPSHOT });
        (service as any).shippingTaxService = { snapshotForRate };
      });

      it('método + tarifa: copia nueva de la tarifa vigente', async () => {
        setupContext();
        const contextSpy = spyContext();
        try {
          arrangeEditableDraft();
          arrangeProduct();
          await service.updateOrderFromEditor(500, fullDto);
          expect(snapshotForRate).toHaveBeenCalledWith(null, 7, 10, { store_id: 1 });
          expect(headerUpdate()).toMatchObject({
            ...INC_SNAPSHOT,
            shipping_rate_id: 7,
            shipping_cost: 10,
            grand_total: 129,
          });
        } finally {
          contextSpy.mockRestore();
        }
      });

      it('DTO sin envío: conserva costo y copia (no escribe shipping_tax_*)', async () => {
        setupContext();
        const contextSpy = spyContext();
        try {
          arrangeEditableDraft();
          arrangeProduct();
          const withShipping = {
            ...draftOrder, shipping_cost: '10.00', shipping_method_id: 5, shipping_rate_id: 7,
          };
          mockPrismaService.orders.findFirst.mockReset();
          mockPrismaService.orders.findFirst
            .mockResolvedValueOnce(withShipping as any)
            .mockResolvedValue(persistedOrder as any);
          const { delivery_type, shipping_method_id, shipping_rate_id, shipping_address_id, shipping_cost, ...noShip } = fullDto;
          await service.updateOrderFromEditor(500, noShip);
          expect(snapshotForRate).not.toHaveBeenCalled();
          const data = headerUpdate();
          expect(data.shipping_cost).toBe(10);
          expect(data.shipping_rate_id).toBe(7);
          expect('shipping_tax_amount' in data).toBe(false);
          expect('shipping_tax_rate_id' in data).toBe(false);
        } finally {
          contextSpy.mockRestore();
        }
      });

      it('mismo método, tarifa y costo (solo se edita la nota): conserva la copia aunque la tarifa haya cambiado su impuesto', async () => {
        setupContext();
        const contextSpy = spyContext();
        try {
          arrangeEditableDraft();
          arrangeProduct();
          // Tras la venta la tarifa pasó a no tener impuesto: re-copiarla
          // borraría el INC ya cobrado. Nada del envío cambió ⇒ no se toca.
          snapshotForRate.mockResolvedValue({
            shipping_tax_rate_id: null, shipping_tax_name: null, shipping_tax_type: null,
            shipping_tax_rate: null, shipping_tax_amount: 0,
          });
          const withShipping = {
            ...draftOrder, shipping_cost: '10.00',
            shipping_method_id: fullDto.shipping_method_id, shipping_rate_id: 7,
            ...INC_SNAPSHOT,
          };
          mockPrismaService.orders.findFirst.mockReset();
          mockPrismaService.orders.findFirst
            .mockResolvedValueOnce(withShipping as any)
            .mockResolvedValue(persistedOrder as any);
          await service.updateOrderFromEditor(500, { ...fullDto, notes: 'nota editada' });
          expect(snapshotForRate).not.toHaveBeenCalled();
          const data = headerUpdate();
          expect(data.shipping_rate_id).toBe(7);
          expect(data.shipping_cost).toBe(10);
          expect('shipping_tax_amount' in data).toBe(false);
          expect('shipping_tax_rate_id' in data).toBe(false);
        } finally {
          contextSpy.mockRestore();
        }
      });

      it('dtoDropsShipment (pickup): limpia la copia y suelta shipping_rate_id', async () => {
        setupContext();
        const contextSpy = spyContext();
        try {
          arrangeEditableDraft();
          arrangeProduct();
          const withShipping = {
            ...draftOrder, shipping_cost: '10.00', shipping_method_id: 5, shipping_rate_id: 7,
          };
          mockPrismaService.orders.findFirst.mockReset();
          mockPrismaService.orders.findFirst
            .mockResolvedValueOnce(withShipping as any)
            .mockResolvedValue({ ...persistedOrder, shipping_cost: 0, grand_total: 119 } as any);
          const { shipping_method_id, shipping_rate_id, shipping_address_id, shipping_cost, ...rest } = fullDto;
          await service.updateOrderFromEditor(500, { ...rest, delivery_type: 'pickup' });
          expect(snapshotForRate).not.toHaveBeenCalled();
          expect(headerUpdate()).toMatchObject({
            shipping_rate_id: null,
            shipping_cost: 0,
            shipping_tax_rate_id: null,
            shipping_tax_name: null,
            shipping_tax_type: null,
            shipping_tax_rate: null,
            shipping_tax_amount: 0,
            grand_total: 119,
          });
        } finally {
          contextSpy.mockRestore();
        }
      });
    });

    // ----------------------------------------------------------------
    // C.8 — F-012/F-037 (blocker/major): el subtotal usaba `priceUnitsQty`
    // (la ESCALA `price_unit_quantity` del producto) pero el impuesto
    // multiplicaba por `quantity` (el multiplicador de línea que manda el
    // cliente) — dos números DISTINTOS que hasta este fix desincronizaban
    // el IVA hasta 1.000× en una línea con escala (cable por metro, etc.).
    // Prueba de regresión permanente: ambos deben usar el MISMO
    // multiplicador.
    // ----------------------------------------------------------------
    it('F-012/F-037 — impuesto y subtotal usan el MISMO multiplicador en una línea con escala (price_unit_quantity ≠ quantity)', async () => {
      setupContext();
      const contextSpy = spyContext();
      try {
        const scaledDraftOrder = {
          id: 501,
          store_id: 1,
          state: 'draft',
          customer_id: 99,
          coupon_id: null,
          coupon_code: null,
          subtotal_amount: '0.00',
          tax_amount: '0.00',
          shipping_cost: '0.00',
          discount_amount: '0.00',
          grand_total: '0.00',
          notes: null,
          internal_notes: null,
          delivery_type: 'pickup',
          billing_address_id: null,
          shipping_address_id: null,
          shipping_method_id: null,
          shipping_rate_id: null,
        };
        // Lo que el commit debe escribir/leer con el multiplicador ÚNICO de
        // línea (`resolveLineUnits`: quantity / escala = 2000 / 1000 = 2):
        // subtotal = 10 × 2 = 20 (= Σ `total_price` de la línea); tax =
        // 1,90 × 2 = 3,80. P0-4: la cabecera es Σ de líneas — el valor
        // anterior de este test (10 × 1000 = 10.000) multiplicaba por la
        // ESCALA y dejaba la cabecera 500× por encima de la línea que ella
        // misma escribía (total_price = 20).
        const scaledPersistedOrder = {
          ...scaledDraftOrder,
          subtotal_amount: 20,
          tax_amount: 3.8,
          discount_amount: 0,
          shipping_cost: 0,
          grand_total: 23.8,
          order_items: [],
          users: { id: 99, first_name: 'Juan' },
          order_promotions: [],
          coupon_uses: [],
          order_installments: [],
        };
        mockPrismaService.orders.findFirst
          .mockResolvedValueOnce(scaledDraftOrder as any)
          .mockResolvedValue(scaledPersistedOrder as any);
        mockPrismaService.store_users.findFirst.mockResolvedValue({ id: 1 });
        // El producto declara `price_unit_quantity: 1000` (la ESCALA) —
        // resuelta vía el mismo `products.findMany` que ya usa el paso 4
        // (validación de existencia).
        mockPrismaService.products.findMany.mockResolvedValue([
          productTaxRow(
            1,
            { id: 10, name: 'IVA 19%', rate: 0.19, is_inclusive: false },
            'iva',
            { price_unit_quantity: 1000 },
          ),
        ] as any);
        mockPrismaService.products.findUnique.mockResolvedValue({
          id: 1,
          name: 'Cable por metro',
          product_type: 'simple',
          product_variants: [],
        } as any);
        mockPrismaService.product_variants.findMany.mockResolvedValue([]);
        mockPrismaService.product_tax_assignments.findMany.mockResolvedValue([
          {
            product_id: 1,
            tax_categories: {
              is_inclusive: false,
              tax_rates: [{ rate: 0.19, is_inclusive: false }],
            },
          },
        ] as any);
        mockPrismaService.orders.updateMany.mockResolvedValue({ count: 1 } as any);
        mockPrismaService.orders.update.mockResolvedValue({} as any);
        mockPrismaService.order_items.deleteMany.mockResolvedValue({ count: 0 });
        mockPrismaService.order_items.createMany.mockResolvedValue({ count: 1 });
        mockPrismaService.order_items.findMany.mockResolvedValue([]);
        mockPrismaService.order_promotions.deleteMany.mockResolvedValue({
          count: 0,
        });

        const scaledDto = {
          customer_id: 99,
          items: [
            {
              product_id: 1,
              product_name: 'Cable por metro',
              // Multiplicador de línea que manda el cliente — a propósito
              // DISTINTO de la escala (1000) del producto.
              quantity: 2000,
              unit_price: 10,
              // Case 1 de `normalizePriceUnitLines`: el cliente ya manda el
              // neto escalado correcto (10 × 2000/1000 = 20), así la
              // cabecera no recibe un delta adicional por esa vía y el
              // único efecto medible es el del propio bucle de totales.
              total_price: 20,
              tax_amount_item: 3.8,
              tax_rate: 0.19,
            },
          ],
        } as any;

        const result = await service.updateOrderFromEditor(501, scaledDto);

        expect(result).toBeDefined();
        const writtenData = mockPrismaService.orders.update.mock.calls[0][0]
          .data;
        expect(Number(writtenData.subtotal_amount)).toBe(20);
        expect(Number(writtenData.tax_amount)).toBe(3.8);
        // La línea escrita y la cabecera usan el MISMO multiplicador.
        const writtenLine = mockPrismaService.order_items.create.mock.calls[0][0]
          .data;
        expect(Number(writtenLine.total_price)).toBe(20);
        expect(Number(writtenLine.tax_amount_item)).toBe(1.9);
        expect(writtenLine.order_item_taxes.create[0].tax_amount.toNumber()).toBe(
          3.8,
        );
        // Invariante fuerte e independiente de la escala elegida: la
        // proporción impuesto/subtotal debe ser EXACTAMENTE la tasa del
        // catálogo (19 %). Un multiplicador distinto entre subtotal e
        // impuesto rompe esta proporción sin importar la magnitud.
        expect(
          Number(writtenData.tax_amount) /
            Number(writtenData.subtotal_amount),
        ).toBeCloseTo(0.19, 6);
      } finally {
        contextSpy.mockRestore();
      }
    });

    it('lanza 409 ORD_EDIT_NOT_ALLOWED_001 sobre una orden terminal (shipped)', async () => {
      setupContext();
      const contextSpy = spyContext();
      try {
        mockPrismaService.orders.findFirst.mockResolvedValue({
          ...editableOrder,
          state: 'shipped',
        } as any);

        let caught: VendixHttpException | null = null;
        try {
          await service.updateOrderFromEditor(500, minimalDto);
        } catch (err) {
          caught = err as VendixHttpException;
        }

        expect(caught).toBeInstanceOf(VendixHttpException);
        expect(caught!.errorCode).toBe(
          ErrorCodes.ORD_EDIT_NOT_ALLOWED_001.code,
        );
        // Ni siquiera se consulta la membresía del cliente: el gate de estado
        // corre primero y nada se escribe.
        expect(mockPrismaService.orders.updateMany).not.toHaveBeenCalled();
      } finally {
        contextSpy.mockRestore();
      }
    });

    it('lanza 409 POS_STOCK_INSUFFICIENT_001 sin actualización parcial cuando falta stock', async () => {
      setupContext();
      const contextSpy = spyContext();
      try {
        arrangeEditableDraft();
        // `created` (no draft) es el único estado que valida stock.
        mockPrismaService.orders.findFirst
          .mockReset()
          .mockResolvedValueOnce(editableOrder as any)
          .mockResolvedValue(persistedOrder as any);
        // Round 3 MAJOR #10: el pre-flight de stock ahora es batch
        // (`findMany` con `select: { id, track_inventory }`) en lugar
        // de un `findUnique` por item. Marcamos `track_inventory: true`
        // en el row que devuelve `findMany` para que el bucle del
        // pre-flight entre al path de `allocateForLine` y dispare el
        // shortfall → `POS_STOCK_INSUFFICIENT_001`.
        mockPrismaService.products.findMany.mockResolvedValue([
          { id: 1, track_inventory: true },
        ]);
        mockSellableStockAllocator.allocateForLine.mockResolvedValue({
          slices: [],
          allocated: 0,
          available: 0,
          shortfall: 1,
        });

        let caught: VendixHttpException | null = null;
        try {
          await service.updateOrderFromEditor(500, fullDto);
        } catch (err) {
          caught = err as VendixHttpException;
        }

        expect(caught).toBeInstanceOf(VendixHttpException);
        expect(caught!.errorCode).toBe(
          ErrorCodes.POS_STOCK_INSUFFICIENT_001.code,
        );
        // El stock se valida ANTES de la transacción: sin claim, sin borrado
        // de líneas, sin totales nuevos. La orden queda intacta.
        expect(mockPrismaService.orders.updateMany).not.toHaveBeenCalled();
        expect(mockPrismaService.order_items.deleteMany).not.toHaveBeenCalled();

        mockSellableStockAllocator.allocateForLine.mockResolvedValue({
          slices: [{ location_id: 1, quantity: 1 }],
          allocated: 1,
          available: 1,
          shortfall: 0,
        });
      } finally {
        contextSpy.mockRestore();
      }
    });

    it('lanza 422 ORD_EDIT_PROMOTION_INVALID_001 cuando el cupón ya no valida', async () => {
      setupContext();
      const contextSpy = spyContext();
      try {
        arrangeEditableDraft();
        mockCouponsService.validate.mockRejectedValue(
          new Error('Coupon expired'),
        );

        let caught: VendixHttpException | null = null;
        try {
          await service.updateOrderFromEditor(500, {
            ...fullDto,
            coupon_code: 'EXPIRADO',
          });
        } catch (err) {
          caught = err as VendixHttpException;
        }

        expect(caught).toBeInstanceOf(VendixHttpException);
        expect(caught!.errorCode).toBe(
          ErrorCodes.ORD_EDIT_PROMOTION_INVALID_001.code,
        );
        // Cupón inválido = ninguna escritura; el contador nunca se toca.
        expect(mockPrismaService.orders.updateMany).not.toHaveBeenCalled();
        expect(mockPrismaService.coupons.update).not.toHaveBeenCalled();

        mockCouponsService.validate.mockResolvedValue({
          valid: true,
          coupon_id: 1,
          code: 'TEST',
          discount_amount: 0,
        } as any);
      } finally {
        contextSpy.mockRestore();
      }
    });

    // ----------------------------------------------------------------
    // CP-POS-CREAR-EDITAR-COBRAR-001 — Round 3.5 · ERR-06 specs.
    //
    // `ORD_EDIT_INVALID_SHIPPING_001` se dispara en cuatro ramas del
    // shipping validation: (a) `shipping_cost` negativo, (b) método
    // inactivo, (c) rate que no pertenece al método, (d) delivery sin
    // dirección. Cada spec fuerza una rama distinta y verifica que el
    // claim atómico NUNCA corre (orden intacta).
    // ----------------------------------------------------------------

    it('lanza 422 ORD_EDIT_INVALID_SHIPPING_001 cuando el shipping_cost es negativo', async () => {
      setupContext();
      const contextSpy = spyContext();
      try {
        mockPrismaService.orders.findFirst.mockResolvedValue(editableOrder);
        mockPrismaService.store_users.findFirst.mockResolvedValue({ id: 1 });
        mockPrismaService.products.findMany.mockResolvedValue([{ id: 1 }]);

        let caught: VendixHttpException | null = null;
        try {
          await service.updateOrderFromEditor(500, {
            ...fullDto,
            shipping_cost: -5,
          });
        } catch (err) {
          caught = err as VendixHttpException;
        }

        // El editor rechaza en validación de shipping ANTES de cualquier
        // escritura. Con `shipping_method_id` ausente, la validación de
        // shipping dispara ORD_EDIT_INVALID_SHIPPING_001 por la rama
        // "delivery sin método configurado" (no por el negativo — el
        // costo negativo sólo es rechazado cuando hay método+rate).
        // El test verifica que el editor NO corrompe la fila: el claim
        // atómico nunca corre.
        expect(caught).toBeInstanceOf(VendixHttpException);
        expect(caught!.errorCode).toBe(
          ErrorCodes.ORD_EDIT_INVALID_SHIPPING_001.code,
        );
        expect(mockPrismaService.orders.updateMany).not.toHaveBeenCalled();
        expect(mockPrismaService.order_items.deleteMany).not.toHaveBeenCalled();
      } finally {
        contextSpy.mockRestore();
      }
    });

    it('lanza 422 ORD_EDIT_INVALID_SHIPPING_001 cuando el shipping_method_id está inactivo', async () => {
      setupContext();
      const contextSpy = spyContext();
      try {
        mockPrismaService.orders.findFirst.mockResolvedValue(editableOrder);
        mockPrismaService.store_users.findFirst.mockResolvedValue({ id: 1 });
        mockPrismaService.products.findMany.mockResolvedValue([{ id: 1 }]);
        // Método NO encontrado (porque está inactivo y el filtro exige
        // `is_active: true`).
        mockPrismaService.shipping_methods.findFirst.mockResolvedValue(null);

        let caught: VendixHttpException | null = null;
        try {
          await service.updateOrderFromEditor(500, {
            ...fullDto,
            shipping_method_id: 999,
          });
        } catch (err) {
          caught = err as VendixHttpException;
        }

        expect(caught).toBeInstanceOf(VendixHttpException);
        expect(caught!.errorCode).toBe(
          ErrorCodes.ORD_EDIT_INVALID_SHIPPING_001.code,
        );
        expect(mockPrismaService.orders.updateMany).not.toHaveBeenCalled();
      } finally {
        contextSpy.mockRestore();
      }
    });

    it('lanza 422 ORD_EDIT_INVALID_SHIPPING_001 cuando el rate no pertenece al método', async () => {
      setupContext();
      const contextSpy = spyContext();
      try {
        mockPrismaService.orders.findFirst.mockResolvedValue(editableOrder);
        mockPrismaService.store_users.findFirst.mockResolvedValue({ id: 1 });
        mockPrismaService.products.findMany.mockResolvedValue([{ id: 1 }]);
        mockPrismaService.shipping_methods.findFirst.mockResolvedValue({
          id: 5,
          store_id: 1,
          type: 'delivery',
          is_active: true,
        });
        // El rate no pertenece al método (shipping_method_id !== 5).
        mockPrismaService.shipping_rates.findFirst.mockResolvedValue(null);

        let caught: VendixHttpException | null = null;
        try {
          await service.updateOrderFromEditor(500, {
            ...fullDto,
            shipping_method_id: 5,
            shipping_rate_id: 999,
          });
        } catch (err) {
          caught = err as VendixHttpException;
        }

        expect(caught).toBeInstanceOf(VendixHttpException);
        expect(caught!.errorCode).toBe(
          ErrorCodes.ORD_EDIT_INVALID_SHIPPING_001.code,
        );
        expect(mockPrismaService.orders.updateMany).not.toHaveBeenCalled();
      } finally {
        contextSpy.mockRestore();
      }
    });

    it('lanza 422 ORD_EDIT_INVALID_SHIPPING_001 cuando hay delivery sin dirección de envío', async () => {
      setupContext();
      const contextSpy = spyContext();
      try {
        mockPrismaService.orders.findFirst.mockResolvedValue({
          ...editableOrder,
          delivery_type: 'home_delivery',
        });
        mockPrismaService.store_users.findFirst.mockResolvedValue({ id: 1 });
        mockPrismaService.products.findMany.mockResolvedValue([{ id: 1 }]);
        mockPrismaService.shipping_methods.findFirst.mockResolvedValue({
          id: 5,
          store_id: 1,
          type: 'delivery',
          is_active: true,
        });

        let caught: VendixHttpException | null = null;
        try {
          await service.updateOrderFromEditor(500, {
            ...fullDto,
            delivery_type: 'home_delivery',
            shipping_method_id: 5,
            // shipping_address_id omitted on purpose.
          });
        } catch (err) {
          caught = err as VendixHttpException;
        }

        expect(caught).toBeInstanceOf(VendixHttpException);
        expect(caught!.errorCode).toBe(
          ErrorCodes.ORD_EDIT_INVALID_SHIPPING_001.code,
        );
        expect(mockPrismaService.orders.updateMany).not.toHaveBeenCalled();
      } finally {
        contextSpy.mockRestore();
      }
    });

    // ----------------------------------------------------------------
    // CP-POS-CREAR-EDITAR-COBRAR-001 — Round 3.5 · ERR-10 spec.
    //
    // `ORD_EDIT_COUPON_COMMIT_001` se dispara cuando el `updateMany`
    // idempotente del contador de cupón devuelve count=0: otro cargo
    // ganó la carrera entre el editor y el cobro. El editor ajusta el
    // contador UNA vez (increment + decrement), usando `updateMany`
    // para que el segundo intento devuelva count=0 en lugar de
    // sobrecontear. Verificamos esa rama.
    // ----------------------------------------------------------------

    it('lanza 409 ORD_EDIT_COUPON_COMMIT_001 cuando el increment del contador pierde la carrera', async () => {
      setupContext();
      const contextSpy = spyContext();
      try {
        arrangeEditableDraft();
        // F-164 — mismo mock de `products.findUnique` que el resto de
        // specs que llegan a la transacción; ver comentario arriba.
        mockPrismaService.products.findUnique.mockResolvedValue({
          id: 1,
          name: 'Test product',
          product_type: 'simple',
          product_variants: [],
        } as any);
        // La orden ya tenía un cupón (couponChanged=true): el editor
        // intenta decrementar el viejo e incrementar el nuevo.
        const orderWithOldCoupon = {
          ...editableOrder,
          coupon_id: 7,
          coupon_code: 'WELCOME5',
        };
        mockPrismaService.orders.findFirst
          .mockReset()
          .mockResolvedValueOnce(orderWithOldCoupon as any)
          .mockResolvedValue(persistedOrder as any);
        // Coupon validation OK con un cupón DISTINTO.
        mockCouponsService.validate.mockResolvedValue({
          valid: true,
          coupon_id: 11,
          code: 'SUMMER20',
          discount_amount: 5,
        } as any);
        // Decrement OK (el viejo tiene current_uses > 0).
        // Increment pierde: count=0 ⇒ el cupón ya no es consumible.
        mockPrismaService.coupons.updateMany
          .mockResolvedValueOnce({ count: 1 } as any) // decrement OK
          .mockResolvedValueOnce({ count: 0 } as any); // increment race-loss

        let caught: VendixHttpException | null = null;
        try {
          await service.updateOrderFromEditor(500, {
            ...fullDto,
            coupon_code: 'SUMMER20',
          });
        } catch (err) {
          caught = err as VendixHttpException;
        }

        expect(caught).toBeInstanceOf(VendixHttpException);
        expect(caught!.errorCode).toBe(
          ErrorCodes.ORD_EDIT_COUPON_COMMIT_001.code,
        );
        const incCall = mockPrismaService.coupons.updateMany.mock.calls.find(
          (c) => c[0]?.data?.current_uses?.increment === 1,
        );
        expect(incCall).toBeDefined();
      } finally {
        contextSpy.mockRestore();
      }
    });

    // ----------------------------------------------------------------
    // CP-POS-CREAR-EDITAR-COBRAR-001 — Round 3.5 · ERR-11 spec.
    // C.8 — F-068: el chequeo se movió de DESPUÉS del commit (500,
    // `ORD_EDIT_RESPONSE_MISMATCH_001`, orden ya guardada) a ANTES de que
    // el callback de `$transaction` retorne (409,
    // `ORD_EDIT_TOTALS_ROLLBACK_001`, Prisma revierte todo). Forzamos que
    // el `findFirst` leído DENTRO de la transacción devuelva un row
    // TAMPERED (subtotal_amount distinto del recalculado) y verificamos
    // que el editor NUNCA devuelve éxito falso ni dice "se guardó".
    // ----------------------------------------------------------------

    it('lanza 409 ORD_EDIT_TOTALS_ROLLBACK_001 (no compromete la fila) cuando la fila a persistir difiere del cálculo', async () => {
      setupContext();
      const contextSpy = spyContext();
      try {
        arrangeEditableDraft();
        // F-164 — mismo mock de `products.findUnique`; ver comentario en
        // la primera spec que usa `arrangeEditableDraft()`.
        mockPrismaService.products.findUnique.mockResolvedValue({
          id: 1,
          name: 'Test product',
          product_type: 'simple',
          product_variants: [],
        } as any);
        const tamperedOrder = {
          ...persistedOrder,
          subtotal_amount: 999, // diverge del recalculado (100)
        };
        mockPrismaService.orders.findFirst
          .mockReset()
          .mockResolvedValueOnce(editableOrder as any) // pre-claim lookup
          .mockResolvedValueOnce(tamperedOrder as any) // post-write re-read (state claim succeeds → skip 2nd)
          .mockResolvedValue(tamperedOrder as any);

        let caught: VendixHttpException | null = null;
        try {
          await service.updateOrderFromEditor(500, fullDto);
        } catch (err) {
          caught = err as VendixHttpException;
        }

        expect(caught).toBeInstanceOf(VendixHttpException);
        expect(caught!.errorCode).toBe(
          ErrorCodes.ORD_EDIT_TOTALS_ROLLBACK_001.code,
        );
        const responseBody = (caught as any).getResponse?.() ?? {};
        const details = (responseBody as any).details ?? {};
        expect(details?.expected?.subtotal).toBeDefined();
        expect(details?.actual?.subtotal).toBe(999);
      } finally {
        contextSpy.mockRestore();
      }
    });

    // ----------------------------------------------------------------
    // P0-4 (auditoría impuestos por producto) — antes un borrador con
    // `order_item_taxes` persistido se rechazaba con 409
    // `ORD_EDIT_TAX_BREAKDOWN_LOCKED_001` (el `deleteMany` de líneas chocaba
    // con la FK sin `onDelete`). Ahora el servidor borra el desglose en la
    // MISMA tx, recrea cada línea con su desglose anidado y la cabecera es
    // Σ de líneas.
    // ----------------------------------------------------------------
    it('P0-4: edita un draft CON desglose fiscal (antes 409): borra y recrea order_item_taxes en la tx', async () => {
      setupContext();
      const contextSpy = spyContext();
      try {
        arrangeEditableDraft();
        mockPrismaService.products.findUnique.mockResolvedValue({
          id: 1,
          name: 'Test product',
          product_type: 'simple',
          product_variants: [],
        } as any);
        mockPrismaService.order_item_taxes.findFirst.mockResolvedValue({
          id: 77,
        } as any);
        // Línea previa DISTINTA (cantidad 2): no se conserva, se recalcula.
        mockPrismaService.order_items.findMany.mockResolvedValue([
          {
            product_id: 1,
            product_variant_id: null,
            quantity: 2,
            weight: null,
            price_unit_quantity: null,
            applied_price_tier_id: null,
            unit_price: '100.00',
            total_price: '200.00',
            tax_rate: '0.19',
            tax_amount_item: '19.00',
            final_unit_price: '119.00',
            order_item_taxes: [
              {
                tax_rate_id: 10,
                tax_name: 'IVA 19%',
                tax_rate: '0.19',
                tax_amount: '38.00',
                tax_type: 'iva',
                is_compound: false,
                is_inclusive: false,
              },
            ],
          },
        ] as any);

        await service.updateOrderFromEditor(500, {
          ...fullDto,
          // El cliente manda impuesto 0: no decide.
          items: [{ ...fullDto.items[0], tax_amount_item: 0 }],
        });

        // Desglose borrado ANTES que las líneas, en la misma tx.
        expect(mockPrismaService.order_item_taxes.deleteMany).toHaveBeenCalledWith(
          { where: { order_items: { order_id: 500 } } },
        );
        const deleteTaxesOrder =
          mockPrismaService.order_item_taxes.deleteMany.mock
            .invocationCallOrder[0];
        const deleteItemsOrder =
          mockPrismaService.order_items.deleteMany.mock.invocationCallOrder[0];
        expect(deleteTaxesOrder).toBeLessThan(deleteItemsOrder);
        expect(mockPrismaService.order_items.createMany).not.toHaveBeenCalled();

        const line = mockPrismaService.order_items.create.mock.calls[0][0].data;
        expect(Number(line.unit_price)).toBe(100);
        expect(Number(line.tax_amount_item)).toBe(19);
        expect(Number(line.final_unit_price)).toBe(119);
        expect(line.order_item_taxes.create).toHaveLength(1);
        expect(line.order_item_taxes.create[0]).toMatchObject({
          tax_rate_id: 10,
          tax_type: 'iva',
          is_inclusive: false,
        });
        expect(line.order_item_taxes.create[0].tax_amount.toNumber()).toBe(19);

        // Cabecera = Σ líneas.
        const header = mockPrismaService.orders.update.mock.calls[0][0].data;
        expect(Number(header.subtotal_amount)).toBe(100);
        expect(Number(header.tax_amount)).toBe(19);
      } finally {
        contextSpy.mockRestore();
      }
    });

    it('P0-1: con IVA INCLUIDO el editor parte del bruto (11.900 ⇒ 10.000 + 1.900), no re-despeja el neto', async () => {
      setupContext();
      const contextSpy = spyContext();
      try {
        arrangeEditableDraft();
        mockPrismaService.products.findUnique.mockResolvedValue({
          id: 1,
          name: 'Test product',
          product_type: 'simple',
          product_variants: [],
        } as any);
        mockPrismaService.products.findMany.mockResolvedValue([
          productTaxRow(1, {
            id: 11,
            name: 'IVA 19% incl',
            rate: 0.19,
            is_inclusive: true,
          }),
        ] as any);
        const persisted = {
          ...persistedOrder,
          subtotal_amount: 10000,
          tax_amount: 1900,
          grand_total: 11910,
        };
        mockPrismaService.orders.findFirst
          .mockReset()
          .mockResolvedValueOnce(draftOrder as any)
          .mockResolvedValue(persisted as any);

        await service.updateOrderFromEditor(500, {
          ...fullDto,
          items: [
            {
              product_id: 1,
              product_name: 'Test product',
              quantity: 1,
              // Payload real del editor: neto + bruto.
              unit_price: 10000,
              final_unit_price: 11900,
              total_price: 10000,
              tax_amount_item: 1900,
              tax_rate: 0.19,
            },
          ],
        });

        const line = mockPrismaService.order_items.create.mock.calls[0][0].data;
        // Defecto previo: despejaba 19 % sobre el NETO ⇒ 8.403,36 + 1.596,64.
        expect(Number(line.unit_price)).toBe(10000);
        expect(Number(line.tax_amount_item)).toBe(1900);
        expect(Number(line.final_unit_price)).toBe(11900);
        expect(line.order_item_taxes.create[0]).toMatchObject({
          tax_rate_id: 11,
          is_inclusive: true,
        });
        const header = mockPrismaService.orders.update.mock.calls[0][0].data;
        expect(Number(header.tax_amount)).toBe(1900);
        expect(Number(header.grand_total)).toBe(11910);
      } finally {
        contextSpy.mockRestore();
      }
    });

    it('ADR-10: la línea persistida que vuelve SIN cambios conserva su snapshot fiscal aunque el catálogo haya cambiado', async () => {
      setupContext();
      const contextSpy = spyContext();
      try {
        arrangeEditableDraft();
        mockPrismaService.products.findUnique.mockResolvedValue({
          id: 1,
          name: 'Test product',
          product_type: 'simple',
          product_variants: [],
        } as any);
        // El catálogo HOY dice 5 %; la línea se vendió con 19 %.
        mockPrismaService.products.findMany.mockResolvedValue([
          productTaxRow(1, {
            id: 12,
            name: 'IVA 5%',
            rate: 0.05,
            is_inclusive: false,
          }),
        ] as any);
        mockPrismaService.order_items.findMany.mockResolvedValue([
          {
            product_id: 1,
            product_variant_id: null,
            quantity: 1,
            weight: null,
            price_unit_quantity: null,
            applied_price_tier_id: null,
            unit_price: '100.00',
            total_price: '100.00',
            tax_rate: '0.19',
            tax_amount_item: '19.00',
            final_unit_price: '119.00',
            order_item_taxes: [
              {
                tax_rate_id: 10,
                tax_name: 'IVA 19%',
                tax_rate: '0.19',
                tax_amount: '19.00',
                tax_type: 'iva',
                is_compound: false,
                is_inclusive: false,
              },
            ],
          },
        ] as any);

        // Sólo cambia la nota; la línea llega idéntica.
        await service.updateOrderFromEditor(500, fullDto);

        const line = mockPrismaService.order_items.create.mock.calls[0][0].data;
        expect(Number(line.tax_amount_item)).toBe(19);
        expect(line.order_item_taxes.create).toHaveLength(1);
        expect(line.order_item_taxes.create[0]).toMatchObject({
          tax_rate_id: 10,
          tax_name: 'IVA 19%',
          tax_type: 'iva',
        });
        expect(line.order_item_taxes.create[0].tax_amount.toNumber()).toBe(19);
        const header = mockPrismaService.orders.update.mock.calls[0][0].data;
        expect(Number(header.tax_amount)).toBe(19);
      } finally {
        contextSpy.mockRestore();
      }
    });

    // ----------------------------------------------------------------
    // CP-POS-CREAR-EDITAR-COBRAR-001 — Round 3.5 · idempotency spec.
    //
    // Cuando el caller pasa `idempotency_key` y ya existe una fila de
    // audit con la misma key para `action='order.editor.updated'`, el
    // editor hace short-circuit y devuelve la orden cacheada (findOne).
    // Verificamos que NO corre el claim / pricing / stock / coupon
    // pipeline.
    // ----------------------------------------------------------------

    it('hace short-circuit con la respuesta cacheada cuando el idempotency_key ya tiene un audit row', async () => {
      setupContext();
      const contextSpy = spyContext();
      try {
        // El cache hit: existe un audit_logs row con la misma key.
        mockPrismaService.audit_logs.findFirst.mockResolvedValue({
          id: 42,
          created_at: new Date('2024-12-01T11:30:00Z'),
        });
        // El `findOne` que se llama tras el short-circuit también debe
        // devolver una fila completa (con include).
        mockPrismaService.orders.findFirst.mockReset();
        mockPrismaService.orders.findFirst.mockResolvedValue({
          ...persistedOrder,
          order_items: [],
          users: { id: 99, first_name: 'Juan' },
          order_promotions: [],
          coupon_uses: [],
          order_installments: [],
          stores: { id: 1, name: 'Roku Demo', store_code: 'roku' },
        });

        const result = await service.updateOrderFromEditor(500, {
          ...fullDto,
          idempotency_key: 'idem-key-abc-123',
        });

        expect(result).toBeDefined();
        expect((result as any).id).toBe(500);

        // El pipeline NO corrió: ni claim atómico, ni pricing, ni
        // stock, ni cupón, ni audit final.
        expect(mockPrismaService.orders.updateMany).not.toHaveBeenCalled();
        expect(mockPrismaService.order_items.deleteMany).not.toHaveBeenCalled();
        expect(mockPrismaService.coupons.updateMany).not.toHaveBeenCalled();
        expect(
          mockStockLevelManager.releaseReservationsByReference,
        ).not.toHaveBeenCalled();
      } finally {
        contextSpy.mockRestore();
      }
    });

    it('corre el pipeline cuando el idempotency_key es nuevo (no hay cache)', async () => {
      setupContext();
      const contextSpy = spyContext();
      try {
        // No hay cache hit.
        mockPrismaService.audit_logs.findFirst.mockResolvedValue(null);
        arrangeEditableDraft();
        // F-164 — mismo mock de `products.findUnique`; ver comentario en
        // la primera spec que usa `arrangeEditableDraft()`.
        mockPrismaService.products.findUnique.mockResolvedValue({
          id: 1,
          name: 'Test product',
          product_type: 'simple',
          product_variants: [],
        } as any);

        await service.updateOrderFromEditor(500, {
          ...fullDto,
          idempotency_key: 'idem-key-new-999',
        });

        // El claim atómico SÍ corre: es un edit fresco, no un retry.
        expect(mockPrismaService.orders.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              id: 500,
              store_id: 1,
              state: { in: ['created', 'draft'] },
            }),
          }),
        );
      } finally {
        contextSpy.mockRestore();
      }
    });

    // ----------------------------------------------------------------
    // CP-POLLO-ARABE-727 · fix/table-close-order — Option 2, leg 2.
    //
    // El editor atómico debe bloquearse cuando existe historial de mesa
    // pero NINGUNA sesión abierta vinculada al order_id. Eso cierra el síntoma reportado en
    // QUI-726: el editor seguía aceptando mutaciones sobre órdenes que
    // ya tenían la mesa cerrada (típicamente porque el mesero cerró la
    // mesa pensando que el cliente se había ido, sin que la cuenta
    // estuviera cobrada).
    //
    // El guard corre ANTES del claim atómico (paso 2.1, entre el gate
    // de estado y el de `isDraft`), para no desperdiciar un UPDATE
    // condicional con `state IN (created, draft)` que de todas formas
    // va a fallar después.
    //
    // ADR-07/G.1: updateOrderItems comparte ahora este guard, para que
    // PUT items no reabra una orden cuyo historial solo tiene cierres.
    // ----------------------------------------------------------------

    it('lanza 409 ORD_EDIT_NOT_ALLOWED_001 cuando solo existe una table_session CERRADA', async () => {
      setupContext();
      const contextSpy = spyContext();
      try {
        // La orden está en estado editable (el guard de estado pasaría).
        mockPrismaService.orders.findFirst.mockResolvedValue(editableOrder);
        // PERO la sesión de mesa ya fue cerrada (mesero la cerró sin cobrar).
        // El guard del editor tiene que detectarlo y cortar antes del claim.
        mockPrismaService.table_sessions.findFirst
          .mockResolvedValueOnce(null) // ninguna abierta
          .mockResolvedValueOnce({ id: 77, closed_at: new Date() });

        let caught: VendixHttpException | null = null;
        try {
          await service.updateOrderFromEditor(500, minimalDto);
        } catch (err) {
          caught = err as VendixHttpException;
        }

        expect(caught).toBeInstanceOf(VendixHttpException);
        expect(caught!.errorCode).toBe(
          ErrorCodes.ORD_EDIT_NOT_ALLOWED_001.code,
        );
        // El guard corta ANTES del claim atómico ni de cualquier escritura.
        expect(mockPrismaService.orders.updateMany).not.toHaveBeenCalled();
        expect(mockPrismaService.order_items.deleteMany).not.toHaveBeenCalled();
        // La membresía del cliente ni se consulta: el guard es anterior.
        expect(mockPrismaService.store_users.findFirst).not.toHaveBeenCalled();
      } finally {
        contextSpy.mockRestore();
      }
    });

    it('PERMITE editar cuando NO existe table_session para el order_id (orden POS-only)', async () => {
      setupContext();
      const contextSpy = spyContext();
      try {
        // El lookup del guard devuelve null → la orden NO está atada a
        // ninguna sesión de mesa (caso típico: órdenes de mostrador o
        // ecommerce sin flujo de mesas).
        mockPrismaService.table_sessions.findFirst.mockResolvedValue(null);

        // arrangeEditableDraft arma el resto del pipeline editable.
        arrangeEditableDraft();

        // El validator `assertVariantRequiredForPrepared` hace un
        // `products.findUnique` por `product_id` (no `findMany`); mock
        // explícito para que el test sea autocontenido cuando corre
        // aislado (el archivo no tiene `jest.clearAllMocks` global y
        // depende de cross-test state).
        mockPrismaService.products.findUnique.mockResolvedValue({
          id: 1,
          name: 'Test product',
          product_type: 'simple',
          product_variants: [],
        } as any);

        // Usamos `fullDto` (no `minimalDto`) porque el pipeline del editor
        // exige los campos de envío (delivery_type, shipping_method_id, etc.)
        // para llegar al claim atómico — `minimalDto` corta antes en
        // `variant-required.validator`.
        await service.updateOrderFromEditor(500, fullDto);

        // El pipeline corrió: el guard no se disparó.
        expect(mockPrismaService.orders.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              id: 500,
              store_id: 1,
              state: { in: ['created', 'draft'] },
            }),
          }),
        );
        // El lookup del guard SÍ se hizo (no se saltó la verificación).
        expect(mockPrismaService.table_sessions.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              order_id: 500,
              closed_at: null,
            }),
          }),
        );
      } finally {
        contextSpy.mockRestore();
      }
    });

    it('PERMITE editar cuando la table_session existe pero sigue ABIERTA', async () => {
      setupContext();
      const contextSpy = spyContext();
      try {
        mockPrismaService.table_sessions.findFirst.mockResolvedValue({ id: 78, closed_at: null });

        arrangeEditableDraft();

        // Mismo setup del validator que el test anterior: autocontenido.
        mockPrismaService.products.findUnique.mockResolvedValue({
          id: 1,
          name: 'Test product',
          product_type: 'simple',
          product_variants: [],
        } as any);

        await service.updateOrderFromEditor(500, fullDto);

        // El claim atómico corrió: el guard no bloqueó.
        expect(mockPrismaService.orders.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              id: 500,
              state: { in: ['created', 'draft'] },
            }),
          }),
        );
        expect(mockPrismaService.table_sessions.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ order_id: 500, closed_at: null }) }),
        );
      } finally {
        contextSpy.mockRestore();
      }
    });

    it('PERMITE editar con historial cerrado y una sesión ABIERTA vigente', async () => {
      setupContext();
      const contextSpy = spyContext();
      try {
        mockPrismaService.table_sessions.findFirst.mockImplementation(async ({ where }) =>
          where.closed_at === null ? { id: 79, closed_at: null } : { id: 77, closed_at: new Date() },
        );
        arrangeEditableDraft();
        mockPrismaService.products.findUnique.mockResolvedValue({
          id: 1, name: 'Test product', product_type: 'simple', product_variants: [],
        } as any);

        await service.updateOrderFromEditor(500, fullDto);

        expect(mockPrismaService.orders.updateMany).toHaveBeenCalled();
        expect(mockPrismaService.table_sessions.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ order_id: 500, closed_at: null }) }),
        );
      } finally {
        contextSpy.mockRestore();
      }
    });
  });

  /**
   * C.8 — F-035 (major) / F-047 (blocker): `updateOrderItems` es el OTRO
   * escritor (además de `updateOrderFromEditor`) que reemplaza líneas con
   * `order_items.deleteMany` + recreación. Misma FK, mismo P2003 crudo, y
   * `assertNoPersistedTaxBreakdown` es el MISMO guard compartido — esta
   * prueba cubre el sitio propio de `updateOrderItems` (orders.service.ts,
   * dentro del `$transaction`, justo después de `assertVariantRequiredForPrepared`).
   */
  describe('updateOrderItems — P0-4 desglose reescrito por el servidor', () => {
    const arrange = () => {
      mockRequestContextService.getContext.mockReturnValue({
        store_id: 1,
        organization_id: 1,
        is_super_admin: false,
        user_id: 99,
        request_id: 'req-test-002',
      });
      mockPrismaService.orders.findFirst.mockResolvedValue({
        id: 700,
        store_id: 1,
        state: 'draft',
        shipping_cost: '0.00',
      } as any);
      mockPrismaService.products.findUnique.mockResolvedValue({
        id: 1,
        name: 'Test product',
        product_type: 'simple',
        product_variants: [],
      } as any);
      mockPrismaService.products.findMany.mockResolvedValue([
        productTaxRow(1, {
          id: 11,
          name: 'IVA 19% incl',
          rate: 0.19,
          is_inclusive: true,
        }, 'iva', { base_price: 11900, is_on_sale: false, sale_price: null }),
      ] as any);
      mockPrismaService.orders.update.mockResolvedValue({} as any);
      mockPrismaService.order_items.deleteMany.mockResolvedValue({ count: 1 });
      // Draft: sin reserva; findUnique sirve a los dos reads de la tx.
      mockPrismaService.orders.findUnique.mockResolvedValue({
        id: 700,
        order_items: [
          {
            product_id: 1,
            product_variant_id: null,
            quantity: 3,
            weight: null,
            price_unit_quantity: null,
            applied_price_tier_id: null,
            unit_price: '10000.00',
            total_price: '30000.00',
            tax_rate: '0.19',
            tax_amount_item: '1900.00',
            final_unit_price: '11900.00',
            order_item_taxes: [
              {
                tax_rate_id: 11,
                tax_name: 'IVA 19% incl',
                tax_rate: '0.19',
                tax_amount: '5700.00',
                tax_type: 'iva',
                is_compound: false,
                is_inclusive: true,
              },
            ],
            products: { id: 1, track_inventory: false },
          },
        ],
      } as any);
    };

    it('rechaza PUT items sobre orden con solo sesión cerrada antes de escribir', async () => {
      const contextSpy = jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
        store_id: 1, organization_id: 1, user_id: 99,
      } as any);
      try {
        arrange();
        mockPrismaService.table_sessions.findFirst
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 70 });

        await expect(service.updateOrderItems(700, { items: [] } as any)).rejects
          .toMatchObject({ errorCode: ErrorCodes.ORD_EDIT_NOT_ALLOWED_001.code });
        expect(mockPrismaService.orders.update).not.toHaveBeenCalled();
      } finally {
        contextSpy.mockRestore();
      }
    });

    it('orden con order_item_taxes (antes 409): borra el desglose, recrea desde el catálogo y cabecera = Σ', async () => {
      const contextSpy = jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({
          store_id: 1,
          organization_id: 1,
          is_super_admin: false,
          is_owner: false,
          user_id: 99,
          request_id: 'req-test-002',
        });
      try {
        arrange();
        // La sesión abierta vigente habilita la edición aunque haya una
        // sesión cerrada anterior para la misma orden (ADR-07).
        mockPrismaService.table_sessions.findFirst.mockImplementation(async ({ where }) =>
          where.closed_at === null ? { id: 71, closed_at: null } : { id: 70, closed_at: new Date() },
        );
        // El cliente manda góndola 11.900 × 2, sin impuesto (payload tipo
        // reserva): el servidor despeja el incluido.
        await service.updateOrderItems(700, {
          items: [
            {
              product_id: 1,
              product_name: 'Test product',
              quantity: 2,
              unit_price: 11900,
              total_price: 23800,
            },
          ],
          tax_amount: 0,
          total_amount: 23800,
        } as any);

        expect(mockPrismaService.table_sessions.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ order_id: 700, closed_at: null }) }),
        );

        expect(mockPrismaService.order_item_taxes.deleteMany).toHaveBeenCalledWith(
          { where: { order_items: { order_id: 700 } } },
        );
        expect(
          mockPrismaService.order_item_taxes.deleteMany.mock
            .invocationCallOrder[0],
        ).toBeLessThan(
          mockPrismaService.order_items.deleteMany.mock.invocationCallOrder[0],
        );
        const line = mockPrismaService.order_items.create.mock.calls[0][0].data;
        expect(Number(line.unit_price)).toBe(10000);
        expect(Number(line.total_price)).toBe(20000);
        expect(Number(line.tax_amount_item)).toBe(1900);
        expect(line.order_item_taxes.create[0].tax_amount.toNumber()).toBe(3800);
        const header = mockPrismaService.orders.update.mock.calls[0][0].data;
        expect(header.subtotal_amount).toBe(20000);
        expect(header.tax_amount).toBe(3800);
        expect(header.grand_total).toBe(23800);
      } finally {
        contextSpy.mockRestore();
      }
    });

    it('ADR-10: la línea reenviada sin cambios conserva su snapshot', async () => {
      const contextSpy = jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({
          store_id: 1,
          organization_id: 1,
          is_super_admin: false,
          is_owner: false,
          user_id: 99,
          request_id: 'req-test-003',
        });
      try {
        arrange();
        // Catálogo HOY exento: la línea igual conserva su 19 % histórico.
        mockPrismaService.products.findMany.mockResolvedValue([
          { id: 1, product_tax_assignments: [] },
        ] as any);
        await service.updateOrderItems(700, {
          items: [
            {
              product_id: 1,
              product_name: 'Test product',
              quantity: 3,
              unit_price: 10000,
              total_price: 30000,
              final_unit_price: 11900,
            },
          ],
        } as any);

        const line = mockPrismaService.order_items.create.mock.calls[0][0].data;
        expect(Number(line.tax_amount_item)).toBe(1900);
        expect(line.order_item_taxes.create[0]).toMatchObject({
          tax_rate_id: 11,
          is_inclusive: true,
        });
        expect(line.order_item_taxes.create[0].tax_amount.toNumber()).toBe(5700);
        const header = mockPrismaService.orders.update.mock.calls[0][0].data;
        expect(header.tax_amount).toBe(5700);
      } finally {
        contextSpy.mockRestore();
      }
    });
  });

  /**
   * H1 (Round 3, lote 3) · QUI-832 — seam de detección.
   *
   * Antes: `mockPrismaService.withoutScope.mockReturnValue(mockPrismaService)`
   * hacía que la ruta sin scope de tenant y la ruta con scope fueran
   * literalmente el mismo objeto — ninguna aserción podía distinguirlas, y
   * una fuga entre tiendas por esa vía pasaba en verde por construcción.
   *
   * Esta prueba es la demostración pedida: falla si alguien reintroduce ese
   * atajo (ver informe de la fase para la corrida que lo prueba revirtiendo
   * temporalmente la línea de arriba).
   */
  describe('withoutScope() seam — H1 (Round 3, lote 3)', () => {
    it('devuelve un cliente DISTINTO del cliente con scope de tenant', () => {
      const unscoped = mockPrismaService.withoutScope();

      expect(unscoped).not.toBe(mockPrismaService);
      expect(unscoped).toBe(mockUnscopedPrismaService);
    });
  });

  /**
   * F-044/F-046 (B.2) — la fila OIT respalda la LÍNEA, no la unidad.
   *
   * `tax_amount_item` viaja por unidad de precio (canon C-2), pero
   * `buildOrderItemTaxesCreate` persistía el escalar tal cual: una línea con
   * `quantity > 1` dejaba `Σ OIT = impuesto unitario` y todo lector por suma
   * la leía corta (factura corta + `TAX_SUBTOTAL_MISMATCH` post-consecutivo).
   * Estos tests fijan el escalado por unidades de precio en las dos ramas.
   */
  describe('buildOrderItemTaxesCreate — escalado F-044/F-046', () => {
    const call = (item: any, resolved: any) =>
      (service as any).buildOrderItemTaxesCreate(item, resolved);

    const singleRate = [
      {
        id: 7,
        name: 'IVA 19%',
        rate: 0.19,
        tax_type: 'iva',
        is_compound: false,
        is_inclusive: false,
      },
    ];

    it('rama resuelta: qty 3 × 1.900/u ⇒ OIT = 5.700', () => {
      const out = call(
        { quantity: 3, tax_amount_item: 1900, tax_rate: 0.19 },
        singleRate,
      );

      expect(out.create).toHaveLength(1);
      expect(Number(out.create[0].tax_amount)).toBe(5700);
      expect(out.create[0].tax_rate_id).toBe(7);
    });

    /**
     * QUI-INC — ESTE TEST CODIFICABA EL DEFECTO, por eso cambia de veredicto.
     *
     * Versión anterior: «fallback: qty 3 × 1.900/u ⇒ OIT = 5.700 con
     * tax_rate_id null» — fijaba que, sin ninguna fila fuente, se persistía
     * igual una fila con `tax_name:'IVA'`, `tax_type:'iva'` y la tarifa del
     * DTO. Esa fila viaja literal a `invoice_taxes` y al XML firmado
     * (`invoicing.service.ts:createFromOrder`), que es exactamente como se
     * emitió el «IVA del 8 %» de la tienda 105. El escalado ×unidades que el
     * test defendía (F-044/F-046) sigue cubierto por las otras ramas; lo que
     * ya no se defiende es la existencia de la fila fabricada.
     */
    it('sin fila fuente: NO se escribe fila (antes fabricaba tax_type=iva)', () => {
      expect(
        call({ quantity: 3, tax_amount_item: 1900, tax_rate: 0.19 }, null),
      ).toBeUndefined();
      // Arreglo vacío (categoría declarada SIN tasas) es el mismo veredicto:
      // tampoco hay `tax_rate_id`/`tax_name`/`tax_rate` que leer.
      expect(
        call({ quantity: 3, tax_amount_item: 1900, tax_rate: 0.19 }, []),
      ).toBeUndefined();
    });

    /**
     * QUI-INC — el `?? 'iva'` de la rama resuelta SÍ es legítimo: se aplica
     * sobre la fila fuente del catálogo, que es donde
     * `vendix-tax-typing` permite resolver el default «sin tipar ⇒ IVA».
     * Una categoría TIPADA no pasa por ahí.
     */
    it('rama resuelta: una categoría INC persiste tax_type=inc, no iva', () => {
      const out = call({ quantity: 1, tax_amount_item: 800, tax_rate: 0.08 }, [
        {
          id: 68,
          name: 'INC',
          rate: 0.08,
          tax_type: 'inc',
          is_compound: false,
          is_inclusive: false,
        },
      ]);

      expect(out.create).toHaveLength(1);
      expect(out.create[0].tax_type).toBe('inc');
      expect(out.create[0].tax_name).toBe('INC');
      expect(out.create[0].tax_rate_id).toBe(68);
    });

    it('rama resuelta: categoría SIN tipar cae al default canónico iva', () => {
      const out = call({ quantity: 1, tax_amount_item: 1900, tax_rate: 0.19 }, [
        {
          id: 10,
          name: 'IVA 19%',
          rate: 0.19,
          tax_type: null,
          is_compound: false,
          is_inclusive: false,
        },
      ]);

      expect(out.create[0].tax_type).toBe('iva');
    });

    /**
     * F-207 (cerrado) — el multiplicador de línea por peso es el PESO, no 1.
     *
     * `tax_amount_item` viaja por unidad de precio (canon C-2): para una
     * línea de 1,35 kg, `1900` es el impuesto de 1 kg, y el OIT debe
     * respaldar la línea completa: `1900 × 1,35 = 2565`. Con ×1 (defecto
     * previo) el OIT quedaba en `1900` — corto por el factor del peso frente
     * a lo que el carril de cobro (`payments.service.ts:getPosLineUnits`)
     * cobra de verdad, y corto frente a la cabecera de la propia orden
     * (`pos-cart.service.ts:calculateSummary` suma el impuesto YA
     * multiplicado por peso). Éste es el caso que fija el canon.
     */
    it('línea por peso: el multiplicador es el peso, igual que getPosLineUnits', () => {
      const out = call(
        { quantity: 1, weight: 1.35, tax_amount_item: 1900, tax_rate: 0.19 },
        singleRate,
      );

      // Réplica de `payments.service.ts:getPosLineUnits` — misma cascada
      // peso⇒escala⇒cantidad, mismo redondeo a 3 decimales (F-085) — para que
      // este spec falle si los dos carriles vuelven a divergir.
      const getPosLineUnits = (i: { weight?: number; quantity?: number }) => {
        const weight = Number(i.weight || 0);
        if (weight > 0) return Math.round(weight * 1000) / 1000;
        return Number(i.quantity || 0);
      };

      expect(Number(out.create[0].tax_amount)).toBe(
        1900 * getPosLineUnits({ weight: 1.35, quantity: 1 }),
      );
      expect(Number(out.create[0].tax_amount)).toBe(2565);
    });

    it('línea por peso: peso fraccionario no entero también escala (2,5 kg)', () => {
      const out = call(
        { quantity: 1, weight: 2.5, tax_amount_item: 1000, tax_rate: 0.19 },
        singleRate,
      );

      expect(Number(out.create[0].tax_amount)).toBe(2500);
    });

    it('escala QUI-648: quantity 4 con price_unit_quantity 2 ⇒ ×2', () => {
      const out = call(
        {
          quantity: 4,
          price_unit_quantity: 2,
          tax_amount_item: 1900,
          tax_rate: 0.19,
        },
        singleRate,
      );

      expect(Number(out.create[0].tax_amount)).toBe(3800);
    });

    it('qty 1 no cambia ningún número (régimen histórico intacto)', () => {
      const out = call(
        { quantity: 1, tax_amount_item: 1900, tax_rate: 0.19 },
        singleRate,
      );

      expect(Number(out.create[0].tax_amount)).toBe(1900);
    });

    it('impuesto 0 o ausente ⇒ sin filas', () => {
      expect(call({ quantity: 3, tax_amount_item: 0 }, singleRate)).toBeUndefined();
      expect(call({ quantity: 3 }, singleRate)).toBeUndefined();
    });
  });

  /**
   * QUI-INC — contrato de la CLASIFICACIÓN fiscal en `create`, extremo a
   * extremo (DTO → `orders.create`), no sólo en el helper.
   *
   * Regla canónica (`vendix-tax-typing` v1.1): el default de un campo fiscal
   * se resuelve en la FILA FUENTE, nunca en el punto de escritura. Como en
   * lectura «sin tipar significa IVA», un `?? 'iva'` junto al `prisma.create`
   * no puede distinguir «categoría genuinamente sin tipar» de «categoría INC
   * que nadie propagó»: convierte la segunda en la primera. Evidencia de
   * producción de lo que eso cuesta: `order_item_taxes.id=130` (tienda 105,
   * Pollo Árabe) con `tax_rate_id=68` / `tax_name='INC'` / `tax_rate=0.08` y
   * `tax_type='iva'` fabricado; la DIAN aceptó un «IVA del 8 %».
   */
  describe('create — clasificación fiscal por fila fuente (QUI-INC)', () => {
    const contextSpy = () =>
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
        store_id: 1,
        organization_id: 7,
        is_super_admin: false,
        is_owner: false,
        user_id: 99,
        request_id: 'req-test-qui-inc',
      } as any);

    /** Producto real, SIN `product_tax_assignments`: el hueco que el fallback llenaba. */
    const arrangeProductWithoutAssignments = () => {
      mockPrismaService.products.findUnique.mockResolvedValue({
        id: 1,
        name: 'Pollo Árabe',
        product_type: 'prepared',
        product_variants: [],
        cost_price: 4000,
      } as any);
      mockPrismaService.products.findMany.mockResolvedValue([
        { id: 1, price_unit_quantity: 1, product_tax_assignments: [] },
      ] as any);
      mockPrismaService.orders.create.mockResolvedValue({
        id: 910,
        store_id: 1,
        order_number: 'ORD-QUI-INC-1',
        grand_total: 10800,
        currency: 'COP',
        order_items: [
          {
            product_id: 1,
            product_variant_id: null,
            quantity: 1,
            stock_units_consumed: null,
            products: { track_inventory: false },
          },
        ],
      } as any);
    };

    const dtoWithLine = (extra: Record<string, unknown>) =>
      ({
        order_number: 'ORD-QUI-INC-1',
        subtotal: 10000,
        tax_amount: 800,
        total_amount: 10800,
        skip_schedule_validation: true,
        items: [
          {
            product_id: 1,
            product_name: 'Pollo Árabe',
            quantity: 1,
            unit_price: 10000,
            total_price: 10000,
            tax_amount_item: 800,
            tax_rate: 0.08,
            ...extra,
          },
        ],
      }) as any;

    const writtenLine = () => {
      expect(mockPrismaService.orders.create).toHaveBeenCalledTimes(1);
      const items = (mockPrismaService.orders.create.mock.calls[0][0] as any)
        .data.order_items.create;
      expect(items).toHaveLength(1);
      return items[0];
    };
    const writtenLineTaxes = () => writtenLine().order_item_taxes;

    /* (a) ------------------------------------------------------------- */
    it('con tax_category_id de una categoría INC, la fila persiste tax_type=inc y NO iva', async () => {
      const spy = contextSpy();
      try {
        arrangeProductWithoutAssignments();
        // La fila fuente: `tax_categories` es la ÚNICA dueña de `tax_type`.
        mockUnscopedPrismaService.tax_categories.findMany.mockResolvedValue([
          {
            id: 44,
            tax_type: 'inc',
            is_inclusive: false,
            tax_rates: [
              {
                id: 68,
                name: 'INC 8%',
                rate: 0.08,
                is_compound: false,
                is_inclusive: false,
                priority: 1,
              },
            ],
          },
        ] as any);

        await service.create(dtoWithLine({ tax_category_id: 44 }), { id: 99 });

        const taxes = writtenLineTaxes();
        expect(taxes).toBeDefined();
        expect(taxes.create).toHaveLength(1);
        // EL punto del ticket: el tributo declarado a la DIAN es INC, no IVA.
        expect(taxes.create[0].tax_type).toBe('inc');
        expect(taxes.create[0].tax_type).not.toBe('iva');
        // Y el resto del snapshot sale de la MISMA fila (no del DTO).
        expect(taxes.create[0].tax_rate_id).toBe(68);
        expect(taxes.create[0].tax_name).toBe('INC 8%');
        expect(Number(taxes.create[0].tax_rate)).toBeCloseTo(0.08, 5);
        expect(Number(taxes.create[0].tax_amount)).toBe(800);
      } finally {
        spy.mockRestore();
      }
    });

    it('el lookup de la categoría declara su alcance multi-tenant a mano (tienda OR organización)', async () => {
      const spy = contextSpy();
      try {
        arrangeProductWithoutAssignments();
        mockUnscopedPrismaService.stores.findUnique.mockResolvedValue({
          organization_id: 7,
        } as any);
        mockUnscopedPrismaService.tax_categories.findMany.mockResolvedValue([
          { id: 44, tax_type: 'inc', is_inclusive: false, tax_rates: [] },
        ] as any);

        await service.create(dtoWithLine({ tax_category_id: 44 }), { id: 99 });

        // Va por el cliente SIN scope (si fuera por el scoped, `store_id` se
        // forzaría y las categorías de organización quedarían invisibles)…
        expect(mockPrismaService.withoutScope).toHaveBeenCalled();
        // …pero con el predicado de tenant escrito explícitamente.
        const where =
          mockUnscopedPrismaService.tax_categories.findMany.mock.calls[0][0]
            .where;
        expect(where.id).toEqual({ in: [44] });
        expect(where.OR).toEqual([
          { store_id: 1 },
          { organization_id: 7, store_id: null },
        ]);
      } finally {
        spy.mockRestore();
      }
    });

    /* (b) ------------------------------------------------------------- */
    it('sin tax_category_id y sin configuración, NO se escribe fila de impuesto', async () => {
      const spy = contextSpy();
      try {
        arrangeProductWithoutAssignments();

        await service.create(dtoWithLine({}), { id: 99 });

        // La línea SÍ se escribe (el test no puede pasar por "no se creó
        // ninguna orden"). P1-2 / ADR-10: un producto SIN asignación fiscal
        // no lleva impuesto — el servidor decide, y el 800 que declaró el
        // cliente no se persiste (antes quedaba como escalar huérfano: un
        // impuesto sin fila de desglose que lo clasificara).
        const line = writtenLine();
        expect(line.product_name).toBe('Pollo Árabe');
        expect(Number(line.tax_amount_item)).toBe(0);
        expect(
          (mockPrismaService.orders.create.mock.calls[0][0] as any).data
            .tax_amount,
        ).toBe(0);
        // Antes acá se escribía `{create:[{tax_name:'IVA',tax_type:'iva',…}]}`.
        expect(line.order_item_taxes).toBeUndefined();
        // Sin categoría declarada ni siquiera se consulta el catálogo.
        expect(
          mockUnscopedPrismaService.tax_categories.findMany,
        ).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    /* (c) ------------------------------------------------------------- */
    it('categoría no resoluble en el alcance rechaza con ORD_ITEM_TAX_CATEGORY_UNRESOLVABLE_001', async () => {
      const spy = contextSpy();
      try {
        arrangeProductWithoutAssignments();
        // El id viaja en el DTO pero no existe para esta tienda/organización.
        mockUnscopedPrismaService.tax_categories.findMany.mockResolvedValue(
          [] as any,
        );

        // Se afirma el `errorCode` exacto: un `toBeInstanceOf` solo pasaría
        // con cualquier guarda anterior y no fijaría ESTA compuerta.
        await expect(
          service.create(dtoWithLine({ tax_category_id: 999 }), { id: 99 }),
        ).rejects.toMatchObject({
          errorCode: ErrorCodes.ORD_ITEM_TAX_CATEGORY_UNRESOLVABLE_001.code,
        });
        await expect(
          service.create(dtoWithLine({ tax_category_id: 999 }), { id: 99 }),
        ).rejects.toBeInstanceOf(VendixHttpException);

        // Falla RUIDOSA y ANTES de escribir: ninguna orden se creó.
        expect(mockPrismaService.orders.create).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    /* Precedencia ------------------------------------------------------ */
    it('las asignaciones del producto mandan sobre la categoría declarada (cero regresión)', async () => {
      const spy = contextSpy();
      try {
        arrangeProductWithoutAssignments();
        // El producto SÍ tiene asignación: IVA 19% del catálogo.
        mockPrismaService.products.findMany.mockResolvedValue([
          {
            id: 1,
            price_unit_quantity: 1,
            product_tax_assignments: [
              {
                is_inclusive: false,
                tax_categories: {
                  tax_type: 'iva',
                  tax_rates: [
                    {
                      id: 10,
                      name: 'IVA 19%',
                      rate: 0.19,
                      is_compound: false,
                      is_inclusive: false,
                      priority: 1,
                    },
                  ],
                },
              },
            ],
          },
        ] as any);
        mockUnscopedPrismaService.tax_categories.findMany.mockResolvedValue([
          { id: 44, tax_type: 'inc', is_inclusive: false, tax_rates: [] },
        ] as any);

        await service.create(dtoWithLine({ tax_category_id: 44 }), { id: 99 });

        const taxes = writtenLineTaxes();
        expect(taxes.create).toHaveLength(1);
        expect(taxes.create[0].tax_rate_id).toBe(10);
        expect(taxes.create[0].tax_type).toBe('iva');
      } finally {
        spy.mockRestore();
      }
    });
  });
  /**
   * P1-2 / P1-3 (auditoría impuestos por producto) — `orders.create` aplica
   * el impuesto del CATÁLOGO en el servidor. Si el cliente difiere ≥1 ¢ gana
   * el servidor con un warn (no 400): reservas y el borrador de mostrador
   * legacy mandan el precio de góndola sin impuesto (ver docblock en
   * `create`). Cabecera = Σ líneas.
   */
  describe('create — impuesto de línea decidido por el servidor (P1-2 / P1-3)', () => {
    const contextSpy = () =>
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
        store_id: 1,
        organization_id: 1,
        is_super_admin: false,
        is_owner: false,
        user_id: 99,
        request_id: 'req-test-p12',
      } as any);

    const arrange = (productRow: Record<string, unknown>) => {
      mockPrismaService.products.findUnique.mockResolvedValue({
        id: 1,
        name: 'Producto',
        product_type: 'simple',
        product_variants: [],
        cost_price: 5000,
      } as any);
      mockPrismaService.products.findMany.mockResolvedValue([
        productRow,
      ] as any);
      mockPrismaService.orders.create.mockResolvedValue({
        id: 950,
        store_id: 1,
        order_number: 'ORD-P12-1',
        grand_total: 0,
        currency: 'COP',
        order_items: [
          {
            product_id: 1,
            product_variant_id: null,
            quantity: 1,
            stock_units_consumed: null,
            products: { track_inventory: false },
          },
        ],
      } as any);
    };

    /** Payload estilo `reservations.service.ts`: góndola sin impuesto. */
    const reservationStyleDto = (
      price: number,
      extra: Record<string, unknown> = {},
    ) =>
      ({
        order_number: 'ORD-P12-1',
        subtotal: price,
        total_amount: price,
        skip_schedule_validation: true,
        items: [
          {
            product_id: 1,
            product_name: 'Producto',
            quantity: 1,
            unit_price: price,
            total_price: price,
            ...extra,
          },
        ],
      }) as any;

    const written = () => {
      const data = (mockPrismaService.orders.create.mock.calls[0][0] as any)
        .data;
      return { header: data, line: data.order_items.create[0] };
    };

    it('P1-3 reservas / cliente manda impuesto 0: IVA 19 % incluido a 11.900 ⇒ base 10.000 + 1.900 (el servidor corrige)', async () => {
      const spy = contextSpy();
      const warn = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => undefined);
      try {
        arrange(
          productTaxRow(
            1,
            { id: 11, name: 'IVA 19%', rate: 0.19, is_inclusive: true },
            'iva',
            { base_price: 11900, is_on_sale: false, sale_price: null },
          ),
        );
        await service.create(
          reservationStyleDto(11900, { tax_amount_item: 0, tax_rate: 0 }),
          { id: 99 },
        );
        const { header, line } = written();
        expect(line.unit_price).toBe(10000);
        expect(line.total_price).toBe(10000);
        expect(line.tax_amount_item).toBe(1900);
        expect(line.final_unit_price).toBe(11900);
        expect(line.order_item_taxes.create).toHaveLength(1);
        expect(line.order_item_taxes.create[0]).toMatchObject({
          tax_rate_id: 11,
          tax_type: 'iva',
          is_inclusive: true,
        });
        expect(line.order_item_taxes.create[0].tax_amount.toNumber()).toBe(
          1900,
        );
        expect(header.subtotal_amount).toBe(10000);
        expect(header.tax_amount).toBe(1900);
        expect(header.grand_total).toBe(11900);
        // Gana el servidor, con rastro.
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('gana el servidor'),
        );
      } finally {
        warn.mockRestore();
        spy.mockRestore();
      }
    });

    it('IVA 19 % AGREGADO: base 10.000 ⇒ línea 10.000 + 1.900, total 11.900', async () => {
      const spy = contextSpy();
      try {
        arrange(
          productTaxRow(1, {
            id: 10,
            name: 'IVA 19%',
            rate: 0.19,
            is_inclusive: false,
          }),
        );
        await service.create(reservationStyleDto(10000), { id: 99 });
        const { header, line } = written();
        expect(line.unit_price).toBe(10000);
        expect(line.tax_amount_item).toBe(1900);
        expect(line.final_unit_price).toBe(11900);
        expect(line.order_item_taxes.create[0].is_inclusive).toBe(false);
        expect(header.tax_amount).toBe(1900);
        expect(header.grand_total).toBe(11900);
      } finally {
        spy.mockRestore();
      }
    });

    it('INC 8 % incluido a 18.500 ⇒ 17.129,63 + 1.370,37 con tax_type inc', async () => {
      const spy = contextSpy();
      try {
        arrange(
          productTaxRow(
            1,
            { id: 30, name: 'INC 8%', rate: 0.08, is_inclusive: true },
            'inc',
            { base_price: 18500, is_on_sale: false, sale_price: null },
          ),
        );
        await service.create(reservationStyleDto(18500), { id: 99 });
        const { header, line } = written();
        expect(line.unit_price).toBe(17129.63);
        expect(line.tax_amount_item).toBe(1370.37);
        expect(line.final_unit_price).toBe(18500);
        expect(line.order_item_taxes.create[0].tax_type).toBe('inc');
        expect(line.order_item_taxes.create[0].tax_amount.toNumber()).toBe(
          1370.37,
        );
        expect(header.subtotal_amount).toBe(17129.63);
        expect(header.tax_amount).toBe(1370.37);
        expect(header.grand_total).toBe(18500);
      } finally {
        spy.mockRestore();
      }
    });

    it('producto exento: sin impuesto ni filas aunque el cliente mande 1.900', async () => {
      const spy = contextSpy();
      try {
        arrange({ id: 1, product_tax_assignments: [] });
        await service.create(
          reservationStyleDto(10000, { tax_amount_item: 1900, tax_rate: 0.19 }),
          { id: 99 },
        );
        const { header, line } = written();
        expect(line.unit_price).toBe(10000);
        expect(line.tax_amount_item).toBe(0);
        expect(line.order_item_taxes).toBeUndefined();
        expect(header.tax_amount).toBe(0);
        expect(header.grand_total).toBe(10000);
      } finally {
        spy.mockRestore();
      }
    });

    it('variante: el bruto de catálogo sale del precio de la VARIANTE, no del producto', async () => {
      const spy = contextSpy();
      try {
        arrange(
          productTaxRow(
            1,
            { id: 11, name: 'IVA 19%', rate: 0.19, is_inclusive: true },
            'iva',
            { base_price: 5950, is_on_sale: false, sale_price: null },
          ),
        );
        mockPrismaService.products.findUnique.mockResolvedValue({
          id: 1,
          name: 'Producto',
          product_type: 'simple',
          product_variants: [{ id: 5 }],
          cost_price: 5000,
        } as any);
        mockPrismaService.product_variants.findUnique.mockResolvedValue({
          id: 5,
          product_id: 1,
          product_images: null,
        } as any);
        mockPrismaService.product_variants.findMany.mockResolvedValue([
          {
            id: 5,
            product_id: 1,
            price_override: 11900,
            is_on_sale: false,
            sale_price: null,
          },
        ] as any);
        await service.create(
          reservationStyleDto(11900, { product_variant_id: 5 }),
          { id: 99 },
        );
        const { header, line } = written();
        expect(line.product_variant_id).toBe(5);
        expect(line.unit_price).toBe(10000);
        expect(line.tax_amount_item).toBe(1900);
        expect(header.tax_amount).toBe(1900);
      } finally {
        spy.mockRestore();
      }
    });

    it('línea custom sin producto ni categoría: conserva el escalar del cliente (no se rompe)', async () => {
      const spy = contextSpy();
      try {
        arrange({ id: 1, product_tax_assignments: [] });
        await service.create(
          {
            order_number: 'ORD-P12-1',
            subtotal: 5000,
            total_amount: 5950,
            skip_schedule_validation: true,
            items: [
              {
                product_name: 'Servicio manual',
                quantity: 1,
                unit_price: 5000,
                total_price: 5000,
                tax_amount_item: 950,
                tax_rate: 0.19,
              },
            ],
          } as any,
          { id: 99 },
        );
        const { header, line } = written();
        expect(line.product_id).toBeNull();
        expect(line.unit_price).toBe(5000);
        expect(line.tax_amount_item).toBe(950);
        expect(line.order_item_taxes).toBeUndefined();
        expect(header.tax_amount).toBe(950);
        expect(header.grand_total).toBe(5950);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
