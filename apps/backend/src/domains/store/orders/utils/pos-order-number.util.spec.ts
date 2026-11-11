import { nextPosOrderNumber } from './pos-order-number.util';

describe('nextPosOrderNumber', () => {
  const tx = (last: string | null) => ({
    $executeRaw: jest.fn().mockResolvedValue(1),
    orders: {
      findFirst: jest.fn().mockResolvedValue(last ? { order_number: last } : null),
    },
  });
  const now = new Date('2026-11-10T15:00:00Z');

  it('starts the store year at POS-YYYY-0001', async () => {
    await expect(nextPosOrderNumber(tx(null), 7, now)).resolves.toBe('POS-2026-0001');
  });

  it('continues after the last POS number of the store', async () => {
    const client = tx('POS-2026-0041');
    await expect(nextPosOrderNumber(client, 7, now)).resolves.toBe('POS-2026-0042');
    expect(client.orders.findFirst).toHaveBeenCalledWith({
      where: { store_id: 7, order_number: { startsWith: 'POS-2026' } },
      orderBy: { order_number: 'desc' },
      select: { order_number: true },
    });
  });

  it('serializes the store numbering inside the transaction before reading', async () => {
    const client = tx(null);
    const calls: string[] = [];
    client.$executeRaw.mockImplementation(async () => calls.push('lock'));
    client.orders.findFirst.mockImplementation(async () => {
      calls.push('read');
      return null;
    });
    await nextPosOrderNumber(client, 7, now);
    expect(calls).toEqual(['lock', 'read']);
  });
});
