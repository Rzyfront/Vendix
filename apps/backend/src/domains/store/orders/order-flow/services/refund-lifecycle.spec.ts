import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { RefundFlowService } from './refund-flow.service';
import { RefundCalculationService } from './refund-calculation.service';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { StockLevelManager } from '../../../inventory/shared/services/stock-level-manager.service';
import { SettingsService } from '../../../settings/settings.service';
import { SessionsService } from '../../../cash-registers/sessions/sessions.service';
import { MovementsService } from '../../../cash-registers/movements/movements.service';
import { SerialNumberEnforcementService } from '../../../inventory/serial-numbers/serial-number-enforcement.service';
import { InventorySerialNumbersService } from '../../../inventory/serial-numbers/inventory-serial-numbers.service';
import { WalletService } from '../../../wallet/wallet.service';
import { WalletBalanceService } from '../../../wallet/services/wallet-balance.service';
import { PaymentGatewayService } from '../../../payments/services/payment-gateway.service';
import { ManualRefundDeliveryService } from '../../../accounting/auto-entries/manual-refund-delivery.service';
import {
  getCompletedRefundAmount,
  getSettledOrderAmount,
  isOrderFullyPaid,
} from '../../../payments/services/payment-validator.service';

/**
 * CP-REFUND-FLOW-REDESIGN paso 10 — gate de ciclo de vida (pasos 1+2).
 *
 * Cubre lo que el plan diseñó en los pasos 1-2 y dejó para este gate:
 * claim atómico `FOR UPDATE` + re-validación del techo bajo el lock,
 * techo pendiente-aware, exclusión `cancelled_at`, vínculo `payment_id`,
 * promoción multi-pago y `isOrderFullyPaid` fiscal-aware.
 *
 * Los specs existentes (`refund-flow.service.spec.ts`, cálculo, integridad)
 * son contrato inviolable: este archivo solo AGREGA casos, no los toca.
 */
