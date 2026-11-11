import { nextPosOrderNumber } from './pos-order-number.util';

describe('nextPosOrderNumber', () => {
  const tx = (lastSequence: number | null) => ({
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([{ seq: lastSequence }]),
  });
  const now = new Date('2026-11-10T15:00:00Z');

  it('starts the store year at POS-YYYY-0001', async () => {
    await expect(nextPosOrderNumber(tx(null), 7, now)).resolves.toBe('POS-2026-0001');
  });

  it('continues after the last POS number of the store', async () => {
    await expect(nextPosOrderNumber(tx(41), 7, now)).resolves.toBe('POS-2026-0042');
  });

  it('keeps counting past 9999 (the highest number is compared as a number, not as text)', async () => {
    await expect(nextPosOrderNumber(tx(9999), 7, now)).resolves.toBe('POS-2026-10000');
    await expect(nextPosOrderNumber(tx(10000), 7, now)).resolves.toBe('POS-2026-10001');
  });

  it('reads the highest sequence of that store and year only', async () => {
    const client = tx(5);
    await nextPosOrderNumber(client, 7, now);
    const [strings, ...values] = client.$queryRaw.mock.calls[0];
    expect((strings as TemplateStringsArray).join('?')).toContain('split_part(order_number');
    expect(values).toEqual([7, '^POS-2026-[0-9]+$']);
  });

  it('serializes the store numbering inside the transaction before reading', async () => {
    const client = tx(null);
    const calls: string[] = [];
    client.$executeRaw.mockImplementation(async () => calls.push('lock'));
    client.$queryRaw.mockImplementation(async () => {
      calls.push('read');
      return [{ seq: null }];
    });
    await nextPosOrderNumber(client, 7, now);
    expect(calls).toEqual(['lock', 'read']);
  });
});
