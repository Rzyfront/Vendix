import { BankTransactionsService } from './bank-transactions.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { ErrorCodes } from '../../../../common/errors';

describe('BankTransactionsService — origin store_id tracking & filtering (QUI-1061)', () => {
  let service: BankTransactionsService;
  let prisma: any;
  let bankAccountsService: any;
  let parserFactory: any;

  beforeEach(() => {
    prisma = {
      bank_transactions: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        createMany: jest.fn(),
        delete: jest.fn(),
      },
    };
    bankAccountsService = {
      findOne: jest.fn(),
      updateBalance: jest.fn(),
    };
    parserFactory = {
      parse: jest.fn(),
    };
    service = new BankTransactionsService(
      prisma,
      bankAccountsService,
      parserFactory,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stores context store_id on imported bank_transactions for branch filtering', async () => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 20, organization_id: 1 } as any);
    bankAccountsService.findOne.mockResolvedValue({
      id: 50,
      store_id: null,
      column_mapping: null,
    });
    parserFactory.parse.mockResolvedValue({
      transactions: [
        {
          date: new Date('2026-11-20'),
          description: 'Transferencia cliente',
          amount: 100000,
          type: 'credit',
          reference: 'REF-1',
          external_id: 'EXT-1',
        },
      ],
      errors: [],
    });
    prisma.bank_transactions.createMany.mockResolvedValue({ count: 1 });

    await service.importStatement(50, Buffer.from('csv'), 'extracto.csv');

    expect(prisma.bank_transactions.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            bank_account_id: 50,
            store_id: 20,
          }),
        ],
      }),
    );
  });

  it('findAll validates account visibility and filters by optional store_id', async () => {
    bankAccountsService.findOne.mockResolvedValue({ id: 50, store_id: null });
    prisma.bank_transactions.findMany.mockResolvedValue([]);
    prisma.bank_transactions.count.mockResolvedValue(0);

    await service.findAll({ bank_account_id: 50, store_id: 10 });

    expect(bankAccountsService.findOne).toHaveBeenCalledWith(50);
    expect(prisma.bank_transactions.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          bank_account_id: 50,
          store_id: 10,
        }),
      }),
    );
  });

  it('blocks importStatement and remove when account is read-only (can_edit=false) for store admin in scope ORGANIZATION', async () => {
    bankAccountsService.findOne.mockResolvedValue({
      id: 50,
      store_id: null,
      can_edit: false,
      column_mapping: null,
    });

    await expect(
      service.importStatement(50, Buffer.from('csv'), 'extracto.csv'),
    ).rejects.toMatchObject({
      errorCode: ErrorCodes.BANK_ACCOUNT_ORG_MANAGED.code,
    });
    expect(parserFactory.parse).not.toHaveBeenCalled();

    prisma.bank_transactions.findFirst.mockResolvedValue({
      id: 901,
      bank_account_id: 50,
      is_reconciled: false,
    });

    await expect(service.remove(901)).rejects.toMatchObject({
      errorCode: ErrorCodes.BANK_ACCOUNT_ORG_MANAGED.code,
    });
    expect(prisma.bank_transactions.delete).not.toHaveBeenCalled();
  });
});
