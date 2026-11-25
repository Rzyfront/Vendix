import { BankAccountsService } from './bank-accounts.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { ErrorCodes } from '../../../../common/errors';

describe('Accounting BankAccountsService (QUI-1061)', () => {
  let service: BankAccountsService;
  let prisma: any;
  let fiscalScopeService: any;

  const setContext = (ctx: Record<string, any>) => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue(ctx as any);
  };

  beforeEach(() => {
    prisma = {
      stores: { findMany: jest.fn() },
      chart_of_accounts: { findFirst: jest.fn() },
      bank_accounts: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      bank_account_stores: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      bank_transactions: {
        aggregate: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    fiscalScopeService = {
      getFiscalScope: jest.fn().mockResolvedValue('STORE'),
    };
    service = new BankAccountsService(prisma, fiscalScopeService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Scope STORE', () => {
    it('creates store-owned account and checks uniqueness only within the current store', async () => {
      setContext({ store_id: 20, organization_id: 1, roles: ['store_admin'] });
      prisma.bank_accounts.findFirst.mockResolvedValue(null);
      prisma.bank_accounts.create.mockResolvedValue({
        id: 2,
        name: 'Bancolombia Sucursal B',
        account_number: '111-222',
        bank_name: 'Bancolombia',
        store_id: 20,
        available_in_all_stores: true,
        store_assignments: [],
      });

      const created = await service.create({
        name: 'Bancolombia Sucursal B',
        account_number: '111-222',
        bank_name: 'Bancolombia',
      });

      expect(created.store_id).toBe(20);
      expect(prisma.bank_accounts.findFirst).toHaveBeenCalledWith({
        where: {
          organization_id: 1,
          store_id: 20,
          account_number: '111-222',
        },
        select: { id: true },
      });
    });

    it('rejects duplicate account_number inside the same store with BANK_ACCOUNT_DUPLICATE', async () => {
      setContext({ store_id: 10, organization_id: 1, roles: ['store_admin'] });
      prisma.bank_accounts.findFirst.mockResolvedValue({ id: 1 });

      await expect(
        service.create({
          name: 'Repetida',
          account_number: '111-222',
          bank_name: 'Bancolombia',
        }),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.BANK_ACCOUNT_DUPLICATE.code,
      });
    });

    it('findAll isolates Store B from Store A accounts even when search filter is active', async () => {
      setContext({ store_id: 20, organization_id: 1, is_owner: true });
      prisma.bank_accounts.findMany.mockResolvedValue([]);

      await service.findAll({ search: 'Bancolombia' });

      expect(prisma.bank_accounts.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              {
                organization_id: 1,
                OR: [
                  { store_id: 20 },
                  { store_id: null, available_in_all_stores: true },
                  {
                    store_id: null,
                    store_assignments: { some: { store_id: 20 } },
                  },
                ],
              },
              {
                OR: [
                  { name: { contains: 'Bancolombia', mode: 'insensitive' } },
                  {
                    account_number: {
                      contains: 'Bancolombia',
                      mode: 'insensitive',
                    },
                  },
                  {
                    bank_name: { contains: 'Bancolombia', mode: 'insensitive' },
                  },
                ],
              },
            ],
          },
        }),
      );
    });
  });

  describe('Scope ORGANIZATION', () => {
    beforeEach(() => {
      fiscalScopeService.getFiscalScope.mockResolvedValue('ORGANIZATION');
    });

    it('blocks non-org store admin from creating accounts in scope ORGANIZATION', async () => {
      setContext({
        store_id: 10,
        organization_id: 1,
        is_owner: false,
        roles: ['store_admin'],
      });

      await expect(
        service.create({
          name: 'Cuenta Principal',
          account_number: '555-000',
          bank_name: 'Bancolombia',
        }),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.BANK_ACCOUNT_ORG_MANAGED.code,
      });
    });

    it('creates org account assigned to specific stores only', async () => {
      setContext({ store_id: 10, organization_id: 1, is_owner: true });
      prisma.stores.findMany.mockResolvedValue([{ id: 10 }]);
      prisma.bank_accounts.findFirst.mockResolvedValue(null);
      prisma.bank_accounts.create.mockResolvedValue({
        id: 50,
        name: 'Solo Sucursal A',
        account_number: '555-111',
        bank_name: 'Davivienda',
        store_id: null,
        available_in_all_stores: false,
        store_assignments: [{ store_id: 10, store: { id: 10, name: 'A' } }],
      });

      const created = await service.create({
        name: 'Solo Sucursal A',
        account_number: '555-111',
        bank_name: 'Davivienda',
        available_in_all_stores: false,
        store_ids: [10],
      });

      expect(created.store_id).toBeNull();
      expect(created.assigned_store_ids).toEqual([10]);
      expect(prisma.bank_accounts.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            store_id: null,
            available_in_all_stores: false,
            store_assignments: {
              create: [{ store_id: 10, organization_id: 1 }],
            },
          }),
        }),
      );
    });

    it('rejects org account with available_in_all_stores=false when store_ids is empty or outside org', async () => {
      setContext({ store_id: 10, organization_id: 1, is_owner: true });

      await expect(
        service.create({
          name: 'Sin Tiendas',
          account_number: '555-222',
          bank_name: 'Davivienda',
          available_in_all_stores: false,
          store_ids: [],
        }),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.BANK_ACCOUNT_INVALID_ASSIGNMENT.code,
      });

      prisma.stores.findMany.mockResolvedValue([]);
      await expect(
        service.create({
          name: 'Tienda Ajena',
          account_number: '555-333',
          bank_name: 'Davivienda',
          available_in_all_stores: false,
          store_ids: [999],
        }),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.BANK_ACCOUNT_INVALID_ASSIGNMENT.code,
      });
    });

    it('rejects duplicate org-level account_number with BANK_ACCOUNT_DUPLICATE', async () => {
      setContext({ store_id: 10, organization_id: 1, is_owner: true });
      prisma.bank_accounts.findFirst.mockResolvedValue({ id: 50 });

      await expect(
        service.create({
          name: 'Repetida Org',
          account_number: '555-111',
          bank_name: 'Davivienda',
        }),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.BANK_ACCOUNT_DUPLICATE.code,
      });
    });

    it('shows only assigned accounts to store admin, while org admin sees all org accounts', async () => {
      prisma.bank_accounts.findMany.mockResolvedValue([]);

      setContext({
        store_id: 20,
        organization_id: 1,
        is_owner: false,
        roles: ['store_admin'],
      });
      await service.findAll({});
      expect(prisma.bank_accounts.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              {
                organization_id: 1,
                OR: [
                  { store_id: 20 },
                  { store_id: null, available_in_all_stores: true },
                  {
                    store_id: null,
                    store_assignments: { some: { store_id: 20 } },
                  },
                ],
              },
            ],
          },
        }),
      );

      setContext({ store_id: 20, organization_id: 1, is_owner: true });
      await service.findAll({});
      expect(prisma.bank_accounts.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: {
            AND: [{ organization_id: 1 }],
          },
        }),
      );
    });

    it('getScopeContext returns active org stores and non-blocking duplicate_number_warnings after STORE->ORG transition', async () => {
      setContext({ store_id: 10, organization_id: 1, is_owner: true });
      prisma.stores.findMany.mockResolvedValue([
        { id: 10, name: 'Sucursal A', store_code: 'A', is_active: true },
        { id: 20, name: 'Sucursal B', store_code: 'B', is_active: true },
      ]);
      prisma.bank_accounts.findMany.mockResolvedValue([
        {
          id: 1,
          name: 'Cuenta A',
          bank_name: 'Bancolombia',
          account_number: '12345',
          store_id: 10,
          status: 'active',
          store: { id: 10, name: 'Sucursal A' },
        },
        {
          id: 2,
          name: 'Cuenta B',
          bank_name: 'Bancolombia',
          account_number: '12345',
          store_id: 20,
          status: 'active',
          store: { id: 20, name: 'Sucursal B' },
        },
      ]);

      const ctx = await service.getScopeContext();

      expect(ctx.fiscal_scope).toBe('ORGANIZATION');
      expect(ctx.can_manage_accounts).toBe(true);
      expect(ctx.stores).toHaveLength(2);
      expect(ctx.duplicate_number_warnings).toHaveLength(1);
      expect(ctx.duplicate_number_warnings[0].account_number).toBe('12345');
      expect(ctx.duplicate_number_warnings[0].accounts).toHaveLength(2);
    });

    it('updates org account assignment from specific stores to all stores and clears bank_account_stores', async () => {
      setContext({ store_id: 10, organization_id: 1, is_owner: true });
      const existing = {
        id: 50,
        name: 'Cuenta Org',
        account_number: '555-111',
        bank_name: 'Davivienda',
        store_id: null,
        available_in_all_stores: false,
        store_assignments: [{ store_id: 10, store: { id: 10, name: 'A' } }],
      };
      prisma.bank_accounts.findFirst
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce({
          ...existing,
          available_in_all_stores: true,
          store_assignments: [],
        });
      prisma.bank_accounts.update.mockResolvedValue({
        ...existing,
        available_in_all_stores: true,
        store_assignments: [],
      });

      const updated = await service.update(50, {
        available_in_all_stores: true,
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.bank_account_stores.deleteMany).toHaveBeenCalledWith({
        where: { bank_account_id: 50 },
      });
      expect(updated.available_in_all_stores).toBe(true);
      expect(updated.assigned_store_ids).toEqual([]);
    });

    it('rejects store_ids when available_in_all_stores is true or omitted on update and create', async () => {
      setContext({ store_id: 10, organization_id: 1, is_owner: true });

      await expect(
        service.create({
          name: 'Ambigua',
          account_number: '555-999',
          bank_name: 'Bancolombia',
          store_ids: [10],
        }),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.BANK_ACCOUNT_INVALID_ASSIGNMENT.code,
      });

      const existing = {
        id: 50,
        name: 'Cuenta Org',
        account_number: '555-111',
        bank_name: 'Davivienda',
        store_id: null,
        available_in_all_stores: true,
        store_assignments: [],
      };
      prisma.bank_accounts.findFirst.mockResolvedValueOnce(existing);

      await expect(
        service.update(50, { store_ids: [10, 20] }),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.BANK_ACCOUNT_INVALID_ASSIGNMENT.code,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('allows org admin to close an inherited store account from another branch after STORE->ORGANIZATION transition', async () => {
      setContext({ store_id: 10, organization_id: 1, is_owner: true });
      prisma.bank_accounts.findFirst.mockResolvedValue({
        id: 77,
        name: 'Cuenta Heredada Sucursal B',
        account_number: '12345',
        bank_name: 'Bancolombia',
        store_id: 20,
        available_in_all_stores: true,
        store_assignments: [],
      });
      prisma.bank_accounts.update.mockResolvedValue({ id: 77, status: 'closed' });

      await service.remove(77);

      expect(prisma.bank_accounts.update).toHaveBeenCalledWith({
        where: { id: 77 },
        data: { status: 'closed' },
      });
    });
  });
});
