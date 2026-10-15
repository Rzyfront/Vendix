import {
  lockHolderChangeOrder,
  assertNoHolderChangeReservation,
} from './holder-change-reservation';

describe('holder change shared order reservation', () => {
  it('binds row lock to order, store and organization via stores (orders has no organization_id)', async () => {
    const tx: any = { $queryRaw: jest.fn().mockResolvedValue([{ id: 12 }]) };
    await lockHolderChangeOrder(tx, 12, 3, 7);
    const [sql, ...values] = tx.$queryRaw.mock.calls[0];
    expect(sql.join(' ')).toContain('JOIN stores');
    expect(sql.join(' ')).toContain('FOR UPDATE OF o');
    expect(values).toEqual([12, 3, 7]);
  });
  it('rejects a cross-tenant/missing order before any write', async () => {
    await expect(
      lockHolderChangeOrder(
        { $queryRaw: jest.fn().mockResolvedValue([]) } as any,
        12,
        3,
        8,
      ),
    ).rejects.toMatchObject({ errorCode: expect.any(String) });
  });
  it('blocks ordinary invoice, split, refund and customer writers while reserved; only server operation can continue', async () => {
    const tx: any = {
      invoice_holder_changes: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 21, phase: 'awaiting_customer' }),
      },
    };
    await expect(
      assertNoHolderChangeReservation(tx, 12, 3),
    ).rejects.toMatchObject({ errorCode: 'INVOICING_CREATE_002' });
    await expect(
      assertNoHolderChangeReservation(tx, 12, 3, 22),
    ).rejects.toBeDefined();
    await expect(
      assertNoHolderChangeReservation(tx, 12, 3, 21),
    ).resolves.toBeUndefined();
    expect(tx.invoice_holder_changes.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          original_order_id: 12,
          store_id: 3,
          active_order_key: { not: null },
        },
      }),
    );
  });
  it('preserves normal writers after the reservation is released', async () => {
    await expect(
      assertNoHolderChangeReservation(
        {
          invoice_holder_changes: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
        } as any,
        12,
        3,
      ),
    ).resolves.toBeUndefined();
  });
});
