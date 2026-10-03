import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SplitAccountDetailComponent } from './split-account-detail.component';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import type { SplitFinancialAccount, SplitResultMode } from '../../interfaces';
import type { SplitPrimaryAction } from './split-account-view.util';

const base = (o: Partial<SplitFinancialAccount> = {}): SplitFinancialAccount => ({
  id: 5,
  ordinal: 1,
  role: 'payable',
  label: 'Cuenta 1',
  customer_id: null,
  customer_alias: null,
  payer: { customer_id: null, customer_alias: null },
  subtotal_amount: '3000.00',
  discount_amount: '100.00',
  tax_amount: '570.00',
  shipping_cost: '0.00',
  tip_amount: '200.00',
  grand_total: '3670.00',
  paid_snapshot: '0.00',
  total_paid: '0.00',
  reserved_amount: '0.00',
  remaining_balance: '3670.00',
  available_to_pay: '3670.00',
  payment_state: 'unpaid',
  invoice_id: null,
  invoice: null,
  lines: [
    { id: 1, order_item_id: 10, product_name: 'Pizza', variant_name: 'Grande', original_quantity: 2, share_ratio: '0.5', subtotal: '2000.00', discount: '0', tax: '380.00', total: '2380.00' },
    { id: 2, order_item_id: 11, product_name: 'Soda', variant_name: null, original_quantity: 1, share_ratio: '0.25', subtotal: '1000.00', discount: '0', tax: '190.00', total: '1190.00' },
  ],
  payments: [],
  ...o,
});

describe('SplitAccountDetailComponent', () => {
  let fixture: ComponentFixture<SplitAccountDetailComponent>;
  const text = (): string =>
    (document.body.textContent ?? '').replace(/\s+/g, ' ');

  const create = (account: SplitFinancialAccount, mode: SplitResultMode | null, canInvoice = true) => {
    fixture = TestBed.createComponent(SplitAccountDetailComponent);
    fixture.componentRef.setInput('account', account);
    fixture.componentRef.setInput('mode', mode);
    fixture.componentRef.setInput('currency', 'COP');
    fixture.componentRef.setInput('canPay', true);
    fixture.componentRef.setInput('canInvoice', canInvoice);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    return fixture.componentInstance;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SplitAccountDetailComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: CurrencyFormatService,
          useValue: { loadCurrency: () => undefined, format: (v: number) => `$${Math.round(v)}` },
        },
      ],
    }).compileComponents();
  });
  afterEach(() => fixture?.destroy());

  it('items mode lists the products with variant, quantity, tax and total', () => {
    create(base(), 'items');
    expect(text()).toContain('Qué incluye');
    expect(text()).toContain('Pizza · Grande');
    expect(text()).toContain('Soda');
    expect(text()).not.toContain('Participación por producto');
    expect(text()).not.toContain('Monto asignado');
    expect(document.querySelector('[data-testid="items-table"]')).not.toBeNull();
  });

  it('equal/custom mode shows the assigned amount, breakdown and share per product', () => {
    create(base(), 'equal');
    expect(text()).toContain('Monto asignado');
    expect(text()).toContain('Base');
    expect(text()).toContain('Descuento');
    expect(text()).toContain('Impuestos');
    expect(text()).toContain('Propina');
    expect(text()).toContain('Participación por producto');
    expect(text()).toContain('50 %');
    expect(text()).toContain('25 %');
    expect(document.querySelector('[data-testid="items-table"]')).toBeNull();
  });

  it('shows why the invoice is not available yet when the account is unpaid', () => {
    create(base(), 'items');
    expect(text()).toContain('Cobra la cuenta para poder facturarla');
    expect(text()).toContain('Cobrar $3670');
    expect(text()).not.toContain('Facturar');
  });

  it('lists payments in Spanish and emits the confirm action', () => {
    const detail = create(
      base({
        payment_state: 'pending',
        reserved_amount: '3670.00',
        payments: [
          { id: 8, amount: '3670.00', state: 'pending', payment_method_name: 'Nequi', created_at: '2026-10-03T15:30:00Z', can_confirm: true, next_action: null },
        ],
      }),
      'items',
    );
    expect(text()).toContain('Nequi');
    expect(text()).toContain('03/10/2026 10:30');
    expect(text()).toContain('Por confirmar');
    expect(text()).not.toContain('pending');
    let emitted: SplitPrimaryAction | null = null;
    detail.actionRequested.subscribe((a) => (emitted = a));
    detail.runAction();
    expect(emitted!.kind).toBe('confirm');
  });

  it('shows the invoice number, DIAN status and a view button when invoiced', () => {
    create(
      base({
        payment_state: 'paid',
        invoice_id: 70,
        invoice: { id: 70, invoice_number: 'FV-12', status: 'validated', dian_status: 'accepted', grand_total: '3670.00' },
      }),
      'items',
    );
    expect(text()).toContain('N° FV-12');
    expect(text()).toContain('Aceptada por la DIAN');
    expect(text()).toContain('Ver factura');
  });
});
