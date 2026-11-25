import {
  bankAccountAvailableInStoreWhere,
  buildDuplicateBankAccountWarnings,
  canManageOrganizationBankAccounts,
  canModifyBankAccount,
  canViewAllOrganizationBankAccounts,
  collectBankTransferAccountIds,
  extractBankTransferAccountEntryId,
  filterBankTransferConfigAccounts,
  isBankAccountAvailableInStore,
  resolveBankAccountPolicy,
} from './bank-account-availability.helper';
import { RequestContext } from '../context/request-context.service';

type PolicyContext = Pick<
  RequestContext,
  'is_super_admin' | 'is_owner' | 'roles' | 'app_type'
>;

const ctx = (overrides: Partial<PolicyContext>): PolicyContext => ({
  is_super_admin: false,
  is_owner: false,
  ...overrides,
});

describe('bank-account-availability.helper (QUI-1061)', () => {
  describe('bankAccountAvailableInStoreWhere', () => {
    it('builds the canonical predicate covering own store, org all-stores, and org explicit store assignment', () => {
      const where = bankAccountAvailableInStoreWhere(10, 1);

      expect(where).toEqual({
        organization_id: 1,
        OR: [
          { store_id: 10 },
          { store_id: null, available_in_all_stores: true },
          { store_id: null, store_assignments: { some: { store_id: 10 } } },
        ],
      });
    });

    it('omits organization_id when not provided', () => {
      const where = bankAccountAvailableInStoreWhere(10);
      expect(where).not.toHaveProperty('organization_id');
      expect(where.OR).toHaveLength(3);
    });
  });

  describe('isBankAccountAvailableInStore', () => {
    it('allows own store account and blocks another store account in the same organization', () => {
      const storeAAccount = { organization_id: 1, store_id: 10 };
      expect(isBankAccountAvailableInStore(storeAAccount, 10, 1)).toBe(true);
      expect(isBankAccountAvailableInStore(storeAAccount, 20, 1)).toBe(false);
    });

    it('allows org-level account with available_in_all_stores=true (or omitted) in all stores of same org', () => {
      const orgAll = {
        organization_id: 1,
        store_id: null,
        available_in_all_stores: true,
      };
      const orgLegacy = { organization_id: 1, store_id: null };

      expect(isBankAccountAvailableInStore(orgAll, 10, 1)).toBe(true);
      expect(isBankAccountAvailableInStore(orgAll, 20, 1)).toBe(true);
      expect(isBankAccountAvailableInStore(orgLegacy, 20, 1)).toBe(true);
    });

    it('restricts org-level account with available_in_all_stores=false to assigned stores only', () => {
      const orgOnlyA = {
        organization_id: 1,
        store_id: null,
        available_in_all_stores: false,
        store_assignments: [{ store_id: 10 }],
      };

      expect(isBankAccountAvailableInStore(orgOnlyA, 10, 1)).toBe(true);
      expect(isBankAccountAvailableInStore(orgOnlyA, 20, 1)).toBe(false);
    });

    it('isolates organizations even for org-level accounts available in all stores', () => {
      const otherOrgAll = {
        organization_id: 2,
        store_id: null,
        available_in_all_stores: true,
      };

      expect(isBankAccountAvailableInStore(otherOrgAll, 10, 1)).toBe(false);
    });
  });

  describe('policy & permissions', () => {
    it('recognizes owner, super_admin, ORG_ADMIN and admin role as org managers', () => {
      expect(canManageOrganizationBankAccounts(ctx({ is_owner: true }))).toBe(
        true,
      );
      expect(
        canManageOrganizationBankAccounts(ctx({ is_super_admin: true })),
      ).toBe(true);
      expect(
        canManageOrganizationBankAccounts(ctx({ app_type: 'ORG_ADMIN' })),
      ).toBe(true);
      expect(canManageOrganizationBankAccounts(ctx({ roles: ['admin'] }))).toBe(
        true,
      );
      expect(
        canManageOrganizationBankAccounts({
          is_owner: false,
          is_super_admin: false,
          app_type: 'STORE_ADMIN',
          roles: ['store_admin', 'cashier'],
        }),
      ).toBe(false);
    });

    it('resolves policy using FiscalScopeService and applies modify/view rules by scope', async () => {
      const fiscalScopeService = {
        getFiscalScope: jest.fn().mockResolvedValue('ORGANIZATION'),
      };

      const orgPolicy = await resolveBankAccountPolicy(fiscalScopeService, {
        organization_id: 1,
        store_id: 10,
        context: ctx({ is_owner: true }),
      });
      const storeAdminPolicy = await resolveBankAccountPolicy(
        fiscalScopeService,
        {
          organization_id: 1,
          store_id: 10,
          context: ctx({ is_owner: false, roles: ['store_admin'] }),
        },
      );

      expect(canViewAllOrganizationBankAccounts(orgPolicy)).toBe(true);
      expect(canViewAllOrganizationBankAccounts(storeAdminPolicy)).toBe(false);
      expect(canModifyBankAccount({ store_id: null }, orgPolicy)).toBe(true);
      expect(canModifyBankAccount({ store_id: null }, storeAdminPolicy)).toBe(
        false,
      );
      expect(canModifyBankAccount({ store_id: 10 }, storeAdminPolicy)).toBe(
        true,
      );
      expect(canModifyBankAccount({ store_id: 20 }, storeAdminPolicy)).toBe(
        false,
      );
      // En scope ORGANIZATION, el admin de organización puede editar/cerrar
      // cuentas heredadas de cualquier sucursal de su organización (STORE -> ORG).
      expect(canModifyBankAccount({ store_id: 20 }, orgPolicy)).toBe(true);
      expect(
        canModifyBankAccount(
          { store_id: 20 },
          { ...orgPolicy, store_id: 0 },
        ),
      ).toBe(true);

      // En scope STORE, incluso un owner no modifica cuentas de otra tienda.
      const storeScopeOwnerPolicy = {
        ...orgPolicy,
        fiscal_scope: 'STORE' as const,
      };
      expect(
        canModifyBankAccount({ store_id: 20 }, storeScopeOwnerPolicy),
      ).toBe(false);
    });
  });

  describe('bank_transfer custom_config.accounts helpers', () => {
    it('extracts ids across { id }, { bank_account_id } and ignores legacy entries', () => {
      expect(extractBankTransferAccountEntryId({ id: 12 })).toBe(12);
      expect(extractBankTransferAccountEntryId({ bank_account_id: 34 })).toBe(
        34,
      );
      expect(
        extractBankTransferAccountEntryId({
          bank_name: 'Nequi',
          account_number: '300111',
          legacy: true,
        }),
      ).toBeNull();
      expect(
        collectBankTransferAccountIds({
          accounts: [
            { id: 10, bank_name: 'A' },
            { bank_account_id: 20, bank_name: 'B' },
            { bank_name: 'Legacy', account_number: '999' },
          ],
        }),
      ).toEqual([10, 20]);
    });

    it('filters out accounts not in allowed set while preserving legacy entries without id', () => {
      const cfg = {
        instructions: 'Pagar por PSE',
        accounts: [
          { id: 10, bank_name: 'Bancolombia', account_number: '111' },
          { bank_account_id: 20, bank_name: 'Davivienda', account_number: '222' },
          { bank_name: 'Legacy', account_number: '333', legacy: true },
        ],
      };

      const filtered = filterBankTransferConfigAccounts(cfg, new Set([10]));
      expect(filtered).toEqual({
        instructions: 'Pagar por PSE',
        accounts: [
          { id: 10, bank_name: 'Bancolombia', account_number: '111' },
          { bank_name: 'Legacy', account_number: '333', legacy: true },
        ],
      });
    });
  });

  describe('buildDuplicateBankAccountWarnings', () => {
    it('groups repeated active/inactive account numbers across stores and ignores closed accounts', () => {
      const warnings = buildDuplicateBankAccountWarnings([
        {
          id: 1,
          name: 'Bancolombia Norte',
          bank_name: 'Bancolombia',
          account_number: '123-456',
          store_id: 10,
          status: 'active',
          store: { id: 10, name: 'Sucursal Norte' },
        },
        {
          id: 2,
          name: 'Bancolombia Sur',
          bank_name: 'Bancolombia',
          account_number: '123-456',
          store_id: 20,
          status: 'active',
          store: { id: 20, name: 'Sucursal Sur' },
        },
        {
          id: 3,
          name: 'Nequi Cerrada',
          bank_name: 'Nequi',
          account_number: '3001112233',
          store_id: 10,
          status: 'closed',
          store: { id: 10, name: 'Sucursal Norte' },
        },
        {
          id: 4,
          name: 'Nequi Activa',
          bank_name: 'Nequi',
          account_number: '3001112233',
          store_id: 20,
          status: 'active',
          store: { id: 20, name: 'Sucursal Sur' },
        },
      ]);

      expect(warnings).toEqual([
        {
          account_number: '123-456',
          accounts: [
            {
              id: 1,
              name: 'Bancolombia Norte',
              bank_name: 'Bancolombia',
              store_id: 10,
              store_name: 'Sucursal Norte',
              status: 'active',
            },
            {
              id: 2,
              name: 'Bancolombia Sur',
              bank_name: 'Bancolombia',
              store_id: 20,
              store_name: 'Sucursal Sur',
              status: 'active',
            },
          ],
        },
      ]);
    });
  });
});
