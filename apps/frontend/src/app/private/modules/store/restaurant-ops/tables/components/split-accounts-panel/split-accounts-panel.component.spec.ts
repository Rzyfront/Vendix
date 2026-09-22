import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { SplitAccountsPanelComponent } from './split-accounts-panel.component';
import { TablesService } from '../../services/tables.service';
import { PaymentMethodsCatalogService } from '../../../../../../../shared/services/payment-methods-catalog.service';
import { ToastService } from '../../../../../../../shared/components';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import type { SplitFinancialAccount, SplitResult } from '../../interfaces';
import type { PaymentSubmit } from '../../../../../../../shared/components';
import { WompiSubMethod } from '../../../../../../../shared/services/wompi.service';

const account = (
  overrides: Partial<SplitFinancialAccount> = {},
): SplitFinancialAccount => ({
  id: 902,
  ordinal: 1,
  role: 'payable',
  label: 'Cuenta 1',
  customer_id: 7,
  customer_alias: null,
  payer: { customer_id: 7, customer_alias: null },
  subtotal_amount: '4000.00',
  discount_amount: '0.00',
  tax_amount: '0.00',
  shipping_cost: '0.00',
  tip_amount: '0.00',
  grand_total: '4000.00',
  paid_snapshot: '0.00',
  total_paid: '0.00',
  reserved_amount: '0.00',
  remaining_balance: '4000.00',
  available_to_pay: '4000.00',
  payment_state: 'unpaid',
  invoice_id: null,
  payments: [],
  ...overrides,
});
const split = (overrides: Partial<SplitResult> = {}): SplitResult => ({
  source_order_id: 41,
  split_group_id: null,
  source_version: 'source-v1',
  currency: 'COP',
  original_total: '11000.00',
  preserved_paid: '3000.00',
  pending_to_split: '8000.00',
  accounts: [account(), account({ id: 903, ordinal: 2 })],
  retained_account: account({
    id: 901,
    role: 'paid_original',
    grand_total: '3000.00',
    total_paid: '3000.00',
    remaining_balance: '0.00',
  }),
  kitchen_fire: null,
  ...overrides,
});

