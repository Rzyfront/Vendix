import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
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

/**
 * CP-REFUND-FLOW-REDESIGN paso 10 — gate de dinero durable (paso 4).
 *
 * Caja: entrega durable o falla visible — nunca `return` silencioso. El
 * aviso (`recorded` / `pending` + fila del outbox / `skipped`) viaja en la
 * respuesta del refund para el operador.
 *
 * Wallet: `creditForRefund` deja fila durable (`reference_type='refund'`,
 * `reference_id=refund_id`) y NO emite `wallet.credited` (corrección
 * contable: el listener postea con mapping de RECARGA e idempotencia por
 * `wallet_id`, incorrecto para un refund donde no entra caja).
 */
describe('RefundFlowService — gate de caja durable (paso 4, CP-REFUND-FLOW-REDESIGN)', () => {
  let service: RefundFlowService;
  let settingsService: { getSettings: jest.Mock };
  let sessionsService: { getActiveSession: jest.Mock };
  let movementsService: { recordRefundCashMovementDurable: jest.Mock };

  const cashInput = (over: any = {}) => ({
    organization_id: 1,
    store_id: 10,
    user_id: 7,
    refund_id: 999,
    order_id: 1,
    payment_id: 100,
    amount: 1000,
    channel: 'cash',
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    settingsService = {
      getSettings: jest.fn().mockResolvedValue({ pos: { cash_register: { enabled: true } } }),
    };
    sessionsService = { getActiveSession: jest.fn().mockResolvedValue({ id: 3 }) };
    movementsService = {
      recordRefundCashMovementDurable: jest.fn().mockResolvedValue({ status: 'recorded', movement_id: 9 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundFlowService,
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: RefundCalculationService, useValue: { calculate: jest.fn() } },
        { provide: StorePrismaService, useValue: {} },
        { provide: RequestContextService, useValue: {} },
        { provide: StockLevelManager, useValue: {} },
        { provide: SettingsService, useValue: settingsService },
        { provide: SessionsService, useValue: sessionsService },
        { provide: MovementsService, useValue: movementsService },
        { provide: SerialNumberEnforcementService, useValue: {} },
        { provide: InventorySerialNumbersService, useValue: {} },
        { provide: WalletService, useValue: {} },
        { provide: WalletBalanceService, useValue: {} },
        { provide: PaymentGatewayService, useValue: {} },
        { provide: ManualRefundDeliveryService, useValue: {} },
      ],
    }).compile();

    service = module.get(RefundFlowService);
  });

  const run = (input: any) =>
    (service as any).recordRefundCashRegisterMovement(input);

  it('con sesión abierta entrega durable con payment_id y canal real', async () => {
    const notice = await run(cashInput());

    expect(movementsService.recordRefundCashMovementDurable).toHaveBeenCalledWith({
      organization_id: 1,
      store_id: 10,
      user_id: 7,
      refund_id: 999,
      order_id: 1,
      payment_id: 100,
      amount: 1000,
      channel: 'cash',
      session_id: 3,
    });
    expect(notice).toEqual({ status: 'recorded', movement_id: 9 });
  });

  it('sin sesión abierta NO retorna en silencio: pending + fila del outbox', async () => {
    sessionsService.getActiveSession.mockResolvedValue(null);
    movementsService.recordRefundCashMovementDurable.mockResolvedValue({
      status: 'pending',
      failure_id: 44,
      reason: 'no_open_cash_session',
    });

    const notice = await run(cashInput());

    expect(movementsService.recordRefundCashMovementDurable).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: null }),
    );
    expect(notice).toEqual({ status: 'pending', failure_id: 44, reason: 'no_open_cash_session' });
  });

  it('módulo de caja apagado ⇒ skipped explícito (no hay nada que entregar)', async () => {
    settingsService.getSettings.mockResolvedValue({ pos: { cash_register: { enabled: false } } });

    const notice = await run(cashInput());

    expect(notice).toEqual({ status: 'skipped', reason: 'cash_register_disabled' });
    expect(movementsService.recordRefundCashMovementDurable).not.toHaveBeenCalled();
  });

  it('sin organización ⇒ pending visible (el outbox no se puede escribir)', async () => {
    const notice = await run(cashInput({ organization_id: null }));

    expect(notice).toEqual({ status: 'pending', failure_id: null, reason: 'unknown_organization' });
    expect(sessionsService.getActiveSession).not.toHaveBeenCalled();
  });

  it('si la propia entrega durable lanza, degrada a pending y nunca revienta el refund', async () => {
    movementsService.recordRefundCashMovementDurable.mockRejectedValue(new Error('db caída'));

    const notice = await run(cashInput());

    expect(notice).toEqual({ status: 'pending', failure_id: null, reason: 'delivery_error' });
  });
});

describe('WalletService — gate de crédito por refund (paso 4, corrección contable)', () => {
  it('creditForRefund deja fila durable refund y NO emite wallet.credited', async () => {
    const eventEmitter = { emit: jest.fn() };
    const walletBalance = { credit: jest.fn().mockResolvedValue({ id: 55, balance: 1000 }) };
    const prisma = {
      wallets: { findFirst: jest.fn().mockResolvedValue({ id: 8, balance: 0 }) },
    };
    const service = new WalletService(prisma as any, walletBalance as any, eventEmitter as any);

    const result = await service.creditForRefund(21, 1000, {
      refund_id: 999,
      order_id: 1,
      user_id: 7,
    });

    expect(walletBalance.credit).toHaveBeenCalledWith(8, 1000, {
      reference_type: 'refund',
      reference_id: 999,
      description: 'Refund #999 for order #1',
      created_by: 7,
    });
    expect(eventEmitter.emit).not.toHaveBeenCalledWith('wallet.credited', expect.anything());
    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(result).toMatchObject({ wallet_id: 8 });
  });
});
