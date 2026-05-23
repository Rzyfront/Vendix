import { InvoiceNumberGenerator } from './invoice-number-generator';

describe('InvoiceNumberGenerator', () => {
  const createService = (txOverrides: any = {}) => {
    const resolution = {
      id: 9,
      prefix: 'FE',
      current_number: 10,
      range_to: 20,
    };
    const tx = {
      $queryRawUnsafe: jest.fn(),
      invoice_resolutions: {
        findFirst: jest.fn().mockResolvedValue(resolution),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest
          .fn()
          .mockResolvedValue({ ...resolution, current_number: 11 }),
      },
      ...txOverrides,
    };
    const client = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const prisma = { withoutScope: () => client };
    const fiscalScope = {
      resolveAccountingEntityForFiscal: jest.fn(),
    };

    return {
      service: new InvoiceNumberGenerator(prisma as any, fiscalScope as any),
      tx,
      fiscalScope,
    };
  };

  it('locks and increments by accounting entity and fiscal document type', async () => {
    const { service, tx, fiscalScope } = createService();

    await expect(
      service.generateNextNumber({
        organization_id: 1,
        accounting_entity_id: 77,
        document_type: 'support_document',
      }),
    ).resolves.toEqual({ invoice_number: 'FE11', resolution_id: 9 });

    expect(fiscalScope.resolveAccountingEntityForFiscal).not.toHaveBeenCalled();
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      'invoice_resolution:77:support_document',
    );
    expect(tx.invoice_resolutions.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        accounting_entity_id: 77,
        document_type: 'support_document',
        is_active: true,
      }),
      orderBy: { created_at: 'desc' },
    });
    expect(tx.invoice_resolutions.updateMany).toHaveBeenCalledWith({
      where: { id: 9, current_number: { lt: 20 } },
      data: { current_number: { increment: 1 } },
    });
  });

  it('resolves the fiscal accounting entity when not provided', async () => {
    const { service, fiscalScope } = createService();
    fiscalScope.resolveAccountingEntityForFiscal.mockResolvedValue({ id: 501 });

    await service.generateNextNumber({
      organization_id: 1,
      store_id: 30,
      document_type: 'sales_invoice',
    });

    expect(fiscalScope.resolveAccountingEntityForFiscal).toHaveBeenCalledWith({
      organization_id: 1,
      store_id: 30,
    });
  });

  it('blocks exhausted fiscal ranges without allocating a number', async () => {
    const { service } = createService({
      invoice_resolutions: {
        findFirst: jest.fn().mockResolvedValue({
          id: 9,
          prefix: 'FE',
          current_number: 20,
          range_to: 20,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn(),
      },
    });

    await expect(
      service.generateNextNumber({
        organization_id: 1,
        accounting_entity_id: 77,
      }),
    ).rejects.toMatchObject({ errorCode: 'FISCAL_RESOLUTION_EXHAUSTED' });
  });
});
