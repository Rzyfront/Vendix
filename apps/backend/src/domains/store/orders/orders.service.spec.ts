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
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
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
    product_variants: { findMany: jest.fn() },
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
      // CP-POLLO-ARABE-727 · fix/table-close-order. El guard del editor
      // (OrdersService.updateOrderFromEditor) consulta `table_sessions.findFirst`
      // por `order_id` para saber si hay una sesión CERRADA vinculada a la
      // orden. Mock explícito para que las specs del guard puedan simular
      // los 3 caminos: cerrada → rechaza, abierta → permite, sin sesión
      // (POS-only) → permite.
      findFirst: jest.fn(),
    },
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
   * Censo (grep sobre `orders.service.ts`): `OrdersService` no llama a
   * `withoutScope()` en ningún método cubierto por este spec — el escape
   * hatch sin scope lo usan `purchase-orders.service.ts` y
   * `order-auto-fulfillment.listener.ts`, no esta clase. Es decir: HOY
   * ningún test de este archivo depende del atajo (0 aserciones que migrar).
   * Este mock deja el arnés listo para cuando `OrdersService` sí lo use, y
   * el test de seam de abajo demuestra que el atajo peligroso vuelve a
   * fallar si alguien lo reintroduce.
   */
  const mockUnscopedPrismaService = {
    orders: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    stores: { findFirst: jest.fn() },
    products: { findFirst: jest.fn(), findMany: jest.fn() },
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
    mockRequestContextService.getContext.mockReturnValue({
      store_id: 1,
      organization_id: 1,
      is_super_admin: false,
      user_id: 99,
      request_id: 'req-test-001',
    });

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
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
      mockPrismaService.products.findMany.mockResolvedValue([{ id: 1 }]);
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
        // Lo que el commit debe escribir/leer si el multiplicador es
        // ÚNICO: subtotal = unit_price(10) × escala(1000) = 10.000; tax =
        // (10 × 0,19) × escala(1000) = 1.900. Si el impuesto usara
        // `quantity` (2000) en vez de la escala, daría 3.800 — el doble —
        // y este test fallaría.
        const scaledPersistedOrder = {
          ...scaledDraftOrder,
          subtotal_amount: 10000,
          tax_amount: 1900,
          discount_amount: 0,
          shipping_cost: 0,
          grand_total: 11900,
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
          { id: 1, price_unit_quantity: 1000 },
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
        expect(Number(writtenData.subtotal_amount)).toBe(10000);
        expect(Number(writtenData.tax_amount)).toBe(1900);
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
    //
    // `ORD_EDIT_RESPONSE_MISMATCH_001` se dispara cuando la fila
    // persistida dentro de la transacción difiere de los totales
    // recalculados. Forzamos que el `findFirst` post-commit devuelva
    // un row TAMPERED (subtotal_amount distinto del recalculado) y
    // verificamos que el editor NUNCA devuelve éxito falso.
    // ----------------------------------------------------------------

    it('lanza 500 ORD_EDIT_RESPONSE_MISMATCH_001 cuando la fila persistida difiere del cálculo', async () => {
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
          ErrorCodes.ORD_EDIT_RESPONSE_MISMATCH_001.code,
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
    // El editor atómico debe bloquearse cuando existe una sesión de mesa
    // CERRADA vinculada al order_id. Eso cierra el síntoma reportado en
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
    // Decisión consciente: NO replicamos este guard en `update` /
    // `updateOrderItems` en este PR — el reporte del líder menciona
    // "el editor", y la fuente del leak reportada es el flujo del editor
    // atómico. `updateOrderItems` ya valida `session.closed_at` por su
    // propio camino (addItems/removeItem). Un sweep simétrico queda como
    // follow-up explícito.
    // ----------------------------------------------------------------

    it('lanza 409 ORD_EDIT_NOT_ALLOWED_001 cuando existe una table_session CERRADA para el order_id', async () => {
      setupContext();
      const contextSpy = spyContext();
      try {
        // La orden está en estado editable (el guard de estado pasaría).
        mockPrismaService.orders.findFirst.mockResolvedValue(editableOrder);
        // PERO la sesión de mesa ya fue cerrada (mesero la cerró sin cobrar).
        // El guard del editor tiene que detectarlo y cortar antes del claim.
        mockPrismaService.table_sessions.findFirst.mockResolvedValue({
          id: 77,
          order_id: 500,
          closed_at: new Date(),
        });

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
              closed_at: { not: null },
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
        // El guard hace `findFirst({ where: { order_id, closed_at: { not: null } } })`.
        // Una sesión con `closed_at: null` NO satisface ese WHERE (closed_at IS NULL,
        // no NOT NULL), así que Prisma devuelve `null` aunque exista la sesión.
        // Eso es lo correcto: la sesión existe pero sigue abierta → no bloqueamos.
        mockPrismaService.table_sessions.findFirst.mockResolvedValue(null);

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

    it('fallback: qty 3 × 1.900/u ⇒ OIT = 5.700 con tax_rate_id null', () => {
      const out = call(
        { quantity: 3, tax_amount_item: 1900, tax_rate: 0.19 },
        null,
      );

      expect(out.create).toHaveLength(1);
      expect(Number(out.create[0].tax_amount)).toBe(5700);
      expect(out.create[0].tax_rate_id).toBeNull();
    });

    it('línea por peso: el multiplicador es 1 aunque quantity sea 1', () => {
      const out = call(
        { quantity: 1, weight: 1.35, tax_amount_item: 1900, tax_rate: 0.19 },
        singleRate,
      );

      expect(Number(out.create[0].tax_amount)).toBe(1900);
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
});
