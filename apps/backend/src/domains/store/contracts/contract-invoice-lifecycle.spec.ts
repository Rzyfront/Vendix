import { markContractFiscalAcceptance } from './contract-invoice-lifecycle';

describe('markContractFiscalAcceptance', () => {
  const acceptedInvoice = {
    contract_id: 17,
    store_id: 4,
    organization_id: 2,
    status: 'accepted',
    accepted_at: new Date('2026-10-10T12:00:00Z'),
    cufe: 'f'.repeat(96),
  };

  function client(status = 'active', updated_at: Date | null = new Date()) {
    return {
      contracts: {
        findFirst: jest.fn().mockResolvedValue({ status, updated_at }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
  }

  it('cambia sólo active->invoiced con tenant y updated_at explícitos', async () => {
    const db = client('active', new Date('2026-10-10T11:00:00Z'));

    await markContractFiscalAcceptance(db as any, acceptedInvoice);

    expect(db.contracts.findFirst).toHaveBeenCalledWith({
      where: { id: 17, store_id: 4, organization_id: 2 },
      select: { status: true, updated_at: true },
    });
    expect(db.contracts.updateMany).toHaveBeenCalledWith({
      where: {
        id: 17,
        store_id: 4,
        organization_id: 2,
        status: 'active',
        updated_at: new Date('2026-10-10T11:00:00Z'),
      },
      data: expect.objectContaining({ status: 'invoiced' }),
    });
    expect(db.contracts.updateMany.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        status: 'invoiced',
        updated_at: expect.any(Date),
      }),
    );
  });

  it.each([
    ['without contract relation', { ...acceptedInvoice, contract_id: null }],
    ['for a draft', { ...acceptedInvoice, status: 'draft' }],
    ['for a rejected invoice', { ...acceptedInvoice, status: 'rejected' }],
    ['without accepted_at', { ...acceptedInvoice, accepted_at: null }],
    ['without a fiscal key', { ...acceptedInvoice, cufe: null }],
  ])('does not update %s', async (_label, invoice) => {
    const db = client();

    await markContractFiscalAcceptance(db as any, invoice);

    expect(db.contracts.findFirst).not.toHaveBeenCalled();
    expect(db.contracts.updateMany).not.toHaveBeenCalled();
  });

  it('does not cross tenants when the contract is outside the invoice scope', async () => {
    const db = client();
    db.contracts.findFirst.mockResolvedValue(null);

    await expect(
      markContractFiscalAcceptance(db as any, acceptedInvoice),
    ).rejects.toMatchObject({ errorCode: 'CONTRACT_STATUS_001' });
    expect(db.contracts.updateMany).not.toHaveBeenCalled();
  });

  it('repairs idempotently if another attempt already invoiced the contract', async () => {
    const db = client('invoiced');

    await expect(
      markContractFiscalAcceptance(db as any, acceptedInvoice),
    ).resolves.toBeUndefined();
    expect(db.contracts.updateMany).not.toHaveBeenCalled();
  });

  it('re-reads after a CAS miss and treats a competing invoice as idempotent success', async () => {
    const db = client();
    db.contracts.updateMany.mockResolvedValueOnce({ count: 0 });
    db.contracts.findFirst
      .mockResolvedValueOnce({ status: 'active', updated_at: new Date() })
      .mockResolvedValueOnce({ status: 'invoiced', updated_at: new Date() });

    await expect(
      markContractFiscalAcceptance(db as any, acceptedInvoice),
    ).resolves.toBeUndefined();

    expect(db.contracts.findFirst).toHaveBeenCalledTimes(2);
    expect(db.contracts.updateMany).toHaveBeenCalledTimes(1);
  });

  it('requires tenant identity before any contract read or write', async () => {
    const db = client();

    await expect(
      markContractFiscalAcceptance(db as any, {
        ...acceptedInvoice,
        store_id: null,
      }),
    ).rejects.toMatchObject({ errorCode: 'CONTRACT_STATUS_001' });
    expect(db.contracts.findFirst).not.toHaveBeenCalled();
    expect(db.contracts.updateMany).not.toHaveBeenCalled();
  });
});
