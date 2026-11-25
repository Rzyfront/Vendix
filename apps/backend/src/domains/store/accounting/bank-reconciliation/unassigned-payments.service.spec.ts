import { UnassignedPaymentsService } from './unassigned-payments.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { ErrorCodes } from '../../../../common/errors';

describe('UnassignedPaymentsService — bank account availability (QUI-1061)', () => {
  let service: UnassignedPaymentsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      bank_accounts: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      payments: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        aggregate: jest.fn(),
      },
    };
    service = new UnassignedPaymentsService(prisma);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('findAssignableAccounts filters by current store availability predicate', async () => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 20, organization_id: 1 } as any);
    prisma.bank_accounts.findMany.mockResolvedValue([]);

    await service.findAssignableAccounts();

    expect(prisma.bank_accounts.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'active',
          OR: [
            { store_id: 20 },
            { store_id: null, available_in_all_stores: true },
            { store_id: null, store_assignments: { some: { store_id: 20 } } },
          ],
        },
      }),
    );
  });

  it('assignAccount rejects org account not assigned to the payment store', async () => {
    prisma.payments.findFirst.mockResolvedValue({
      id: 100,
      bank_account_id: null,
      store_payment_method: {
        system_payment_method: { type: 'bank_transfer' },
      },
      orders: { store_id: 20, order_number: 'ORD-1', customer_alias: null },
    });
    prisma.bank_accounts.findFirst.mockResolvedValue({
      id: 50,
      organization_id: 1,
      store_id: null,
      available_in_all_stores: false,
      store_assignments: [{ store_id: 10 }],
    });

    await expect(service.assignAccount(100, 50)).rejects.toMatchObject({
      errorCode: ErrorCodes.SYS_FORBIDDEN_001.code,
    });
  });

  it('assignAccount allows org account assigned to the payment store', async () => {
    prisma.payments.findFirst.mockResolvedValue({
      id: 100,
      order_id: 1,
      amount: 50000,
      currency: 'COP',
      gateway_reference: null,
      paid_at: new Date(),
      created_at: new Date(),
      bank_account_id: null,
      store_payment_method: {
        display_name: 'Transferencia',
        system_payment_method: {
          name: 'Transfer',
          display_name: 'Transferencia',
          type: 'bank_transfer',
        },
      },
      orders: { store_id: 10, order_number: 'ORD-1', customer_alias: null },
    });
    prisma.bank_accounts.findFirst.mockResolvedValue({
      id: 50,
      organization_id: 1,
      store_id: null,
      available_in_all_stores: false,
      store_assignments: [{ store_id: 10 }],
    });
    prisma.payments.updateMany.mockResolvedValue({ count: 1 });
    prisma.payments.aggregate.mockResolvedValue({ _sum: { amount: 0 } });

    const result = await service.assignAccount(100, 50);
    expect(result.payment.payment_id).toBe(100);
    expect(prisma.payments.updateMany).toHaveBeenCalledWith({
      where: { id: 100, bank_account_id: null },
      data: { bank_account_id: 50 },
    });
  });
});
