import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { RefundFlowService } from './refund-flow.service';
import { RefundCalculationService, REFUND_LEDGER_STATES } from './refund-calculation.service';
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
import { KitchenFireService } from '../../../kitchen-fire/kitchen-fire.service';
import { AutoEntryService } from '../../../accounting/auto-entries/auto-entry.service';

/**
 * CP-REFUND-FLOW-REDESIGN paso 10 — gate de platos (paso 6).
 *
 * Disposición guiada por estado: disparado ⇒ solo write_off con motivo
 * (sin movimiento de stock — el fire ya consumió), no disparado ⇒ restock
 * con reversa sourcing-ledger a costo histórico; KDS cancela en-tx con
 * SSE post-commit; reclass COGS solo al cubrir la línea completa.
 *
 * Invariante anti-doble-descuento: la rama plato no toca
 * `inventory_consumed_at_fire` (el pago sigue saltando disparados igual).
 */
describe('RefundFlowService — gate de platos (paso 6, CP-REFUND-FLOW-REDESIGN)', () => {
  let service: RefundFlowService;
  let stockLevelManager: { updateStock: jest.Mock; getDefaultLocationForProduct: jest.Mock };
  let kitchenFire: { cancelTicketItemsForRefund: jest.Mock };

  const dishItem = (over: any = {}) => ({
    order_item_id: 11,
    product_name: 'Bandeja',
    quantity: 2,
    unit_price: 15000,
    gross_amount: 30000,
    discount_amount: 0,
    net_amount: 30000,
    tax_amount: 0,
    refund_amount: 30000,
    inventory_action: 'restock',
    reason: 'cliente devolvió',
    ...over,
  });

  const tx = (over: any = {}) => ({
    inventory_transactions: { findMany: jest.fn().mockResolvedValue([]) },
    refund_items: { findMany: jest.fn().mockResolvedValue([]) },
    inventory_cost_layers: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    audit_logs: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    ...over,
  });

  const postCommit = () => ({ cancelledTicketIds: [], updatedTicketIds: [], reclassJobs: [] });

  const input = (over: any = {}) => ({
    orderId: 1,
    storeId: 10,
    organizationId: 1,
    refundId: 999,
    orderReason: 'gate plato',
    item: dishItem(),
    soldQuantity: 2,
    fired: false,
    userId: 7,
    postCommit: postCommit(),
    ...over,
  });

  const consumedLeaf = (over: any = {}) => ({
    product_id: 7,
    product_variant_id: null,
    quantity_change: -200,
    unit_cost: new Prisma.Decimal(50),
    total_cost: new Prisma.Decimal(-10000),
    ...over,
  });

  async function buildService(withKds = true) {
    stockLevelManager = {
      updateStock: jest.fn().mockResolvedValue(undefined),
      getDefaultLocationForProduct: jest.fn().mockResolvedValue(5),
    };
    kitchenFire = {
      cancelTicketItemsForRefund: jest.fn().mockResolvedValue({ cancelledTicketIds: [9], updatedTicketIds: [] }),
    };
    const providers: any[] = [
      RefundFlowService,
      { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      { provide: RefundCalculationService, useValue: { calculate: jest.fn() } },
      { provide: StorePrismaService, useValue: {} },
      { provide: RequestContextService, useValue: {} },
      { provide: StockLevelManager, useValue: stockLevelManager },
      { provide: SettingsService, useValue: {} },
      { provide: SessionsService, useValue: {} },
      { provide: MovementsService, useValue: {} },
      { provide: SerialNumberEnforcementService, useValue: {} },
      { provide: InventorySerialNumbersService, useValue: {} },
      { provide: WalletService, useValue: {} },
      { provide: WalletBalanceService, useValue: {} },
      { provide: PaymentGatewayService, useValue: {} },
      { provide: ManualRefundDeliveryService, useValue: {} },
      { provide: AutoEntryService, useValue: {} },
    ];
    if (withKds) providers.push({ provide: KitchenFireService, useValue: kitchenFire });
    const module: TestingModule = await Test.createTestingModule({ providers }).compile();
    service = module.get(RefundFlowService);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    await buildService(true);
  });

  const run = (t: any, i: any) =>
    (service as any).processDishRefundLine(t, i);

  describe('validación guiada por estado', () => {
    it('disparado + restock ⇒ 400 (el insumo cocinado no vuelve a stock)', async () => {
      await expect(run(tx(), input({ fired: true }))).rejects.toThrow(
        /only admits write_off/,
      );
      expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    });

    it('write_off sin motivo ⇒ 400 (ni línea ni orden aportan razón)', async () => {
      const i = input({
        fired: true,
        orderReason: '   ',
        item: dishItem({ inventory_action: 'write_off', reason: '' }),
      });

      await expect(run(tx(), i)).rejects.toThrow(/motivo/);
      expect(kitchenFire.cancelTicketItemsForRefund).not.toHaveBeenCalled();
    });

    it('write_off acepta el motivo de la orden cuando la línea no trae', async () => {
      const t = tx();
      const i = input({
        fired: true,
        item: dishItem({ inventory_action: 'write_off', reason: undefined }),
      });

      await run(t, i);

      expect(t.audit_logs.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ reason: 'gate plato', destination: 'waste' }),
        }),
      });
    });

    it('sin KitchenFireService falla FUERTE en-tx (nunca salta el KDS en silencio)', async () => {
      await buildService(false);

      await expect(run(tx(), input())).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('restock no disparado (reversa sourcing-ledger)', () => {
    it('revierte EXACTO el consumo registrado a costo histórico + recrea la capa', async () => {
      const t = tx({
        inventory_transactions: { findMany: jest.fn().mockResolvedValue([consumedLeaf()]) },
        refund_items: { findMany: jest.fn().mockResolvedValue([{ quantity: 2 }]) },
      });
      const i = input();

      await run(t, i);

      expect(stockLevelManager.updateStock).toHaveBeenCalledWith(
        expect.objectContaining({
          product_id: 7,
          location_id: 5,
          quantity_change: 200,
          movement_type: 'return',
          movement_unit_cost: 50,
          source_module: 'dish_refund',
        }),
        t,
      );
      expect(t.inventory_cost_layers.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          product_id: 7,
          quantity_remaining: 200,
          unit_cost: new Prisma.Decimal(50),
        }),
      });
    });

    it('parciales acumulados convergen exacto (prorrateo por ledger, no por request)', async () => {
      const t = tx({
        inventory_transactions: {
          findMany: jest.fn().mockResolvedValue([consumedLeaf({ quantity_change: -400, total_cost: new Prisma.Decimal(-20000) })]),
        },
        // Primer parcial de 1 sobre 4 vendidos: cumBefore=0, cumAfter=1.
        refund_items: { findMany: jest.fn().mockResolvedValue([{ quantity: 1 }]) },
      });
      const i = input({
        item: dishItem({ quantity: 1 }),
        soldQuantity: 4,
      });

      await run(t, i);

      // round(400×1/4) − round(400×0/4) = 100.
      expect(stockLevelManager.updateStock).toHaveBeenCalledWith(
        expect.objectContaining({ quantity_change: 100 }),
        t,
      );
      // Línea sin cubrir ⇒ sin reclass (el lane es idempotente por order_item).
      expect(i.postCommit.reclassJobs).toEqual([]);
    });

    it('fire sin receta (consumo vacío) revierte nada pero igual audita + KDS', async () => {
      const t = tx({
        refund_items: { findMany: jest.fn().mockResolvedValue([{ quantity: 2 }]) },
      });
      const i = input();

      await run(t, i);

      expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
      expect(t.inventory_cost_layers.create).not.toHaveBeenCalled();
      expect(kitchenFire.cancelTicketItemsForRefund).toHaveBeenCalledWith(t, 1, [11]);
      expect(t.audit_logs.create).toHaveBeenCalled();
      expect(i.postCommit.reclassJobs).toEqual([]);
    });
  });

  describe('write_off disparado (COGS a pérdida)', () => {
    const firedInput = () =>
      input({
        fired: true,
        item: dishItem({ inventory_action: 'write_off' }),
      });

    it('no mueve stock (el fire ya consumió: un damage duplicaría)', async () => {
      const t = tx({
        inventory_transactions: { findMany: jest.fn().mockResolvedValue([consumedLeaf()]) },
        refund_items: { findMany: jest.fn().mockResolvedValue([{ quantity: 2 }]) },
      });

      await run(t, firedInput());

      expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
      expect(t.inventory_cost_layers.create).not.toHaveBeenCalled();
    });

    it('cancela el KDS en-tx y encola el SSE post-commit', async () => {
      const t = tx();
      const i = firedInput();

      await run(t, i);

      expect(kitchenFire.cancelTicketItemsForRefund).toHaveBeenCalledWith(t, 1, [11]);
      expect(i.postCommit.cancelledTicketIds).toEqual([9]);
    });

    it('al cubrir la línea encola el reclass waste con el costo consumido', async () => {
      const t = tx({
        inventory_transactions: { findMany: jest.fn().mockResolvedValue([consumedLeaf()]) },
        refund_items: { findMany: jest.fn().mockResolvedValue([{ quantity: 2 }]) },
      });
      const i = firedInput();

      await run(t, i);

      expect(i.postCommit.reclassJobs).toEqual([
        { order_item_id: 11, organization_id: 1, disposition: 'waste', total_cost: 10000 },
      ]);
    });
  });

  describe('COGS + KDS + invariantes', () => {
    it('restock al cubrir la línea encola el reclass reuse (reversa simétrica)', async () => {
      const t = tx({
        inventory_transactions: { findMany: jest.fn().mockResolvedValue([consumedLeaf()]) },
        refund_items: { findMany: jest.fn().mockResolvedValue([{ quantity: 2 }]) },
      });
      const i = input();

      await run(t, i);

      expect(i.postCommit.reclassJobs).toEqual([
        { order_item_id: 11, organization_id: 1, disposition: 'reuse', total_cost: 10000 },
      ]);
    });

    it('la auditoría traza destino, fired, cobertura y hojas revertidas', async () => {
      const t = tx({
        inventory_transactions: { findMany: jest.fn().mockResolvedValue([consumedLeaf()]) },
        refund_items: { findMany: jest.fn().mockResolvedValue([{ quantity: 2 }]) },
      });

      await run(t, input());

      expect(t.audit_logs.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'order_item.refund_dish_disposition',
          resource_id: 1,
          metadata: expect.objectContaining({
            order_item_id: 11,
            refund_id: 999,
            destination: 'reuse',
            fired: false,
            refunded_qty: 2,
            cumulative_refunded_qty: 2,
            consumed_cost: 10000,
            reversed_leaves: [{ product_id: 7, quantity: 200, unit_cost: 50 }],
          }),
        }),
      });
    });

    it('nunca toca inventory_consumed_at_fire (anti-doble-descuento intacto)', async () => {
      // La tx ni siquiera expone order_items: si la rama intentara flipear
      // el flag, esto reventaría. El pago sigue saltando disparados igual.
      const t = tx({
        inventory_transactions: { findMany: jest.fn().mockResolvedValue([consumedLeaf()]) },
        refund_items: { findMany: jest.fn().mockResolvedValue([{ quantity: 2 }]) },
      });
      expect((t as any).order_items).toBeUndefined();

      await run(t, input({ fired: true, item: dishItem({ inventory_action: 'write_off' }) }));

      expect((t as any).order_items).toBeUndefined();
      expect(kitchenFire.cancelTicketItemsForRefund).toHaveBeenCalled();
    });
  });

  describe('release-853 paso 7: ledger filtrado por estado (caso d)', () => {
    it('el ledger acumulativo filtra por REFUND_LEDGER_STATES: un failed previo no infla cumAfter', async () => {
      const t = tx({
        inventory_transactions: { findMany: jest.fn().mockResolvedValue([consumedLeaf()]) },
        // La BD ya excluyó al failed por el filtro de estado: solo llegan
        // las filas LEDGER (este refund). Sin el filtro, el failed previo
        // inflaría cumAfter y el prorrateo repondría insumos de más.
        refund_items: { findMany: jest.fn().mockResolvedValue([{ quantity: 2 }]) },
      });
      const i = input();

      await run(t, i);

      expect(t.refund_items.findMany).toHaveBeenCalledWith({
        where: {
          order_item_id: 11,
          refunds: { state: { in: [...REFUND_LEDGER_STATES] } },
        },
        select: { quantity: true },
      });
      // cumAfter = 2 (solo este refund) ⇒ reversa exacta, sin sobre-reposición.
      expect(stockLevelManager.updateStock).toHaveBeenCalledWith(
        expect.objectContaining({ product_id: 7, quantity_change: 200 }),
        t,
      );
      expect(i.postCommit.reclassJobs).toEqual([
        { order_item_id: 11, organization_id: 1, disposition: 'reuse', total_cost: 10000 },
      ]);
    });
  });
});