describe('SplitAccountsPanelComponent financial contract', () => {
  let fixture: ComponentFixture<SplitAccountsPanelComponent>;
  let component: SplitAccountsPanelComponent;
  let api: jasmine.SpyObj<TablesService>;
  let router: jasmine.SpyObj<Router>;
  beforeEach(async () => {
    api = jasmine.createSpyObj('TablesService', [
      'getFinancialSplit',
      'previewFinancialSplit',
      'splitByAmount',
      'splitByItems',
      'payFinancialAccount',
      'updateFinancialAccountCustomer',
      'invoiceFinancialAccount',
      'reconcileFinancialSplit',
    ]);
    api.getFinancialSplit.and.returnValue(of(null));
    api.previewFinancialSplit.and.returnValue(of(split()));
    api.splitByAmount.and.returnValue(of(split({ split_group_id: 3 })));
    router = jasmine.createSpyObj('Router', ['navigate']);
    router.navigate.and.resolveTo(true);
    await TestBed.configureTestingModule({
      imports: [SplitAccountsPanelComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: TablesService, useValue: api },
        { provide: Router, useValue: router },
        { provide: AuthFacade, useValue: { hasPermission: () => true } },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['success', 'error']),
        },
        {
          provide: PaymentMethodsCatalogService,
          useValue: { getEnabledMethods: () => of([]) },
        },
      ],
    })
      .overrideComponent(SplitAccountsPanelComponent, {
        set: { template: '', imports: [] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(SplitAccountsPanelComponent);
    fixture.componentRef.setInput('sourceOrderId', 41);
    fixture.componentRef.setInput('allowCreate', false);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await Promise.resolve();
  });
  afterEach(() => fixture.destroy());

  it('includes cooked items, excludes cancelled items, and does not group by stock state', () => {
    fixture.componentRef.setInput('items', [
      {
        id: 1,
        product_name: 'Cocinado',
        quantity: 1,
        inventory_consumed_at_fire: true,
      },
      {
        id: 2,
        product_name: 'Anulado',
        quantity: 1,
        cancelled_at: '2026-09-20',
      },
    ]);
    expect(component.activeItems().map((item) => item.id)).toEqual([1]);
  });

  it('uses the server pending balance, not original total, for custom defaults', async () => {
    await component.calculatePreview();
    component.setMode('custom');
    expect(component.form.controls.amounts.getRawValue()).toEqual([4000, 4000]);
    expect(component.summary()?.preserved_paid).toBe('3000.00');
    expect(component.canConfirm()).toBeFalse();
  });

  it('invalidates preview after an amount edit until the server rechecks it', async () => {
    await component.calculatePreview();
    expect(component.canConfirm()).toBeTrue();
    component.form.controls.count.setValue(3);
    expect(component.canConfirm()).toBeFalse();
  });

  it('confirms with source version and an idempotency key, not fabricated child orders', async () => {
    await component.calculatePreview();
    await component.confirmSplit();
    const dto = api.splitByAmount.calls.mostRecent().args[1];
    expect(dto.source_version).toBe('source-v1');
    expect(dto.idempotency_key!.length).toBeGreaterThan(8);
    expect(component.group()?.accounts[0].id).toBe(902);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('locks the payer once money is reserved, received or a document exists', () => {
    expect(component.canEditPayer(account())).toBeTrue();
    expect(
      component.canEditPayer(account({ reserved_amount: '1.00' })),
    ).toBeFalse();
    expect(component.canEditPayer(account({ total_paid: '1.00' }))).toBeFalse();
    expect(component.canEditPayer(account({ invoice_id: 71 }))).toBeFalse();
    expect(
      component.canEditPayer(account({ role: 'paid_original' })),
    ).toBeFalse();
  });

  it('opens the real invoice list deep-link, never order/:accountId', async () => {
    api.invoiceFinancialAccount.and.returnValue(
      of({ id: 71, status: 'draft' }),
    );
    await component.invoice(account());
    expect(api.invoiceFinancialAccount).toHaveBeenCalledWith(902);
    expect(router.navigate).toHaveBeenCalledWith(
      ['/admin/invoicing/invoices'],
      { queryParams: { invoiceId: 71 } },
    );
  });

  it('retains the idempotency key after transport failure and preserves Wompi fields', async () => {
    api.payFinancialAccount.and.returnValue(
      throwError(() => new Error('network')),
    );
    component.openPayment(account());
    const submit: PaymentSubmit = {
      storePaymentMethodId: 4,
      methodType: 'wompi',
      amount: 4000,
      mode: 'contado',
      method: {
        id: '4',
        name: 'Wompi',
        type: 'wompi',
        icon: 'credit-card',
        enabled: true,
      },
      wompi: {
        subMethod: WompiSubMethod.NEQUI,
        payload: { type: 'NEQUI', phone_number: '3001234567' },
      },
    };
    await component.pay(submit);
    component.openPayment(account());
    await component.pay(submit);
    const first = api.payFinancialAccount.calls.argsFor(0)[2];
    const second = api.payFinancialAccount.calls.argsFor(1)[2];
    expect(first.idempotency_key).toBe(second.idempotency_key);
    expect(first.wompi_payment_method).toEqual({
      type: 'NEQUI',
      phone_number: '3001234567',
    });
    expect(component.group()).toBeNull();
  });

  it('does not turn a pending gateway payment into a paid account', async () => {
    api.payFinancialAccount.and.returnValue(
      of({
        payment: {
          id: 81,
          amount: '4000.00',
          state: 'pending',
          nextAction: { url: 'https://checkout.wompi.co/' },
        },
        split: split({
          split_group_id: 3,
          accounts: [
            account({
              payment_state: 'pending',
              reserved_amount: '4000.00',
              available_to_pay: '0.00',
            }),
          ],
        }),
      }),
    );
    component.openPayment(account());
    await component.pay({
      storePaymentMethodId: 4,
      methodType: 'wompi',
      amount: 4000,
      mode: 'contado',
      method: {
        id: '4',
        name: 'Wompi',
        type: 'wompi',
        icon: 'credit-card',
        enabled: true,
      },
    });
    expect(component.group()?.accounts[0].payment_state).toBe('pending');
    expect(component.group()?.accounts[0].total_paid).toBe('0.00');
    expect(component.gatewayUrl()).toBe('https://checkout.wompi.co/');
  });

  it('rejects executable or insecure gateway URLs', () => {
    expect(component.safeGatewayUrl('javascript:alert(1)')).toBeNull();
    expect(component.safeGatewayUrl('http://example.com')).toBeNull();
    expect(
      component.safeGatewayUrl('https://checkout.wompi.co/'),
    ).not.toBeNull();
  });
});