describe('RefundFlowService — gate de ciclo de vida (pasos 1+2, CP-REFUND-FLOW-REDESIGN)', () => {
  let service: RefundFlowService;
  let eventEmitter: { emit: jest.Mock };
  let mockPrisma: any;
  let mockCalculationService: any;

  const baseCalculation = {
    items: [],
    subtotal_refund: 1000,
    tax_refund: 0,
    shipping_refund: 0,
    shipping_tax_refund: 0,
    shipping_tax_type: null,
    total_refund: 1000,
    is_full_refund: false,
    already_refunded: 0,
    max_refundable: 9000,
  };

  const baseOrder = (over: any = {}) => ({
    id: 1,
    store_id: 10,
    state: 'finished',
    order_number: 'O-1',
    payments: [{ id: 100, state: 'succeeded' }],
    stores: { id: 10, organization_id: 1 },
    order_items: [],
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    eventEmitter = { emit: jest.fn() };
    mockCalculationService = {
      calculate: jest.fn().mockResolvedValue({ ...baseCalculation }),
      preview: jest.fn(),
      calculateCancellationCashRefund: jest.fn(),
    };
    mockPrisma = {
      orders: { findFirst: jest.fn(), update: jest.fn() },
      stores: {
        findUnique: jest.fn().mockResolvedValue({ default_location_id: 5, organization_id: 1 }),
      },
      inventory_locations: { findFirst: jest.fn().mockResolvedValue({ id: 5 }) },
      refunds: {
        create: jest.fn().mockResolvedValue({ id: 999, state: 'processing' }),
        update: jest.fn().mockResolvedValue({ id: 999, state: 'completed', refund_items: [] }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      accounting_entry_failures: { create: jest.fn().mockResolvedValue({ id: 77 }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      refund_items: { create: jest.fn().mockResolvedValue({ id: 1 }), findMany: jest.fn().mockResolvedValue([]) },
      order_items: { findMany: jest.fn().mockResolvedValue([]) },
      payments: { update: jest.fn().mockResolvedValue({}) },
      // Forma de dos args como Prisma real: el rechazo de la tx pasa por el
      // handler (mapeo P2002 → conflicto) en vez de propagarse crudo.
      $transaction: jest.fn(async (cb: any, onReject?: any) => {
        try {
          return await cb(mockPrisma);
        } catch (e) {
          if (onReject) return onReject(e);
          throw e;
        }
      }),
    };
    // Pre-tx usa `include`, el re-read bajo el lock usa `select`.
    mockPrisma.orders.findFirst.mockImplementation((args: any) =>
      args?.select ? { state: 'finished' } : baseOrder(),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundFlowService,
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: RefundCalculationService, useValue: mockCalculationService },
        { provide: StorePrismaService, useValue: mockPrisma },
        { provide: RequestContextService, useValue: { getUserId: () => 1 } },
        { provide: StockLevelManager, useValue: { updateStock: jest.fn() } },
        { provide: SettingsService, useValue: {} },
        { provide: SessionsService, useValue: {} },
        { provide: MovementsService, useValue: { recordRefundCashMovementDurable: jest.fn() } },
        {
          provide: SerialNumberEnforcementService,
          useValue: { isSerialized: () => Promise.resolve(false) },
        },
        { provide: InventorySerialNumbersService, useValue: { returnSerial: jest.fn() } },
        { provide: WalletService, useValue: { getOrCreateWallet: jest.fn() } },
        { provide: WalletBalanceService, useValue: { credit: jest.fn() } },
        {
          provide: PaymentGatewayService,
          useValue: { reversePaymentWithProcessor: jest.fn() },
        },
        {
          provide: ManualRefundDeliveryService,
          useValue: { deliver: jest.fn(), enqueue: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(RefundFlowService);
  });

  const cashDto = (over: any = {}) => ({
    items: [],
    include_shipping: false,
    refund_method: 'cash',
    reason: 'gate paso 1+2',
    ...over,
  });

  describe('claim atómico + techo bajo el lock (paso 1)', () => {
    it('serializa la creación con FOR UPDATE sobre la orden', async () => {
      await service.createRefund(1, cashDto() as any);

      const selects = mockPrisma.$queryRaw.mock.calls.map((c: any[]) => String(c[0][0]));
      expect(selects.some((s: string) => s.includes('FOR UPDATE'))).toBe(true);
      expect(selects.some((s: string) => s.includes('FROM orders'))).toBe(true);
    });

    it('re-valida el mismo request contra el techo pendiente-aware dentro de la tx', async () => {
      await service.createRefund(1, cashDto() as any);

      expect(mockCalculationService.calculate).toHaveBeenCalledTimes(2);
      expect(mockCalculationService.calculate).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ order_id: 1, include_pending_states: true }),
        mockPrisma,
      );
    });

    it('doble parcial: si la re-validación bajo el lock rompe el techo, el segundo falla sin persistir nada', async () => {
      mockCalculationService.calculate
        .mockResolvedValueOnce({ ...baseCalculation })
        .mockRejectedValueOnce(
          new BadRequestException('Total refund (6000.00) exceeds max refundable amount (5000.00)'),
        );

      await expect(service.createRefund(1, cashDto() as any)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockPrisma.refunds.create).not.toHaveBeenCalled();
      expect(mockPrisma.payments.update).not.toHaveBeenCalled();
    });

    it('refund-vs-cancel TOCTOU: estado rancio bajo el lock aborta antes de persistir', async () => {
      mockPrisma.orders.findFirst.mockImplementation((args: any) =>
        args?.select ? { state: 'cancelled' } : baseOrder(),
      );

      await expect(service.createRefund(1, cashDto() as any)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockPrisma.refunds.create).not.toHaveBeenCalled();
    });

    it('P2002 en la ventana del claim mapea a REF_CREATE_001 (conflicto, no 500)', async () => {
      mockPrisma.$transaction.mockImplementationOnce(async (_cb: any, onReject: any) =>
        onReject(Object.assign(new Error('Unique constraint'), { code: 'P2002' })),
      );

      await expect(service.createRefund(1, cashDto() as any)).rejects.toMatchObject({
        errorCode: 'REF_CREATE_001',
      });
    });
  });

  describe('vínculo refund↔pago + promoción multi-pago (paso 2)', () => {
    it('parcial: vincula payment_id, marca la pierna partially_refunded y deja la orden finished', async () => {
      await service.createRefund(1, cashDto() as any);

      expect(mockPrisma.refunds.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ order_id: 1, payment_id: 100 }),
      });
      expect(mockPrisma.payments.update).toHaveBeenCalledWith({
        where: { id: 100 },
        data: { state: 'partially_refunded', updated_at: expect.any(Date) },
      });
      expect(mockPrisma.orders.update).not.toHaveBeenCalled();
      expect(eventEmitter.emit.mock.calls.some(([n]) => n === 'order.status_changed')).toBe(false);
    });

    it('cobertura total multi-pago: promueve TODAS las piernas a refunded y la orden a refunded', async () => {
      mockCalculationService.calculate.mockResolvedValue({ ...baseCalculation, is_full_refund: true });
      const legs = [
        { id: 100, state: 'succeeded' },
        { id: 101, state: 'partially_refunded' },
      ];
      mockPrisma.orders.findFirst.mockImplementation((args: any) =>
        args?.select ? { state: 'finished' } : baseOrder({ payments: legs }),
      );

      await service.createRefund(1, cashDto() as any);

      expect(mockPrisma.payments.update).toHaveBeenCalledWith({
        where: { id: 100 },
        data: { state: 'refunded', updated_at: expect.any(Date) },
      });
      expect(mockPrisma.payments.update).toHaveBeenCalledWith({
        where: { id: 101 },
        data: { state: 'refunded', updated_at: expect.any(Date) },
      });
      expect(mockPrisma.orders.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { state: 'refunded', updated_at: expect.any(Date) },
      });
      const statusChanged = eventEmitter.emit.mock.calls.find(([n]) => n === 'order.status_changed');
      expect(statusChanged?.[1]).toMatchObject({ order_id: 1, new_state: 'refunded' });
    });

    it('parcial sobre pierna partially_refunded: la pierna sigue en juego (idempotente)', async () => {
      mockPrisma.orders.findFirst.mockImplementation((args: any) =>
        args?.select
          ? { state: 'finished' }
          : baseOrder({ payments: [{ id: 100, state: 'partially_refunded' }] }),
      );

      await service.createRefund(1, cashDto() as any);

      expect(mockPrisma.refunds.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ payment_id: 100 }),
      });
      expect(mockPrisma.payments.update).toHaveBeenCalledWith({
        where: { id: 100 },
        data: { state: 'partially_refunded', updated_at: expect.any(Date) },
      });
    });

    it('parcial no toca las piernas hermanas', async () => {
      mockPrisma.orders.findFirst.mockImplementation((args: any) =>
        args?.select
          ? { state: 'finished' }
          : baseOrder({
              payments: [
                { id: 100, state: 'succeeded' },
                { id: 101, state: 'succeeded' },
              ],
            }),
      );

      await service.createRefund(1, cashDto() as any);

      expect(mockPrisma.payments.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.payments.update).toHaveBeenCalledWith({
        where: { id: 100 },
        data: expect.objectContaining({ state: 'partially_refunded' }),
      });
    });
  });

  describe('caché de cobertura por línea (paso 3, escritura en la misma tx)', () => {
    const lineItem = {
      order_item_id: 11,
      product_name: 'Café',
      quantity: 1,
      unit_price: 1000,
      gross_amount: 1000,
      discount_amount: 0,
      net_amount: 1000,
      tax_amount: 0,
      refund_amount: 1000,
      inventory_action: 'no_return',
    };

    it('refund con líneas re-agrega el caché con UPDATE absoluto (no incremento)', async () => {
      mockCalculationService.calculate.mockResolvedValue({
        ...baseCalculation,
        items: [lineItem],
      });
      mockPrisma.orders.findFirst.mockImplementation((args: any) =>
        args?.select
          ? { state: 'finished' }
          : baseOrder({
              order_items: [
                {
                  id: 11,
                  quantity: 2,
                  products: { id: 1, track_inventory: false, product_type: 'physical' },
                  product_variants: null,
                },
              ],
            }),
      );

      await service.createRefund(1, cashDto() as any);

      const rawCalls = mockPrisma.$queryRaw.mock.calls.map((c: any[]) => String(c[0][0]));
      expect(rawCalls.some((s: string) => s.includes('UPDATE "order_items"'))).toBe(true);
      expect(mockPrisma.refund_items.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ refund_id: 999, order_item_id: 11, quantity: 1 }),
      });
    });

    it('refund sin ítems (orden-nivel) no escribe caché', async () => {
      await service.createRefund(1, cashDto() as any);

      const rawCalls = mockPrisma.$queryRaw.mock.calls.map((c: any[]) => String(c[0][0]));
      expect(rawCalls.some((s: string) => s.includes('UPDATE "order_items"'))).toBe(false);
    });
  });
});

