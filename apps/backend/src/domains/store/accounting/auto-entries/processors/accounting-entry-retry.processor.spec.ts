import { AccountingEntryRetryProcessor } from './accounting-entry-retry.processor';
import { REFUND_CASH_MOVEMENT_KEY } from '../../../cash-registers/movements/movements.service';
import { MANUAL_REFUND_DELIVERY_KEY } from '../manual-refund-delivery.service';

/**
 * Release-853 (paso 6) — el router de `AccountingEntryRetryProcessor.process`
 * debe enviar `REFUND_CASH_MOVEMENT_KEY` a la entrega durable de
 * `MovementsService` (resuelta perezosamente vía `ModuleRef`), NUNCA a
 * `postAutoEntry`: ese payload es un movimiento de caja, no un asiento
 * contable, y postearlo como asiento produciría datos contables basura.
 */
describe('AccountingEntryRetryProcessor.process — ruteo por handler_key', () => {
  const FAILURE_ID = 777;

  const createProcessor = () => {
    const auto_entry_service = { postAutoEntry: jest.fn() };
    const failure_service = {
      findOne: jest.fn(),
      markResolved: jest.fn(),
      recordAttempt: jest.fn(),
    };
    const manualRefundDelivery = { deliver: jest.fn() };
    const movements = { deliverRefundCashMovement: jest.fn() };
    const moduleRef = { get: jest.fn().mockReturnValue(movements) };

    const processor = new AccountingEntryRetryProcessor(
      auto_entry_service as any,
      failure_service as any,
      manualRefundDelivery as any,
      moduleRef as any,
    );

    return {
      processor,
      auto_entry_service,
      failure_service,
      manualRefundDelivery,
      movements,
      moduleRef,
    };
  };

  it('handler_key REFUND_CASH_MOVEMENT_KEY: resuelve MovementsService via moduleRef y delega, sin tocar postAutoEntry', async () => {
    const {
      processor,
      auto_entry_service,
      failure_service,
      manualRefundDelivery,
      movements,
      moduleRef,
    } = createProcessor();
    failure_service.findOne.mockResolvedValue({
      id: FAILURE_ID,
      handler_key: REFUND_CASH_MOVEMENT_KEY,
      resolved_at: null,
      event_payload: { refund_id: 900 },
    });
    movements.deliverRefundCashMovement.mockResolvedValue(undefined);

    await processor.process({ data: { failure_id: FAILURE_ID } } as any);

    expect(moduleRef.get).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ strict: false }),
    );
    expect(movements.deliverRefundCashMovement).toHaveBeenCalledWith(
      FAILURE_ID,
    );
    // Nunca el camino de asiento contable normal ni el de refund manual.
    expect(auto_entry_service.postAutoEntry).not.toHaveBeenCalled();
    expect(manualRefundDelivery.deliver).not.toHaveBeenCalled();
    // `MovementsService.deliverRefundCashMovement` administra su propio
    // `resolved_at`/`attempt_count` en su outbox; el processor no debe
    // duplicarlo marcando la fila resuelta o registrando otro intento.
    expect(failure_service.markResolved).not.toHaveBeenCalled();
    expect(failure_service.recordAttempt).not.toHaveBeenCalled();
  });

  it('handler_key REFUND_CASH_MOVEMENT_KEY: si la entrega falla, el error se propaga sin registrar intento aparte (BullMQ aplica su propio backoff)', async () => {
    const { processor, failure_service, movements } = createProcessor();
    failure_service.findOne.mockResolvedValue({
      id: FAILURE_ID,
      handler_key: REFUND_CASH_MOVEMENT_KEY,
      resolved_at: null,
      event_payload: { refund_id: 900 },
    });
    const deliveryError = new Error('NO_OPEN_SESSION: ...');
    movements.deliverRefundCashMovement.mockRejectedValue(deliveryError);

    await expect(
      processor.process({ data: { failure_id: FAILURE_ID } } as any),
    ).rejects.toBe(deliveryError);

    expect(failure_service.recordAttempt).not.toHaveBeenCalled();
  });

  it('handler_key normal (asiento contable): va a postAutoEntry y NUNCA a MovementsService', async () => {
    const {
      processor,
      auto_entry_service,
      failure_service,
      movements,
      moduleRef,
    } = createProcessor();
    const payload = {
      source_type: 'order',
      source_id: 42,
      organization_id: 3,
      store_id: 10,
      user_id: 7,
    };
    failure_service.findOne.mockResolvedValue({
      id: FAILURE_ID,
      handler_key: 'some_other_auto_entry_key',
      resolved_at: null,
      event_payload: payload,
    });
    auto_entry_service.postAutoEntry.mockResolvedValue({ id: 501 });

    await processor.process({ data: { failure_id: FAILURE_ID } } as any);

    expect(auto_entry_service.postAutoEntry).toHaveBeenCalledWith(
      expect.objectContaining({ source_type: 'order', source_id: 42 }),
    );
    expect(failure_service.markResolved).toHaveBeenCalledWith(FAILURE_ID);
    expect(moduleRef.get).not.toHaveBeenCalled();
    expect(movements.deliverRefundCashMovement).not.toHaveBeenCalled();
  });

  it('handler_key MANUAL_REFUND_DELIVERY_KEY: va a ManualRefundDeliveryService y NUNCA a MovementsService', async () => {
    const { processor, manualRefundDelivery, movements, moduleRef, failure_service } =
      createProcessor();
    failure_service.findOne.mockResolvedValue({
      id: FAILURE_ID,
      handler_key: MANUAL_REFUND_DELIVERY_KEY,
      resolved_at: null,
      event_payload: { refund_id: 900 },
    });
    manualRefundDelivery.deliver.mockResolvedValue(undefined);

    await processor.process({ data: { failure_id: FAILURE_ID } } as any);

    expect(manualRefundDelivery.deliver).toHaveBeenCalledWith(FAILURE_ID);
    expect(moduleRef.get).not.toHaveBeenCalled();
    expect(movements.deliverRefundCashMovement).not.toHaveBeenCalled();
  });
});
