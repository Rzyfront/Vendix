import { ReconciliationService } from './reconciliation.service';
import { ReconciliationMatchingService } from './reconciliation-matching.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { ErrorCodes } from '../../../../common/errors';

describe('ReconciliationService & ReconciliationMatchingService isolation (QUI-1061)', () => {
  let reconciliationService: ReconciliationService;
  let matchingService: ReconciliationMatchingService;
  let prisma: any;
  let bankAccountsService: any;
  let fiscalScopeService: any;

  const setContext = (ctx: Record<string, any>) => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue(ctx as any);
  };

  beforeEach(() => {
    prisma = {
      bank_reconciliations: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      bank_transactions: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn(),
      },
      bank_reconciliation_matches: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      accounting_entries: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    bankAccountsService = {
      findOne: jest.fn(),
    };
    fiscalScopeService = {
      getFiscalScope: jest.fn().mockResolvedValue('STORE'),
    };
    reconciliationService = new ReconciliationService(
      prisma,
      bankAccountsService,
      fiscalScopeService,
    );
    matchingService = new ReconciliationMatchingService(
      prisma,
      reconciliationService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fails closed when organization_id is missing (never omits bank_account filter)', async () => {
    setContext({ store_id: 10 });

    await expect(reconciliationService.findAll({})).rejects.toMatchObject({
      errorCode: ErrorCodes.ORG_CONTEXT_001.code,
    });
    expect(prisma.bank_reconciliations.findMany).not.toHaveBeenCalled();
  });

  it('fails closed with store_id=0 when store_id is omitted in scope STORE', async () => {
    setContext({ organization_id: 1, roles: ['store_admin'] });
    prisma.bank_reconciliations.findMany.mockResolvedValue([]);

    await reconciliationService.findAll({});

    expect(prisma.bank_reconciliations.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          bank_account: {
            organization_id: 1,
            OR: [
              { store_id: 0 },
              { store_id: null, available_in_all_stores: true },
              { store_id: null, store_assignments: { some: { store_id: 0 } } },
            ],
          },
        }),
      }),
    );
  });

  it('blocks Store B from autoMatch, manualMatch, and unmatch on Store A reconciliation', async () => {
    setContext({ store_id: 20, organization_id: 1, roles: ['store_admin'] });
    // Store B visibility predicate does not match Store A's reconciliation -> null
    prisma.bank_reconciliations.findFirst.mockResolvedValue(null);

    await expect(matchingService.autoMatch(99)).rejects.toMatchObject({
      errorCode: ErrorCodes.BANK_RECONCILIATION_NOT_FOUND.code,
    });
    await expect(
      matchingService.manualMatch(99, { bank_transaction_id: 500 }),
    ).rejects.toMatchObject({
      errorCode: ErrorCodes.BANK_RECONCILIATION_NOT_FOUND.code,
    });
    await expect(matchingService.unmatch(99, 10)).rejects.toMatchObject({
      errorCode: ErrorCodes.BANK_RECONCILIATION_NOT_FOUND.code,
    });

    for (const call of prisma.bank_reconciliations.findFirst.mock.calls) {
      expect(call[0].where).toEqual({
        id: 99,
        bank_account: {
          organization_id: 1,
          OR: [
            { store_id: 20 },
            { store_id: null, available_in_all_stores: true },
            { store_id: null, store_assignments: { some: { store_id: 20 } } },
          ],
        },
      });
    }
  });

  it('manualMatch requires transaction to belong to the reconciliation bank_account_id', async () => {
    setContext({ store_id: 10, organization_id: 1, roles: ['store_admin'] });
    prisma.bank_reconciliations.findFirst.mockResolvedValue({
      id: 15,
      bank_account_id: 100,
      status: 'in_progress',
      bank_account: { id: 100, store_id: 10, chart_account_id: 5 },
    });
    prisma.bank_transactions.findFirst.mockResolvedValue(null);

    await expect(
      matchingService.manualMatch(15, { bank_transaction_id: 888 }),
    ).rejects.toMatchObject({
      errorCode: ErrorCodes.BANK_TRANSACTION_NOT_FOUND.code,
    });

    expect(prisma.bank_transactions.findFirst).toHaveBeenCalledWith({
      where: {
        id: 888,
        bank_account_id: 100,
      },
    });
  });

  it('blocks non-org store admin from creating, completing, removing, or matching reconciliations of org accounts in scope ORGANIZATION', async () => {
    fiscalScopeService.getFiscalScope.mockResolvedValue('ORGANIZATION');
    setContext({
      store_id: 20,
      organization_id: 1,
      is_owner: false,
      roles: ['store_admin'],
    });

    bankAccountsService.findOne.mockResolvedValue({
      id: 50,
      store_id: null,
      opening_balance: 0,
      can_edit: false,
    });

    await expect(
      reconciliationService.create({
        bank_account_id: 50,
        period_start: '2026-11-01',
        period_end: '2026-11-30',
        statement_balance: 1000,
      }),
    ).rejects.toMatchObject({
      errorCode: ErrorCodes.BANK_ACCOUNT_ORG_MANAGED.code,
    });

    prisma.bank_reconciliations.findFirst.mockResolvedValue({
      id: 70,
      bank_account_id: 50,
      status: 'in_progress',
      difference: 0,
      bank_account: { id: 50, store_id: null, chart_account_id: 5 },
    });

    await expect(reconciliationService.complete(70)).rejects.toMatchObject({
      errorCode: ErrorCodes.BANK_ACCOUNT_ORG_MANAGED.code,
    });
    await expect(reconciliationService.remove(70)).rejects.toMatchObject({
      errorCode: ErrorCodes.BANK_ACCOUNT_ORG_MANAGED.code,
    });
    await expect(matchingService.autoMatch(70)).rejects.toMatchObject({
      errorCode: ErrorCodes.BANK_ACCOUNT_ORG_MANAGED.code,
    });
    await expect(matchingService.unmatch(70, 1)).rejects.toMatchObject({
      errorCode: ErrorCodes.BANK_ACCOUNT_ORG_MANAGED.code,
    });
  });

  it('recalculateBalance enforces bank_account visibility filter', async () => {
    setContext({ store_id: 20, organization_id: 1, roles: ['store_admin'] });
    prisma.bank_reconciliations.findFirst.mockResolvedValue(null);

    await expect(
      reconciliationService.recalculateBalance(99),
    ).rejects.toMatchObject({
      errorCode: ErrorCodes.BANK_RECONCILIATION_NOT_FOUND.code,
    });

    expect(prisma.bank_reconciliations.findFirst).toHaveBeenCalledWith({
      where: {
        id: 99,
        bank_account: {
          organization_id: 1,
          OR: [
            { store_id: 20 },
            { store_id: null, available_in_all_stores: true },
            { store_id: null, store_assignments: { some: { store_id: 20 } } },
          ],
        },
      },
    });
  });
});