describe('RefundCalculationService — techo pendiente-aware + cancelled_at (paso 1)', () => {
  const line = (over: any = {}) => ({
    id: 11,
    product_name: 'Café',
    quantity: 2,
    unit_price: 5000,
    total_price: 10000,
    tax_rate: 0,
    order_item_taxes: [],
    products: { id: 1, track_inventory: false, product_images: [] },
    ...over,
  });

  const orderRow = (over: any = {}) => ({
    id: 1,
    grand_total: 10000,
    subtotal_amount: 10000,
    discount_amount: 0,
    shipping_cost: 0,
    shipping_tax_amount: 0,
    order_items: [line()],
    refunds: [],
    ...over,
  });

  const makeService = (row: any) => {
    const prisma = { orders: { findFirst: jest.fn().mockResolvedValue(row) } };
    return { service: new RefundCalculationService(prisma as any), prisma };
  };

  it('include_pending_states cuenta processing/pending_approval contra el techo', async () => {
    const row = orderRow({
      refunds: [
        { id: 1, state: 'completed', amount: 3000, shipping_refund: 0, refund_items: [] },
        { id: 2, state: 'processing', amount: 2000, shipping_refund: 0, refund_items: [] },
      ],
    });
    const { service, prisma } = makeService(row);

    const result = await service.calculate({
      order_id: 1,
      items: [{ order_item_id: 11, quantity: 1, inventory_action: 'no_return' }],
      include_shipping: false,
      include_pending_states: true,
    });

    expect(prisma.orders.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          refunds: expect.objectContaining({
            where: {
              state: {
                in: ['completed', 'pending_approval', 'processing'],
              },
            },
          }),
        }),
      }),
    );
    expect(result.already_refunded).toBe(5000);
    expect(result.max_refundable).toBe(5000);
  });

  it('por defecto (cancelaciones) el techo solo cuenta completed', async () => {
    const row = orderRow({
      refunds: [{ id: 1, state: 'completed', amount: 3000, shipping_refund: 0, refund_items: [] }],
    });
    const { service, prisma } = makeService(row);

    const result = await service.calculate({
      order_id: 1,
      items: [{ order_item_id: 11, quantity: 1, inventory_action: 'no_return' }],
      include_shipping: false,
    });

    expect(prisma.orders.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          refunds: expect.objectContaining({ where: { state: 'completed' } }),
        }),
      }),
    );
    expect(result.max_refundable).toBe(7000);
  });

  it('el cálculo y la creación excluyen líneas canceladas por igual (cancelled_at)', async () => {
    const { service, prisma } = makeService(orderRow());

    await service.calculate({
      order_id: 1,
      items: [{ order_item_id: 11, quantity: 1, inventory_action: 'no_return' }],
      include_shipping: false,
    });

    expect(prisma.orders.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          order_items: expect.objectContaining({ where: { cancelled_at: null } }),
        }),
      }),
    );
  });

  it('is_full_refund sale del ledger unificado (previo + solicitado cubre todo)', async () => {
    const row = orderRow({
      order_items: [line({ id: 11, quantity: 2, total_price: 10000 }), line({ id: 12, quantity: 1, total_price: 5000 })],
      grand_total: 15000,
      subtotal_amount: 15000,
      refunds: [
        {
          id: 1,
          state: 'completed',
          amount: 10000,
          shipping_refund: 0,
          refund_items: [{ order_item_id: 11, quantity: 2, refund_amount: 10000 }],
        },
      ],
    });
    const { service } = makeService(row);

    const result = await service.calculate({
      order_id: 1,
      items: [{ order_item_id: 12, quantity: 1, inventory_action: 'no_return' }],
      include_shipping: false,
    });

    expect(result.is_full_refund).toBe(true);
  });

  it('la guarda por línea usa el ledger (no se devuelve más de lo vendido menos lo devuelto)', async () => {
    const row = orderRow({
      refunds: [
        {
          id: 1,
          state: 'completed',
          amount: 5000,
          shipping_refund: 0,
          refund_items: [{ order_item_id: 11, quantity: 1, refund_amount: 5000 }],
        },
      ],
    });
    const { service } = makeService(row);

    await expect(
      service.calculate({
        order_id: 1,
        items: [{ order_item_id: 11, quantity: 2, inventory_action: 'no_return' }],
        include_shipping: false,
      }),
    ).rejects.toThrow(/Max refundable: 1/);
  });
});

