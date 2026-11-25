import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideStore } from '@ngrx/store';
import { of, Subject } from 'rxjs';
import { BankAccountsComponent } from './bank-accounts.component';
import { BankAccountFormModalComponent } from './bank-account-form-modal.component';
import { BankReconciliationService } from '../../services/bank-reconciliation.service';
import { AccountingService } from '../../services/accounting.service';
import { DialogService, ToastService } from '../../../../../../shared/components';
import {
  BankAccount,
  BankAccountScopeContext,
} from '../../interfaces/accounting.interface';

describe('BankAccountsComponent & BankAccountFormModalComponent (QUI-1061)', () => {
  let reconciliationStub: jasmine.SpyObj<BankReconciliationService>;
  let accountingStub: jasmine.SpyObj<AccountingService>;
  let toastStub: jasmine.SpyObj<ToastService>;
  let dialogStub: jasmine.SpyObj<DialogService>;

  const makeAccount = (overrides: Partial<BankAccount> = {}): BankAccount => ({
    id: 1,
    name: 'Bancolombia Principal',
    account_number: '123456',
    bank_name: 'Bancolombia',
    currency: 'COP',
    opening_balance: 0,
    current_balance: 500000,
    status: 'active',
    store_id: 10,
    available_in_all_stores: true,
    can_edit: true,
    created_at: '2026-11-24T00:00:00Z',
    ...overrides,
  });

  const setup = (
    scopeContext: BankAccountScopeContext,
    accounts: BankAccount[] = [],
  ) => {
    reconciliationStub = jasmine.createSpyObj<BankReconciliationService>(
      'BankReconciliationService',
      [
        'getBankAccounts',
        'getBankAccountScopeContext',
        'createBankAccount',
        'updateBankAccount',
        'deleteBankAccount',
      ],
    );
    reconciliationStub.getBankAccountScopeContext.and.returnValue(
      of({ success: true, data: scopeContext }),
    );
    reconciliationStub.getBankAccounts.and.returnValue(
      of({ success: true, data: accounts }),
    );
    reconciliationStub.createBankAccount.and.returnValue(
      of({ success: true, data: makeAccount({ id: 99, store_id: null }) }),
    );
    reconciliationStub.updateBankAccount.and.returnValue(
      of({ success: true, data: makeAccount({ id: 1, store_id: null }) }),
    );

    accountingStub = jasmine.createSpyObj<AccountingService>(
      'AccountingService',
      ['getChartOfAccounts'],
    );
    accountingStub.getChartOfAccounts.and.returnValue(
      of({ success: true, data: [] }),
    );

    toastStub = jasmine.createSpyObj<ToastService>('ToastService', [
      'success',
      'error',
    ]);
    dialogStub = jasmine.createSpyObj<DialogService>('DialogService', [
      'confirm',
    ]);

    TestBed.configureTestingModule({
      imports: [BankAccountsComponent, BankAccountFormModalComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideStore(),
        { provide: BankReconciliationService, useValue: reconciliationStub },
        { provide: AccountingService, useValue: accountingStub },
        { provide: ToastService, useValue: toastStub },
        { provide: DialogService, useValue: dialogStub },
      ],
    });
  };

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('in scope STORE keeps standard behavior (canCreateAccount=true, no org warnings)', () => {
    setup(
      {
        fiscal_scope: 'STORE',
        can_manage_accounts: true,
        can_manage_organization_accounts: false,
        current_store_id: 10,
        stores: [],
        duplicate_number_warnings: [],
      },
      [makeAccount()],
    );

    const cmp = TestBed.createComponent(BankAccountsComponent).componentInstance;
    expect(cmp.isOrgScope()).toBeFalse();
    expect(cmp.canCreateAccount()).toBeTrue();
    expect(cmp.duplicateWarnings()).toEqual([]);
  });

  it('in scope ORGANIZATION exposes duplicate warnings and availability labels for org admin', () => {
    setup(
      {
        fiscal_scope: 'ORGANIZATION',
        can_manage_accounts: true,
        can_manage_organization_accounts: true,
        current_store_id: 10,
        stores: [
          { id: 10, name: 'Sucursal Norte', store_code: 'N', is_active: true },
          { id: 20, name: 'Sucursal Sur', store_code: 'S', is_active: true },
        ],
        duplicate_number_warnings: [
          {
            account_number: '123456',
            accounts: [
              {
                id: 1,
                name: 'Cuenta Norte',
                bank_name: 'Bancolombia',
                store_id: 10,
                store_name: 'Sucursal Norte',
                status: 'active',
              },
              {
                id: 2,
                name: 'Cuenta Sur',
                bank_name: 'Bancolombia',
                store_id: 20,
                store_name: 'Sucursal Sur',
                status: 'active',
              },
            ],
          },
        ],
      },
      [
        makeAccount({
          id: 10,
          store_id: null,
          available_in_all_stores: true,
        }),
        makeAccount({
          id: 11,
          store_id: null,
          available_in_all_stores: false,
          store_assignments: [
            { store_id: 10, store: { id: 10, name: 'Sucursal Norte' } },
          ],
        }),
      ],
    );

    const cmp = TestBed.createComponent(BankAccountsComponent).componentInstance;
    expect(cmp.isOrgScope()).toBeTrue();
    expect(cmp.canCreateAccount()).toBeTrue();
    expect(cmp.duplicateWarnings().length).toBe(1);
    expect(cmp.getAvailabilityLabel(cmp.accounts()[0])).toBe(
      'Todas las tiendas',
    );
    expect(cmp.getAvailabilityLabel(cmp.accounts()[1])).toBe('Sucursal Norte');
  });

  it('in scope ORGANIZATION disables creation/editing for store-only admins', () => {
    setup(
      {
        fiscal_scope: 'ORGANIZATION',
        can_manage_accounts: false,
        can_manage_organization_accounts: false,
        current_store_id: 10,
        stores: [],
        duplicate_number_warnings: [],
      },
      [makeAccount({ id: 10, store_id: null, can_edit: false })],
    );

    const cmp = TestBed.createComponent(BankAccountsComponent).componentInstance;
    expect(cmp.isOrgScope()).toBeTrue();
    expect(cmp.canCreateAccount()).toBeFalse();
    expect(cmp.canImportStatements()).toBeFalse();
    expect(cmp.editableAccounts()).toEqual([]);

    cmp.openCreateModal();
    expect(cmp.isFormModalOpen()).toBeFalse();

    cmp.openImportModal();
    expect(cmp.isImportModalOpen()).toBeFalse();

    cmp.editAccount(cmp.accounts()[0]);
    expect(cmp.isFormModalOpen()).toBeFalse();
  });

  it('keeps canCreateAccount false while scopeContext is loading (avoids button flicker)', () => {
    const scopeSubject = new Subject<{ success: boolean; data: BankAccountScopeContext }>();
    setup(
      {
        fiscal_scope: 'ORGANIZATION',
        can_manage_accounts: false,
        can_manage_organization_accounts: false,
        current_store_id: 10,
        stores: [],
        duplicate_number_warnings: [],
      },
      [],
    );
    reconciliationStub.getBankAccountScopeContext.and.returnValue(
      scopeSubject.asObservable(),
    );

    const cmp = TestBed.createComponent(BankAccountsComponent).componentInstance;
    expect(cmp.canCreateAccount()).toBeFalse();

    scopeSubject.next({
      success: true,
      data: {
        fiscal_scope: 'STORE',
        can_manage_accounts: true,
        can_manage_organization_accounts: false,
        current_store_id: 10,
        stores: [],
        duplicate_number_warnings: [],
      },
    });
    expect(cmp.canCreateAccount()).toBeTrue();
  });

  it('form modal sends available_in_all_stores and store_ids in scope ORGANIZATION and blocks empty store selection', () => {
    setup({
      fiscal_scope: 'ORGANIZATION',
      can_manage_accounts: true,
      can_manage_organization_accounts: true,
      current_store_id: 10,
      stores: [
        { id: 10, name: 'Sucursal A', store_code: 'A', is_active: true },
        { id: 20, name: 'Sucursal B', store_code: 'B', is_active: true },
      ],
      duplicate_number_warnings: [],
    });

    const fixture = TestBed.createComponent(BankAccountFormModalComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('fiscalScope', 'ORGANIZATION');
    fixture.componentRef.setInput('orgStores', [
      { id: 10, name: 'Sucursal A', store_code: 'A', is_active: true },
      { id: 20, name: 'Sucursal B', store_code: 'B', is_active: true },
    ]);
    const modal = fixture.componentInstance;
    expect(modal.showStoreAssignment()).toBeTrue();

    modal.form['name'] = 'Cuenta Sucursal A';
    modal.form['bank_name'] = 'Bancolombia';
    modal.form['account_number'] = '999-888';
    modal.setAvailabilityMode(false);

    // Empty store selection blocked
    modal.onSave();
    expect(reconciliationStub.createBankAccount).not.toHaveBeenCalled();
    expect(toastStub.error).toHaveBeenCalled();

    // Selecting store 10 succeeds
    modal.toggleStoreSelection(10);
    modal.onSave();
    expect(reconciliationStub.createBankAccount).toHaveBeenCalledWith(
      jasmine.objectContaining({
        name: 'Cuenta Sucursal A',
        account_number: '999-888',
        available_in_all_stores: false,
        store_ids: [10],
      }),
    );
  });
});
