import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { createPrismaMock, PrismaMock } from 'src/testing/prisma-mock';
import {
  buildOrder,
  buildOrderItem,
  buildPayment,
} from 'src/testing/money-fixtures';
import { StockLevelManager } from '../../../inventory/shared/services/stock-level-manager.service';
import { SettingsService } from '../../../settings/settings.service';
import { SessionsService } from '../../../cash-registers/sessions/sessions.service';
import { MovementsService } from '../../../cash-registers/movements/movements.service';
import { SerialNumberEnforcementService } from '../../../inventory/serial-numbers/serial-number-enforcement.service';
import { InventorySerialNumbersService } from '../../../inventory/serial-numbers/inventory-serial-numbers.service';
import { WalletService } from '../../../wallet/wallet.service';
import { WalletBalanceService } from '../../../wallet/services/wallet-balance.service';
import { PaymentGatewayService } from '../../../payments/services/payment-gateway.service';
import { CreateRefundDto, CreateRefundItemDto } from '../dto/create-refund.dto';
import { RefundCalculationService } from './refund-calculation.service';
import { RefundFlowService } from './refund-flow.service';

// Both domain services are real. Only persistence, stock, cash, wallet and
// processor boundaries are mocked; no precomputed RefundCalculationResult.
describe('Refund integrity — real flow + real calculation', () => {
  let module: TestingModule;
  let service: RefundFlowService;
  let prisma: PrismaMock;
  let order: ReturnType<typeof sourceOrder>;
  const events = { emit: jest.fn() };
  const stock = { updateStock: jest.fn() };
  const settings = { getSettings: jest.fn() };
  const sessions = { getActiveSession: jest.fn() };
  const movements = { recordRefundMovement: jest.fn() };
  const serialEnforcement = { isSerialized: jest.fn() };
  const serials = { returnSerial: jest.fn(), linkToDocument: jest.fn() };
  const wallet = { getOrCreateWallet: jest.fn() };
  const balance = { credit: jest.fn() };
  const gateway = { reversePaymentWithProcessor: jest.fn() };

  function item(id: number, quantity = 1): CreateRefundItemDto {
    return {
      order_item_id: id,
      quantity,
      inventory_action: 'restock',
      location_id: 7,
    };
  }

  function sourceOrder() {
    return {
      ...buildOrder({
        customer_id: null,
        state: 'finished',
        subtotal_amount: new Prisma.Decimal(1010),
        grand_total: new Prisma.Decimal(1010),
        tax_amount: new Prisma.Decimal(0),
        total_paid: new Prisma.Decimal(1010),
        remaining_balance: new Prisma.Decimal(0),
      }),
      stores: { id: 100, organization_id: 1 },
      refunds: [] as Array<{
        amount: Prisma.Decimal;
        refund_items: CreateRefundItemDto[];
      }>,
      payments: [
        {
          ...buildPayment({ amount: new Prisma.Decimal(1010) }),
          store_payment_method: { system_payment_method: { type: 'cash' } },
        },
      ],
      order_items: [
        buildOrderItem({
          id: 1,
          product_name: 'A',
          quantity: 1,
          unit_price: new Prisma.Decimal(10),
          total_price: new Prisma.Decimal(10),
          tax_rate: new Prisma.Decimal(0),
          stock_units_consumed: null,
          tax_amount_item: new Prisma.Decimal(0),
          products: { id: 100, track_inventory: true, product_images: [] },
        }),
        buildOrderItem({
          id: 2,
          product_name: 'B',
          quantity: 1,
          unit_price: new Prisma.Decimal(1000),
          total_price: new Prisma.Decimal(1000),
          tax_rate: new Prisma.Decimal(0),
          stock_units_consumed: null,
          tax_amount_item: new Prisma.Decimal(0),
          products: { id: 101, track_inventory: true, product_images: [] },
        }),
      ],
    };
  }

  function dto(items: CreateRefundItemDto[]): CreateRefundDto {
    return {
      items,
      include_shipping: false,
      refund_method: 'cash',
      reason: 'Customer return',
    };
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(1);
    order = sourceOrder();
    prisma = createPrismaMock({
      orders: ['findFirst', 'update'],
      stores: ['findUnique'],
      inventory_locations: ['findFirst'],
      refunds: ['create', 'update'],
      refund_items: ['create'],
      order_items: ['findMany'],
      payments: ['update'],
    });
    prisma.orders.findFirst.mockImplementation(async () => order);
    prisma.stores.findUnique.mockResolvedValue({ default_location_id: 7 });
    prisma.refunds.create.mockResolvedValue({ id: 90, state: 'processing' });
    prisma.refunds.update.mockResolvedValue({
      id: 90,
      state: 'completed',
      refund_items: [],
    });
    prisma.refund_items.create.mockResolvedValue({ id: 91 });
    prisma.order_items.findMany.mockResolvedValue([]);
    stock.updateStock.mockResolvedValue(undefined);
    serialEnforcement.isSerialized.mockResolvedValue(false);
    settings.getSettings.mockResolvedValue({
      pos: { cash_register: { enabled: false } },
    });

    module = await Test.createTestingModule({
      providers: [
        RefundFlowService,
        RefundCalculationService,
        { provide: StorePrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: events },
        { provide: StockLevelManager, useValue: stock },
        { provide: SettingsService, useValue: settings },
        { provide: SessionsService, useValue: sessions },
        { provide: MovementsService, useValue: movements },
        {
          provide: SerialNumberEnforcementService,
          useValue: serialEnforcement,
        },
        { provide: InventorySerialNumbersService, useValue: serials },
        { provide: WalletService, useValue: wallet },
        { provide: WalletBalanceService, useValue: balance },
        { provide: PaymentGatewayService, useValue: gateway },
      ],
    }).compile();
    service = module.get(RefundFlowService);
  });

  afterEach(async () => {
    await module?.close();
    jest.restoreAllMocks();
  });

  function expectNoEffects() {
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.refunds.create).not.toHaveBeenCalled();
    expect(prisma.refunds.update).not.toHaveBeenCalled();
    expect(prisma.refund_items.create).not.toHaveBeenCalled();
    expect(prisma.orders.update).not.toHaveBeenCalled();
    expect(prisma.payments.update).not.toHaveBeenCalled();
    expect(stock.updateStock).not.toHaveBeenCalled();
    expect(serials.returnSerial).not.toHaveBeenCalled();
    expect(movements.recordRefundMovement).not.toHaveBeenCalled();
    expect(gateway.reversePaymentWithProcessor).not.toHaveBeenCalled();
    expect(balance.credit).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  }

  describe.each(['previewRefund', 'createRefund'] as const)('%s', (method) => {
    it.each([
      ['identical duplicate', item(1)],
      [
        'conflicting inventory destination',
        {
          ...item(1),
          inventory_action: 'write_off' as const,
          location_id: 9,
        },
      ],
    ])(
      'rejects %s before any monetary, stock or state effect',
      async (_label, duplicate) => {
        await expect(
          service[method](9001, dto([item(1), duplicate])),
        ).rejects.toMatchObject({ errorCode: 'REF_VALIDATE_001', status: 400 });
        expectNoEffects();
      },
    );

    it('rejects a foreign order item before effects', async () => {
      await expect(service[method](9001, dto([item(999)]))).rejects.toThrow(
        'does not belong to order #9001',
      );
      expectNoEffects();
    });

    it('rejects quantity beyond the original line before effects', async () => {
      await expect(service[method](9001, dto([item(1, 2)]))).rejects.toThrow(
        'Max refundable: 1',
      );
      expectNoEffects();
    });
  });

  it('creates a valid partial refund for A=10, restocks once, and leaves B outstanding', async () => {
    await service.createRefund(9001, dto([item(1)]));
    expect(prisma.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 10,
          tax_refund: 0,
          subtotal_refund: 10,
        }),
      }),
    );
    expect(prisma.refund_items.create).toHaveBeenCalledTimes(1);
    expect(stock.updateStock).toHaveBeenCalledTimes(1);
    expect(stock.updateStock).toHaveBeenCalledWith(
      expect.objectContaining({
        order_item_id: 1,
        quantity_change: 1,
        location_id: 7,
      }),
      prisma,
    );
    expect(prisma.orders.update).not.toHaveBeenCalled();
    expect(prisma.payments.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: 'partially_refunded' }),
      }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      'refund.completed',
      expect.objectContaining({
        amount: 10,
        is_full_refund: false,
      }),
    );
  });

  it('marks a valid refund full only when both original lines are covered', async () => {
    await service.createRefund(9001, dto([item(1), item(2)]));
    expect(prisma.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 1010 }),
      }),
    );
    expect(stock.updateStock).toHaveBeenCalledTimes(2);
    expect(prisma.orders.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: 'refunded' }),
      }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      'refund.completed',
      expect.objectContaining({
        amount: 1010,
        is_full_refund: true,
      }),
    );
  });

  it('does not mark order/payment full when excess historical A units mask one unreturned B', async () => {
    order.grand_total = new Prisma.Decimal(2010);
    order.subtotal_amount = new Prisma.Decimal(2010);
    order.total_paid = new Prisma.Decimal(2010);
    order.payments[0].amount = new Prisma.Decimal(2010);
    order.order_items[1].quantity = 2;
    order.order_items[1].total_price = new Prisma.Decimal(2000);
    order.refunds = [
      { amount: new Prisma.Decimal(20), refund_items: [item(1), item(1)] },
    ];

    await service.createRefund(9001, dto([item(2)]));
    expect(prisma.orders.update).not.toHaveBeenCalled();
    expect(prisma.payments.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: 'partially_refunded' }),
      }),
    );
    expect(events.emit).not.toHaveBeenCalledWith(
      'order.status_changed',
      expect.anything(),
    );
    expect(events.emit).toHaveBeenCalledWith(
      'refund.completed',
      expect.objectContaining({
        amount: 1000,
        is_full_refund: false,
      }),
    );
  });
});