describe('payment-validator — isOrderFullyPaid fiscal-aware (paso 2)', () => {
  it('las piernas partially_refunded/refunded cuentan como settled', () => {
    const settled = getSettledOrderAmount({
      payments: [
        { state: 'succeeded', amount: 6000 },
        { state: 'partially_refunded', amount: 4000 },
        { state: 'refunded', amount: 2000 },
        { state: 'failed', amount: 99999 },
      ],
    });

    expect(settled.equals(new Prisma.Decimal(12000))).toBe(true);
  });

  it('solo los completed descuentan lo adeudado (pending/failed no movieron dinero)', () => {
    const discounted = getCompletedRefundAmount({
      refunds: [
        { state: 'completed', amount: 1000 },
        { state: 'processing', amount: 5000 },
        { state: 'failed', amount: 7000 },
      ],
    });

    expect(discounted.equals(new Prisma.Decimal(1000))).toBe(true);
  });

  it('orden cubierta por devoluciones (evidencia 7384) no admite nuevo cobro', () => {
    expect(
      isOrderFullyPaid({
        grand_total: 10000,
        payments: [{ state: 'partially_refunded', amount: 10000 }],
        refunds: [{ state: 'completed', amount: 10000 }],
      }),
    ).toBe(true);
  });

  it('sin refunds incluidos preserva el veredicto legacy', () => {
    expect(
      isOrderFullyPaid({
        grand_total: 10000,
        payments: [{ state: 'succeeded', amount: 10000 }],
      }),
    ).toBe(true);
    expect(
      isOrderFullyPaid({
        grand_total: 10000,
        payments: [{ state: 'succeeded', amount: 6000 }],
      }),
    ).toBe(false);
  });
});
