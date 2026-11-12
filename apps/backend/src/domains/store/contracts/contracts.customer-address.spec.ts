import { ContractsService } from './contracts.service';
import { RequestContextService } from '@common/context/request-context.service';

describe('ContractsService.createFromQuotation ubicación del cliente (S4)', () => {
  const context = { store_id: 12, organization_id: 34, user_id: 56 };

  it('copia customer_address_id y snapshot de la cotización al contrato', async () => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue(context as any);
    const snapshot = { label: 'Sede Norte', address_line1: 'Calle 1 # 2-3' };
    const quotation: any = {
      id: 7,
      destination: 'contract',
      status: 'accepted',
      customer_id: 3,
      subtotal_amount: '100',
      discount_amount: '0',
      tax_amount: '0',
      grand_total: '100',
      contract_economic_snapshot: null,
      quotation_items: [],
      customer_address_id: 31,
      customer_address_snapshot: snapshot,
    };
    const tx: any = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      quotations: {
        findFirst: jest.fn().mockResolvedValue(quotation),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      contracts: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockResolvedValue({ id: 99, status: 'draft', invoices: [] }),
      },
    };
    const prisma: any = {
      quotations: { findFirst: jest.fn().mockResolvedValue(quotation) },
      contracts: { findFirst: jest.fn().mockResolvedValue(null) },
      withoutScope: () => ({ $transaction: (cb: any) => cb(tx) }),
    };

    await new ContractsService(prisma).createFromQuotation(7);

    const data = tx.contracts.create.mock.calls[0][0].data;
    expect(data.customer_address_id).toBe(31);
    expect(data.customer_address_snapshot).toEqual(snapshot);
  });
});
