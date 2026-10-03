import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { SplitAccountsPanelComponent } from './split-accounts-panel.component';
import { TablesService } from '../../services/tables.service';
import { PaymentMethodsCatalogService } from '../../../../../../../shared/services/payment-methods-catalog.service';
import { DialogService, ToastService } from '../../../../../../../shared/components';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
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
  customer_name: 'Ana',
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
  invoice: null,
  lines: [],
  payments: [],
  ...overrides,
});
const split = (overrides: Partial<SplitResult> = {}): SplitResult => ({
  source_order_id: 41,
  split_group_id: null,
  mode: 'items',
  undo: { allowed: true, blockers: [], invoices_to_discard: [] },
  source_version: 'source-v1',
  currency: 'COP',
  original_total: '11000.00',
  preserved_paid: '3000.00',
  pending_to_split: '8000.00',
  accounts: [account(), account({ id: 903, ordinal: 2, label: 'Cuenta 2' })],
  retained_account: account({
    id: 901,
    role: 'paid_original',
    label: 'Abonos anteriores',
    grand_total: '3000.00',
    total_paid: '3000.00',
    remaining_balance: '0.00',
    available_to_pay: '0.00',
    payment_state: 'paid',
  }),
  kitchen_fire: null,
  ...overrides,
});
const paid = (o: Partial<SplitFinancialAccount> = {}) =>
  account({
    payment_state: 'paid',
    total_paid: '4000.00',
    remaining_balance: '0.00',
    available_to_pay: '0.00',
    ...o,
  });
const groupOf = (...accounts: SplitFinancialAccount[]) =>
  split({ split_group_id: 3, accounts, retained_account: null });

