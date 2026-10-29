import { OrderSequenceService, formatOrderNumber } from './order-sequence.service';

describe('OrderSequenceService', () => {
  it('formatea el consecutivo con 6 dígitos (OP-000001)', () => {
    expect(formatOrderNumber('OP-', 1)).toBe('OP-000001');
    expect(formatOrderNumber('OP-', 123)).toBe('OP-000123');
    expect(formatOrderNumber('MFG-', 1234567)).toBe('MFG-1234567');
  });

  it('asigna el número devuelto por el upsert atómico', async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([{ prefix: 'OP-', assigned: 7 }]) };
    const service = new OrderSequenceService();
    await expect(service.next(tx as any, 1)).resolves.toBe('OP-000007');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('falla con MFG_SEQUENCE_FAILED si no hay fila devuelta', async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([]) };
    await expect(new OrderSequenceService().next(tx as any, 1)).rejects.toMatchObject({
      errorCode: 'MFG_SEQUENCE_FAILED',
    });
  });
});
