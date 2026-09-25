import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import {
  buildRefundCoverageLedger,
  REFUND_LEDGER_STATES,
  RefundCalculationService,
} from './refund-calculation.service';
import { RefundFlowService } from './refund-flow.service';
import { RefundCoverageService } from './refund-coverage.service';
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

/**
 * M2 fix-forward (review 78/100) — el ledger de cobertura por línea solo
 * cuenta estados LEDGER (completed/pending_approval/processing). Un refund
 * `failed`/`cancelled` con ítems persistidos NO debe marcar cobertura:
 * de lo contrario el overstatement es permanente y el reintento pierde su
 * UI (guardas sin saldo mientras el backend sí lo permitiría).
 */
describe('RefundCoverageLedger — estados LEDGER (M2 fix-forward)', () => {
  const line = (order_item_id: number, quantity: number, refund_amount: number) => ({
    order_item_id,
    quantity,
    refund_amount: new Prisma.Decimal(refund_amount),
  });

  it('cuenta completed/pending_approval/processing', () => {
    const ledger = buildRefundCoverageLedger([
      { state: 'completed', refund_items: [line(1, 2, 2000)] },
      { state: 'pending_approval', refund_items: [line(1, 1, 1000)] },
      { state: 'processing', refund_items: [line(2, 3, 600)] },
    ]);

    expect(ledger.get(1)).toMatchObject({ order_item_id: 1, refunded_qty: 3 });
    expect(ledger.get(1)?.refunded_amount.toNumber()).toBe(3000);
    expect(ledger.get(2)).toMatchObject({ order_item_id: 2, refunded_qty: 3 });
  });

  it('ignora failed/cancelled/requested/approved con state presente', () => {
    const ledger = buildRefundCoverageLedger([
      { state: 'completed', refund_items: [line(1, 1, 1000)] },
      { state: 'failed', refund_items: [line(1, 5, 5000)] },
      { state: 'cancelled', refund_items: [line(1, 2, 2000)] },
      { state: 'requested', refund_items: [line(2, 4, 400)] },
      { state: 'approved', refund_items: [line(2, 4, 400)] },
    ]);

    expect(ledger.get(1)).toMatchObject({ refunded_qty: 1 });
    expect(ledger.get(1)?.refunded_amount.toNumber()).toBe(1000);
    expect(ledger.has(2)).toBe(false);
  });

  it('state ausente conserva el include legacy (no dropea filas sin tipo)', () => {
    const ledger = buildRefundCoverageLedger([
      { refund_items: [line(7, 2, 250)] },
    ]);

    expect(ledger.get(7)).toMatchObject({ refunded_qty: 2 });
  });

  it('REFUND_LEDGER_STATES es exactamente completed/pending_approval/processing', () => {
    expect([...REFUND_LEDGER_STATES].sort()).toEqual(
      ['completed', 'pending_approval', 'processing'].sort(),
    );
  });

  describe('getCoverage filtra en el query', () => {
    it('pide refunds solo en estados LEDGER', async () => {
      const mockPrisma: any = {
        orders: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
        order_items: { findMany: jest.fn().mockResolvedValue([]) },
        refunds: { findMany: jest.fn().mockResolvedValue([]) },
        withoutScope: jest.fn().mockReturnValue({
          credit_note_refund_items: { findMany: jest.fn().mockResolvedValue([]) },
        }),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RefundCoverageService,
          { provide: StorePrismaService, useValue: mockPrisma },
        ],
      }).compile();

      await module.get(RefundCoverageService).getCoverage(1);

      expect(mockPrisma.refunds.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { order_id: 1, state: { in: [...REFUND_LEDGER_STATES] } },
        }),
      );
    });
  });

  describe('§2b re-agrega vía recomputeLineCache (release-853, paso 7)', () => {
    it('la creación re-agrega el caché en la misma tx (sin SQL inline)', async () => {
      const mockCoverage = { recomputeLineCache: jest.fn().mockResolvedValue(undefined) };
      const mockPrisma: any = {
        orders: {
          findFirst: jest.fn().mockImplementation((args: any) =>
            args?.select
              ? { state: 'finished' }
              : {
                  id: 1,
                  store_id: 10,
                  state: 'finished',
                  order_number: 'O-1',
                  payments: [{ id: 100, state: 'succeeded' }],
                  stores: { id: 10, organization_id: 1 },
                  order_items: [],
                },
          ),
          update: jest.fn(),
        },
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
        $transaction: jest.fn(async (cb: any, onReject?: any) => {
          try {
            return await cb(mockPrisma);
          } catch (e) {
            if (onReject) return onReject(e);
            throw e;
          }
        }),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RefundFlowService,
          { provide: EventEmitter2, useValue: { emit: jest.fn() } },
          {
            provide: RefundCalculationService,
            useValue: {
              calculate: jest.fn().mockResolvedValue({
                items: [{ order_item_id: 11 }],
                subtotal_refund: 1000,
                tax_refund: 0,
                shipping_refund: 0,
                shipping_tax_refund: 0,
                shipping_tax_type: null,
                total_refund: 1000,
                is_full_refund: false,
                already_refunded: 0,
                max_refundable: 9000,
              }),
            },
          },
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
          { provide: RefundCoverageService, useValue: mockCoverage },
        ],
      }).compile();

      await module.get(RefundFlowService).createRefund(1, {
        items: [],
        include_shipping: false,
        refund_method: 'cash',
        reason: 'M2 §2b',
      } as any);

      // El SQL inline murió: la agregación vive en el helper y corre en la
      // misma tx que inserta los refund_items (el cliente es la tx).
      expect(mockCoverage.recomputeLineCache).toHaveBeenCalledWith(mockPrisma, 1);
      const statements = mockPrisma.$queryRaw.mock.calls.map((c: any[]) =>
        Array.isArray(c[0]) ? (c[0] as string[]).join('') : String(c[0]),
      );
      expect(statements.some((s: string) => s.includes('UPDATE "order_items"'))).toBe(false);
    });
  });

  describe('recomputeLineCache agrega con LEDGER y resetea a 0', () => {
    const line = (id: number) => ({ id });

    async function runWith(refunds: any[], lines: any[]) {
      const mockClient: any = {
        refunds: { findMany: jest.fn().mockResolvedValue(refunds) },
        order_items: {
          findMany: jest.fn().mockResolvedValue(lines),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RefundCoverageService,
          { provide: StorePrismaService, useValue: {} },
        ],
      }).compile();

      await module
        .get(RefundCoverageService)
        .recomputeLineCache(mockClient, 1);
      return mockClient;
    }

    it('re-agrega valores absolutos y filtra estados LEDGER en el query', async () => {
      const mockClient = await runWith(
        [
          {
            state: 'completed',
            refund_items: [
              {
                order_item_id: 11,
                quantity: 2,
                refund_amount: new Prisma.Decimal(5000),
              },
            ],
          },
        ],
        [line(11)],
      );

      expect(mockClient.refunds.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { order_id: 1, state: { in: [...REFUND_LEDGER_STATES] } },
        }),
      );
      expect(mockClient.order_items.updateMany).toHaveBeenCalledWith({
        where: { id: 11, order_id: 1 },
        data: { refunded_qty: 2, refunded_amount: new Prisma.Decimal(5000) },
      });
    });

    it('líneas sin ledger vuelven a 0 (caso a: failed previo no congela cobertura)', async () => {
      // La BD ya excluyó al failed por el filtro de estado: el helper ve
      // ledger vacío y resetea. Así una línea que un refund fallido tocó
      // queda en 0 en vez de congelar su cobertura vieja.
      const mockClient = await runWith([], [line(11), line(12)]);

      expect(mockClient.order_items.updateMany).toHaveBeenCalledWith({
        where: { id: 11, order_id: 1 },
        data: { refunded_qty: 0, refunded_amount: 0 },
      });
      expect(mockClient.order_items.updateMany).toHaveBeenCalledWith({
        where: { id: 12, order_id: 1 },
        data: { refunded_qty: 0, refunded_amount: 0 },
      });
    });

    it('ignora filas failed aunque vengan en el resultado (doble filtro del builder)', async () => {
      const mockClient = await runWith(
        [
          {
            state: 'failed',
            refund_items: [
              {
                order_item_id: 11,
                quantity: 9,
                refund_amount: new Prisma.Decimal(9000),
              },
            ],
          },
        ],
        [line(11)],
      );

      expect(mockClient.order_items.updateMany).toHaveBeenCalledWith({
        where: { id: 11, order_id: 1 },
        data: { refunded_qty: 0, refunded_amount: 0 },
      });
    });
  });
});