describe('SplitAccountsPanelComponent', () => {
  let fixture: ComponentFixture<SplitAccountsPanelComponent>;
  let component: SplitAccountsPanelComponent;
  let api: jasmine.SpyObj<TablesService>;
  let router: jasmine.SpyObj<Router>;
  let dialog: jasmine.SpyObj<DialogService>;

  const text = (): string =>
    (fixture.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');

  const create = async (
    opts: { group?: SplitResult | null; allowCreate?: boolean; items?: unknown[] } = {},
  ) => {
    api.getFinancialSplit.and.returnValue(of(opts.group ?? null));
    api.reconcileFinancialSplit.and.returnValue(of(opts.group ?? split()));
    fixture = TestBed.createComponent(SplitAccountsPanelComponent);
    fixture.componentRef.setInput('sourceOrderId', 41);
    fixture.componentRef.setInput('allowCreate', opts.allowCreate ?? true);
    if (opts.items) fixture.componentRef.setInput('items', opts.items);
    component = fixture.componentInstance;
    fixture.detectChanges();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    fixture.detectChanges();
  };

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
      'cancelFinancialSplit',
      'confirmFinancialAccountPayment',
    ]);
    api.previewFinancialSplit.and.returnValue(of(split()));
    api.splitByAmount.and.returnValue(of(split({ split_group_id: 3 })));
    api.cancelFinancialSplit.and.returnValue(of({ cancelled: true }));
    router = jasmine.createSpyObj('Router', ['navigate']);
    router.navigate.and.resolveTo(true);
    dialog = jasmine.createSpyObj('DialogService', ['confirm']);
    dialog.confirm.and.resolveTo(true);
    await TestBed.configureTestingModule({
      imports: [SplitAccountsPanelComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: TablesService, useValue: api },
        { provide: Router, useValue: router },
        { provide: DialogService, useValue: dialog },
        { provide: AuthFacade, useValue: { hasPermission: () => true } },
        { provide: StoreSettingsFacade, useValue: { timezone: signal('America/Bogota') } },
        {
          provide: CurrencyFormatService,
          useValue: {
            loadCurrency: () => undefined,
            currencyFormatStyle: () => 'dot_comma',
            currencyDecimals: () => 0,
            format: (v: number) => `$${Math.round(v)}`,
          },
        },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['success', 'error']),
        },
        {
          provide: PaymentMethodsCatalogService,
          useValue: { getEnabledMethods: () => of([]) },
        },
      ],
    }).compileComponents();
  });
  afterEach(() => fixture?.destroy());

  describe('armado', () => {
    it('defaults to "Por productos" and shows no manual preview button', async () => {
      await create({
        items: [{ id: 1, product_name: 'Pizza', quantity: 1 }],
      });
      expect(component.mode()).toBe('items');
      expect(text()).toContain('Por productos');
      expect(text()).not.toContain('Ver vista previa');
      expect(text()).not.toContain('Vista previa calculada por el servidor');
      expect(text()).toContain('Crear 2 cuentas');
    });

    it('includes cooked items and excludes cancelled items', async () => {
      await create({
        items: [
          { id: 1, product_name: 'Cocinado', quantity: 1, inventory_consumed_at_fire: true },
          { id: 2, product_name: 'Anulado', quantity: 1, cancelled_at: '2026-09-20' },
        ],
      });
      expect(component.activeItems().map((i) => i.id)).toEqual([1]);
    });

    it('explains the proportional split only for equal/custom modes', async () => {
      await create({ items: [{ id: 1, product_name: 'Pizza', quantity: 1 }] });
      expect(text()).not.toContain('parte proporcional de cada producto');
      component.setMode('equal');
      fixture.detectChanges();
      expect(text()).toContain('parte proporcional de cada producto');
    });

    it('requires every product assigned and keeps the confirm button disabled', async () => {
      await create({
        items: [
          { id: 1, product_name: 'Pizza', quantity: 1 },
          { id: 2, product_name: 'Soda', quantity: 1 },
        ],
      });
      expect(component.draftValid()).toBeFalse();
      expect(component.draftIssue()).toContain('Faltan 2 productos');
      component.assign(1, 1);
      component.assign(2, 1);
      expect(component.draftIssue()).toContain('Cuenta 2 necesita al menos un producto');
      component.assign(2, 2);
      expect(component.draftValid()).toBeTrue();
      expect(component.canConfirm()).toBeFalse();
      await component.calculatePreview();
      expect(component.canConfirm()).toBeTrue();
      const [, dto] = api.previewFinancialSplit.calls.mostRecent().args;
      expect(dto.mode).toBe('items');
      expect(dto.item_groups).toEqual([{ order_item_ids: [1] }, { order_item_ids: [2] }]);
    });

    it('recalculates the preview automatically (debounced) without a button', async () => {
      jasmine.clock().install();
      try {
        await create({ items: [{ id: 1, product_name: 'Pizza', quantity: 1 }] });
        api.previewFinancialSplit.calls.reset();
        component.setMode('equal');
        fixture.detectChanges();
        expect(api.previewFinancialSplit).not.toHaveBeenCalled();
        jasmine.clock().tick(450);
        expect(api.previewFinancialSplit).toHaveBeenCalledTimes(1);
        expect(api.previewFinancialSplit.calls.mostRecent().args[1].mode).toBe('equal');
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('uses the server pending balance for custom defaults and shows what is left', async () => {
      await create();
      component.setMode('custom');
      expect(component.form.controls.amounts.getRawValue()).toEqual([4000, 4000]);
      expect(component.remaining()).toBe(0);
      component.amountControl(0).setValue(1000);
      expect(component.remaining()).toBe(3000);
      expect(component.draftValid()).toBeFalse();
      fixture.detectChanges();
      expect(text()).toContain('Falta repartir $3000');
    });

    it('invalidates the preview after the number of accounts changes', async () => {
      await create();
      component.setMode('equal');
      await component.calculatePreview();
      expect(component.canConfirm()).toBeTrue();
      component.addAccount();
      expect(component.accountCount()).toBe(3);
      expect(component.canConfirm()).toBeFalse();
      expect(component.payers()).toHaveSize(3);
    });

    it('removes an account and remaps product assignments (min 2)', async () => {
      await create({ items: [{ id: 1, product_name: 'A', quantity: 1 }, { id: 2, product_name: 'B', quantity: 1 }] });
      component.addAccount();
      component.assign(1, 2);
      component.assign(2, 3);
      component.removeAccount(0);
      expect(component.accountCount()).toBe(2);
      expect(component.assignments()).toEqual({ 1: 1, 2: 2 });
      component.removeAccount(0);
      expect(component.accountCount()).toBe(2);
    });

    it('confirms with source version and an idempotency key', async () => {
      await create();
      component.setMode('equal');
      await component.calculatePreview();
      await component.confirmSplit();
      const dto = api.splitByAmount.calls.mostRecent().args[1];
      expect(dto.source_version).toBe('source-v1');
      expect(dto.idempotency_key!.length).toBeGreaterThan(8);
      expect(component.group()?.accounts[0].id).toBe(902);
      expect(router.navigate).not.toHaveBeenCalled();
    });
  });

  describe('división creada', () => {
    it('main action per state: unpaid -> Cobrar, paid -> Facturar, invoiced -> Ver factura', async () => {
      await create({
        group: groupOf(
          account({ id: 1, label: 'Cuenta 1' }),
          paid({ id: 2, label: 'Cuenta 2' }),
          paid({
            id: 3,
            label: 'Cuenta 3',
            invoice_id: 70,
            invoice: {
              id: 70,
              invoice_number: 'FV-12',
              status: 'validated',
              dian_status: 'accepted',
              grand_total: '4000.00',
            },
          }),
        ),
      });
      const cards = component.accountCards();
      expect(cards[0].action?.kind).toBe('pay');
      expect(cards[1].action?.kind).toBe('invoice');
      expect(cards[2].action?.kind).toBe('view_invoice');
      expect(text()).toContain('Cobrar $4000');
      expect(text()).toContain('Facturar');
      expect(text()).toContain('Ver factura N° FV-12');
      expect(text()).toContain('Aceptada por la DIAN');
      expect(text()).toContain('Pendiente');
      expect(text()).toContain('Pagada');
      expect(text()).toContain('Facturada');
    });

    it('never offers Facturar before the account is fully paid', async () => {
      await create({
        group: groupOf(
          account({ id: 1 }),
          account({
            id: 2,
            label: 'Cuenta 2',
            payment_state: 'pending',
            reserved_amount: '4000.00',
            available_to_pay: '0.00',
            payments: [
              {
                id: 5,
                amount: '4000.00',
                state: 'pending',
                payment_method_name: 'Wompi',
                created_at: null,
                can_confirm: true,
                next_action: null,
              },
            ],
          }),
          account({ id: 3, payment_state: 'partial', total_paid: '1000.00', remaining_balance: '3000.00', available_to_pay: '3000.00' }),
        ),
      });
      const kinds = component.accountCards().map((c) => c.action?.kind);
      expect(kinds).toEqual(['pay', 'confirm', 'pay']);
      expect(kinds).not.toContain('invoice');
      expect(text()).not.toContain('Facturar');
      expect(text()).toContain('Pago por confirmar');
      expect(text()).not.toMatch(/\bpending\b|\bunpaid\b/);
    });

    it('asks to confirm before invoicing an account without customer', async () => {
      await create({ group: groupOf(paid({ customer_id: null, customer_name: null })) });
      api.invoiceFinancialAccount.and.returnValue(of({ id: 71, status: 'draft' }));
      const acc = component.group()!.accounts[0];
      dialog.confirm.and.resolveTo(false);
      await component.runAction(acc, { kind: 'invoice', label: 'Facturar' });
      expect(dialog.confirm).toHaveBeenCalled();
      expect(dialog.confirm.calls.mostRecent().args[0].message).toBe(
        'Se facturará a consumidor final. ¿Continuar?',
      );
      expect(api.invoiceFinancialAccount).not.toHaveBeenCalled();
      dialog.confirm.and.resolveTo(true);
      await component.runAction(acc, { kind: 'invoice', label: 'Facturar' });
      expect(api.invoiceFinancialAccount).toHaveBeenCalledWith(902);
    });

    it('confirm() on remove mentions the invoice drafts that will be discarded', async () => {
      const g = groupOf(account({ id: 1 }), account({ id: 2, label: 'Cuenta 2' }));
      g.undo = {
        allowed: true,
        blockers: [],
        invoices_to_discard: [
          { account_id: 2, account_label: 'Cuenta 2', invoice_id: 9, invoice_number: 'BR-9' },
        ],
      };
      await create({ group: g });
      await component.removeSplit();
      const data = dialog.confirm.calls.mostRecent().args[0];
      expect(data.message).toContain('Cuenta 2');
      expect(data.message).toContain('BR-9');
      expect(api.cancelFinancialSplit).toHaveBeenCalledWith(41, 'source-v1');
    });

    it('does not cancel when the owner declines the confirm', async () => {
      await create({ group: groupOf(account()) });
      dialog.confirm.and.resolveTo(false);
      await component.removeSplit();
      expect(api.cancelFinancialSplit).not.toHaveBeenCalled();
    });

    it('blocked undo disables the button and shows the reason', async () => {
      const g = groupOf(account({ id: 1 }), account({ id: 2, label: 'Cuenta 2' }));
      g.undo = {
        allowed: false,
        blockers: [
          { account_id: 1, account_label: 'Cuenta 1', reason: 'payment_registered', amount: '2500.00' },
          { account_id: 2, account_label: 'Cuenta 2', reason: 'invoice_transmitted', amount: null },
        ],
        invoices_to_discard: [],
      };
      await create({ group: g });
      const button = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('app-button'),
      ).find((b) => b.textContent!.includes('Quitar división'))!;
      expect(button.querySelector('button')!.disabled).toBeTrue();
      expect(text()).toContain('No se puede quitar');
      expect(text()).toContain('Cuenta 1 ya tiene un pago registrado de $2500');
      expect(text()).toContain('la factura de Cuenta 2 ya fue enviada a la DIAN');
      await component.removeSplit();
      expect(dialog.confirm).not.toHaveBeenCalled();
    });

    it('header summarizes the mode, collected amount and invoiced count', async () => {
      await create({
        group: groupOf(
          paid({ id: 1 }),
          account({ id: 2, label: 'Cuenta 2' }),
        ),
      });
      expect(text()).toContain('Cuenta dividida en 2');
      expect(text()).toContain('Por productos');
      expect(text()).toContain('Cobrado $4000 de $8000');
      expect(text()).toContain('Facturadas 0 de 2');
    });

    it('labels the retained account as payments made before splitting', async () => {
      await create({ group: split({ split_group_id: 3 }) });
      expect(text()).toContain('Pagos hechos antes de dividir');
      expect(text()).not.toContain('Abonos conservados');
    });

    it('opens the detail modal with the live account', async () => {
      await create({ group: groupOf(account()) });
      component.openDetail(component.group()!.accounts[0]);
      fixture.detectChanges();
      expect(component.detailOpen()).toBeTrue();
      expect(component.liveDetailAccount()?.id).toBe(902);
    });

    it('maps SPLIT_CANCEL_BLOCKED to a clear toast', async () => {
      await create({ group: groupOf(account()) });
      const toast = TestBed.inject(ToastService) as jasmine.SpyObj<ToastService>;
      api.cancelFinancialSplit.and.returnValue(
        throwError(() => ({ error: { error_code: 'SPLIT_CANCEL_BLOCKED' } })),
      );
      await component.removeSplit();
      expect(toast.error).toHaveBeenCalledWith(
        jasmine.stringMatching(/No se puede quitar la división/),
      );
    });
  });

  describe('pagos y cliente', () => {
    it('locks the payer once money is reserved, received or a document exists', async () => {
      await create({ allowCreate: false });
      expect(component.canEditPayer(account())).toBeTrue();
      expect(component.canEditPayer(account({ reserved_amount: '1.00' }))).toBeFalse();
      expect(component.canEditPayer(account({ total_paid: '1.00' }))).toBeFalse();
      expect(component.canEditPayer(account({ invoice_id: 71 }))).toBeFalse();
      expect(component.canEditPayer(account({ role: 'paid_original' }))).toBeFalse();
    });

    it('opens the real invoice list deep-link, never order/:accountId', async () => {
      await create({ allowCreate: false });
      api.invoiceFinancialAccount.and.returnValue(of({ id: 71, status: 'draft' }));
      await component.invoice(account());
      expect(api.invoiceFinancialAccount).toHaveBeenCalledWith(902);
      expect(router.navigate).toHaveBeenCalledWith(['/admin/invoicing/invoices'], {
        queryParams: { invoiceId: 71 },
      });
    });

    const wompi: PaymentSubmit = {
      storePaymentMethodId: 4,
      methodType: 'wompi',
      amount: 4000,
      mode: 'contado',
      method: { id: '4', name: 'Wompi', type: 'wompi', icon: 'credit-card', enabled: true },
      wompi: {
        subMethod: WompiSubMethod.NEQUI,
        payload: { type: 'NEQUI', phone_number: '3001234567' },
      },
    };

    it('retains the idempotency key after transport failure and preserves Wompi fields', async () => {
      await create({ allowCreate: false });
      api.payFinancialAccount.and.returnValue(throwError(() => new Error('network')));
      component.openPayment(account());
      await component.pay(wompi);
      component.openPayment(account());
      await component.pay(wompi);
      const first = api.payFinancialAccount.calls.argsFor(0)[2];
      const second = api.payFinancialAccount.calls.argsFor(1)[2];
      expect(first.idempotency_key).toBe(second.idempotency_key);
      expect(first.wompi_payment_method).toEqual({ type: 'NEQUI', phone_number: '3001234567' });
      expect(component.group()).toBeNull();
    });

    it('does not turn a pending gateway payment into a paid account', async () => {
      await create({ allowCreate: false });
      api.payFinancialAccount.and.returnValue(
        of({
          payment: {
            id: 81,
            amount: '4000.00',
            state: 'pending',
            nextAction: { url: 'https://checkout.wompi.co/' },
          },
          split: groupOf(
            account({ payment_state: 'pending', reserved_amount: '4000.00', available_to_pay: '0.00' }),
          ),
        }),
      );
      component.openPayment(account());
      await component.pay({ ...wompi, wompi: undefined });
      expect(component.group()?.accounts[0].payment_state).toBe('pending');
      expect(component.group()?.accounts[0].total_paid).toBe('0.00');
      expect(component.gatewayUrl()).toBe('https://checkout.wompi.co/');
    });

    it('rejects executable or insecure gateway URLs', async () => {
      await create({ allowCreate: false });
      expect(component.safeGatewayUrl('javascript:alert(1)')).toBeNull();
      expect(component.safeGatewayUrl('http://example.com')).toBeNull();
      expect(component.safeGatewayUrl('https://checkout.wompi.co/')).not.toBeNull();
    });
  });
});
