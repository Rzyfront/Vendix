import { PaymentsService } from './payments.service';
import { RequestContextService } from '@common/context/request-context.service';

describe('PaymentsService.getStorePaymentMethods bank account filtering (QUI-1061)', () => {
  let service: PaymentsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      store_payment_methods: {
        findMany: jest.fn(),
      },
      bank_accounts: {
        findMany: jest.fn(),
      },
      stores: {
        findUnique: jest.fn(),
      },
    };
    service = Object.create(PaymentsService.prototype);
    (service as any).prisma = prisma;
    (service as any).validateUserAccess = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('filters bank_transfer custom_config.accounts against store availability and active status while preserving legacy entries', async () => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 20, organization_id: 1 } as any);

    prisma.store_payment_methods.findMany.mockResolvedValue([
      {
        id: 1,
        store_id: 20,
        display_name: 'Efectivo',
        custom_config: null,
        system_payment_method: { id: 1, type: 'cash' },
      },
      {
        id: 2,
        store_id: 20,
        display_name: 'Transferencia',
        custom_config: {
          accounts: [
            { id: 10, bank_name: 'Bancolombia', account_number: '111' },
            { id: 20, bank_name: 'Solo Sucursal A', account_number: '222' },
            { bank_name: 'Legacy', account_number: '333', legacy: true },
          ],
        },
        system_payment_method: { id: 2, type: 'bank_transfer' },
      },
    ]);
    prisma.bank_accounts.findMany.mockResolvedValue([{ id: 10 }]);

    const methods = await service.getStorePaymentMethods(20, {
      id: 1,
      organization_id: 1,
    });

    expect(prisma.bank_accounts.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [10, 20] },
        organization_id: 1,
        status: 'active',
        OR: [
          { store_id: 20 },
          { store_id: null, available_in_all_stores: true },
          { store_id: null, store_assignments: { some: { store_id: 20 } } },
        ],
      },
      select: { id: true },
    });
    expect(methods[0].custom_config).toBeNull();
    expect((methods[1].custom_config as any).accounts).toEqual([
      { id: 10, bank_name: 'Bancolombia', account_number: '111' },
      { bank_name: 'Legacy', account_number: '333', legacy: true },
    ]);
  });

  it('skips bank_accounts query when store has no bank_transfer account ids', async () => {
    prisma.store_payment_methods.findMany.mockResolvedValue([
      {
        id: 1,
        store_id: 20,
        display_name: 'Efectivo',
        custom_config: null,
        system_payment_method: { id: 1, type: 'cash' },
      },
    ]);

    const methods = await service.getStorePaymentMethods(20, {
      id: 1,
      organization_id: 1,
    });

    expect(methods).toHaveLength(1);
    expect(prisma.bank_accounts.findMany).not.toHaveBeenCalled();
  });
});
