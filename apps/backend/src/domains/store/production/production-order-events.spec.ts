import {
  PRODUCTION_ORDER_UPDATED_EVENT,
  emitProductionOrderUpdated,
} from './production-order-events';

describe('emitProductionOrderUpdated (QUI-1002)', () => {
  const logger = { warn: jest.fn() };
  const row = {
    id: 5,
    store_id: 1,
    order_id: 77,
    status: 'in_progress',
    started_at: new Date('2026-11-10T15:00:00Z'),
    produced_at: null,
    estimated_minutes: 30,
  };

  beforeEach(() => logger.warn.mockClear());

  it('emits production_order.updated with the contract payload (ISO dates, raw override)', () => {
    const emitter = { emit: jest.fn() };
    emitProductionOrderUpdated(emitter as any, logger, row);
    expect(PRODUCTION_ORDER_UPDATED_EVENT).toBe('production_order.updated');
    expect(emitter.emit).toHaveBeenCalledTimes(1);
    expect(emitter.emit).toHaveBeenCalledWith('production_order.updated', {
      type: 'production_order.updated',
      store_id: 1,
      id: 5,
      order_id: 77,
      status: 'in_progress',
      started_at: '2026-11-10T15:00:00.000Z',
      produced_at: null,
      estimated_minutes: 30,
    });
  });

  it('normalizes missing optional fields to null', () => {
    const emitter = { emit: jest.fn() };
    emitProductionOrderUpdated(emitter as any, logger, { id: 6, store_id: 1, status: 'draft' });
    expect(emitter.emit.mock.calls[0][1]).toEqual({
      type: 'production_order.updated',
      store_id: 1,
      id: 6,
      order_id: null,
      status: 'draft',
      started_at: null,
      produced_at: null,
      estimated_minutes: null,
    });
  });

  it('never throws when the emitter fails; it logs a warning', () => {
    const emitter = {
      emit: jest.fn(() => {
        throw new Error('boom');
      }),
    };
    expect(() => emitProductionOrderUpdated(emitter as any, logger, row)).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('is a no-op without emitter or without a store id', () => {
    const emitter = { emit: jest.fn() };
    expect(() => emitProductionOrderUpdated(undefined, logger, row)).not.toThrow();
    emitProductionOrderUpdated(emitter as any, logger, { ...row, store_id: undefined });
    expect(emitter.emit).not.toHaveBeenCalled();
  });
});
