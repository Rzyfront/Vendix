import { ForbiddenException } from '@nestjs/common';
import { BankAccountsService } from './bank-accounts.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';

describe('Payments BankAccountsService (QUI-1061)', () => {
  let service: BankAccountsService;
  let prisma: any;
  let s3Service: any;
  let fiscalScopeService: any;

  const setContext = (ctx: Record<string, any>) => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue(ctx as any);
  };

  beforeEach(() => {
    prisma = {
      stores: { findUnique: jest.fn() },
      bank_accounts: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    s3Service = {
      getPresignedUrl: jest.fn().mockResolvedValue('https://signed.example/img.png'),
    };
    fiscalScopeService = {
      getFiscalScope: jest.fn().mockResolvedValue('STORE'),
    };
    service = new BankAccountsService(prisma, s3Service, fiscalScopeService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Scope STORE (4 acceptance criteria of QUI-1061)', () => {
    it('allows Store B to register account N even when Store A already uses account N', async () => {
      setContext({ store_id: 20, organization_id: 1, roles: ['store_admin'] });
      prisma.stores.findUnique.mockResolvedValue({ organization_id: 1 });
      // Store A has account N, so bankAccountAvailableInStoreWhere(20, 1) returns []
      prisma.bank_accounts.findMany.mockResolvedValue([]);
      prisma.bank_accounts.create.mockResolvedValue({
        id: 202,
        name: 'Bancolombia Tienda B',
        bank_name: 'Bancolombia',
        account_number: '123456789',
        image_s3_key: null,
      });

      const created = await service.create({
        name: 'Bancolombia Tienda B',
        bank_name: 'Bancolombia',
        account_number: '123456789',
      });

      expect(created.id).toBe(202);
      expect(prisma.bank_accounts.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organization_id: 1,
            account_number: '123456789',
            OR: [
              { store_id: 20 },
              { store_id: null, available_in_all_stores: true },
              { store_id: null, store_assignments: { some: { store_id: 20 } } },
            ],
          }),
        }),
      );
      expect(prisma.bank_accounts.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organization_id: 1,
            store_id: 20,
            account_number: '123456789',
          }),
        }),
      );
    });

    it('reuses existing active account idempotently when repeated in the same store', async () => {
      setContext({ store_id: 10, organization_id: 1, roles: ['store_admin'] });
      prisma.stores.findUnique.mockResolvedValue({ organization_id: 1 });
      prisma.bank_accounts.findMany.mockResolvedValue([
        {
          id: 101,
          name: 'Bancolombia Tienda A',
          bank_name: 'Bancolombia',
          account_number: '123456789',
          status: 'active',
          store_id: 10,
          image_s3_key: null,
        },
      ]);

      const result = await service.create({
        name: 'Bancolombia Tienda A',
        bank_name: 'Bancolombia',
        account_number: '123456789',
      });

      expect(result.id).toBe(101);
      expect(prisma.bank_accounts.create).not.toHaveBeenCalled();
    });

    it('reactivates closed account when re-registered in the same store', async () => {
      setContext({ store_id: 10, organization_id: 1, roles: ['store_admin'] });
      prisma.stores.findUnique.mockResolvedValue({ organization_id: 1 });
      prisma.bank_accounts.findMany.mockResolvedValue([
        {
          id: 101,
          name: 'Bancolombia Tienda A',
          bank_name: 'Bancolombia',
          account_number: '123456789',
          status: 'closed',
          store_id: 10,
          image_s3_key: null,
        },
      ]);
      prisma.bank_accounts.update.mockResolvedValue({
        id: 101,
        name: 'Bancolombia Tienda A',
        bank_name: 'Bancolombia',
        account_number: '123456789',
        image_s3_key: null,
      });

      const result = await service.create({
        name: 'Bancolombia Tienda A',
        bank_name: 'Bancolombia',
        account_number: '123456789',
      });

      expect(result.id).toBe(101);
      expect(prisma.bank_accounts.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 101 },
          data: expect.objectContaining({ status: 'active' }),
        }),
      );
    });

    it('listForStore filters strictly to accounts available in the current store (Store A accounts never appear in Store B)', async () => {
      setContext({ store_id: 20, organization_id: 1 });
      prisma.stores.findUnique.mockResolvedValue({ organization_id: 1 });
      prisma.bank_accounts.findMany.mockResolvedValue([
        {
          id: 202,
          name: 'Cuenta B',
          bank_name: 'Bancolombia',
          account_number: '123456789',
          image_s3_key: null,
        },
      ]);

      const list = await service.listForStore();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(202);
      expect(prisma.bank_accounts.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organization_id: 1,
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

    it('rejects update when new account_number duplicates another account in the same store', async () => {
      setContext({ store_id: 10, organization_id: 1, roles: ['store_admin'] });
      prisma.stores.findUnique.mockResolvedValue({ organization_id: 1 });
      prisma.bank_accounts.findFirst
        .mockResolvedValueOnce({
          id: 101,
          organization_id: 1,
          store_id: 10,
          available_in_all_stores: true,
          store_assignments: [],
        })
        .mockResolvedValueOnce({ id: 105 });

      await expect(
        service.update(101, { account_number: '999999' }),
      ).rejects.toThrow(VendixHttpException);
    });
  });

  describe('Scope ORGANIZATION', () => {
    beforeEach(() => {
      fiscalScopeService.getFiscalScope.mockResolvedValue('ORGANIZATION');
    });

    it('allows org owner to create an organization-owned account (store_id=null)', async () => {
      setContext({ store_id: 10, organization_id: 1, is_owner: true });
      prisma.stores.findUnique.mockResolvedValue({ organization_id: 1 });
      prisma.bank_accounts.findMany.mockResolvedValue([]);
      prisma.bank_accounts.findFirst.mockResolvedValue(null);
      prisma.bank_accounts.create.mockResolvedValue({
        id: 301,
        name: 'Cuenta Matriz',
        bank_name: 'Davivienda',
        account_number: '777888',
        image_s3_key: null,
      });

      const created = await service.create({
        name: 'Cuenta Matriz',
        bank_name: 'Davivienda',
        account_number: '777888',
      });

      expect(created.id).toBe(301);
      expect(prisma.bank_accounts.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organization_id: 1,
            store_id: null,
          }),
        }),
      );
    });

    it('blocks non-org store admin from creating an org account without revealing unassigned org accounts', async () => {
      setContext({
        store_id: 10,
        organization_id: 1,
        is_owner: false,
        is_super_admin: false,
        app_type: 'STORE_ADMIN',
        roles: ['store_admin'],
      });
      prisma.stores.findUnique.mockResolvedValue({ organization_id: 1 });
      prisma.bank_accounts.findMany.mockResolvedValue([]);
      // Even if an unassigned org account with the same number exists, store admin
      // must receive BANK_ACCOUNT_ORG_MANAGED (403), never NOT_ASSIGNED_TO_STORE (409).
      prisma.bank_accounts.findFirst.mockResolvedValue({ id: 301 });

      await expect(
        service.create({
          name: 'Cuenta Nueva',
          bank_name: 'Davivienda',
          account_number: '777888',
        }),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.BANK_ACCOUNT_ORG_MANAGED.code,
      });
      expect(prisma.bank_accounts.findFirst).not.toHaveBeenCalled();
    });

    it('returns BANK_ACCOUNT_NOT_ASSIGNED_TO_STORE when org account exists but is not assigned to current store', async () => {
      setContext({ store_id: 20, organization_id: 1, is_owner: true });
      prisma.stores.findUnique.mockResolvedValue({ organization_id: 1 });
      prisma.bank_accounts.findMany.mockResolvedValue([]);
      prisma.bank_accounts.findFirst.mockResolvedValue({ id: 301 });

      await expect(
        service.create({
          name: 'Cuenta Matriz',
          bank_name: 'Davivienda',
          account_number: '777888',
        }),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.BANK_ACCOUNT_NOT_ASSIGNED_TO_STORE.code,
      });
    });

    it('blocks non-org store admin from closing an org account assigned to their store', async () => {
      setContext({
        store_id: 10,
        organization_id: 1,
        is_owner: false,
        roles: ['store_admin'],
      });
      prisma.stores.findUnique.mockResolvedValue({ organization_id: 1 });
      prisma.bank_accounts.findFirst.mockResolvedValue({
        id: 301,
        organization_id: 1,
        store_id: null,
        available_in_all_stores: true,
        store_assignments: [],
      });

      await expect(service.close(301)).rejects.toMatchObject({
        errorCode: ErrorCodes.BANK_ACCOUNT_ORG_MANAGED.code,
      });
    });
  });

  describe('Cross-organization isolation', () => {
    it('forbids modifying an account belonging to another organization', async () => {
      setContext({ store_id: 10, organization_id: 1, is_owner: true });
      prisma.stores.findUnique.mockResolvedValue({ organization_id: 1 });
      prisma.bank_accounts.findFirst.mockResolvedValue({
        id: 999,
        organization_id: 2,
        store_id: null,
        available_in_all_stores: true,
        store_assignments: [],
      });

      await expect(service.close(999)).rejects.toThrow(ForbiddenException);
    });
  });
});
