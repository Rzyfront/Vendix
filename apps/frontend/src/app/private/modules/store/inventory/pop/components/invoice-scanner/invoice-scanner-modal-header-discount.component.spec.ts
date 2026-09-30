import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { InvoiceScannerModalComponent } from './invoice-scanner-modal.component';
import { InvoiceScannerService } from '../../services/invoice-scanner.service';
import { UomService } from '../../../services/uom.service';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { SuppliersService } from '../../../services/suppliers.service';
import { ProductsService } from '../../../../products/services/products.service';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import {
  InvoiceMatchResult,
  InvoiceScanResult,
  MatchedLineItem,
} from '../../interfaces/invoice-scanner.interface';
import { resolveCartHeaderDiscount } from '../../utils/scan-header-discount.util';

/**
 * QUI-855 — descuento general de la precarga: el modal y el carrito deben
 * hablar la MISMA unidad. Escenario de la auditoría: factura con IVA incluido,
 * línea 119.000 al 19 % (multi-impuesto, bruto), descuento impreso 11.900
 * (neto 10.000).
 */
function scan(over: Partial<InvoiceScanResult> = {}): InvoiceScanResult {
  return {
    supplier: { name: 'Proveedor' },
    invoice_number: 'FV-1',
    invoice_date: '2026-09-20',
    prices_include_tax: true,
    line_items: [],
    subtotal: 90000,
    tax_amount: 17100,
    total: 107100,
    discount_amount: 10000,
    discount_amount_printed: 11900,
    confidence: 0.9,
    ...over,
  };
}

function grossLine(): MatchedLineItem {
  return {
    description: 'Producto',
    quantity: 1,
    unit_price: 100000,
    unit_price_gross: 119000,
    total: 119000,
    tax_rate: 0.19,
    taxes: [
      {
        tax_type: 'iva',
        tax_rate: 19,
        calc_mode: 'percent',
        fixed_amount_per_unit: null,
        amount_override: null,
        is_inclusive: true,
      },
    ],
    match_status: 'new',
    candidates: [],
  };
}

function legacyLine(): MatchedLineItem {
  return {
    description: 'Legacy',
    quantity: 1,
    unit_price: 100000,
    total: 119000,
    tax_rate: 0.19,
    match_status: 'new',
    candidates: [],
  };
}

describe('InvoiceScannerModalComponent — QUI-855 descuento general en una sola unidad', () => {
  let fixture: ComponentFixture<InvoiceScannerModalComponent>;
  let component: InvoiceScannerModalComponent;
  let scanned: InvoiceScanResult;
  let matched: MatchedLineItem[];

  beforeEach(() => {
    scanned = scan();
    matched = [grossLine()];
    TestBed.configureTestingModule({
      imports: [InvoiceScannerModalComponent],
      providers: [
        {
          provide: InvoiceScannerService,
          useValue: {
            scanInvoice: () => of({ success: true, data: scanned }),
            matchProducts: () =>
              of({
                success: true,
                data: {
                  supplier_match: { name: 'Proveedor', confidence: 1, is_new: false, matched_id: 1 },
                  items: matched,
                  warnings: [],
                } as InvoiceMatchResult,
              }),
          },
        },
        { provide: UomService, useValue: { getCatalog: () => of({ data: [] }), peekCatalog: () => null } },
        { provide: ToastService, useValue: { success: () => undefined, error: () => undefined } },
        { provide: SuppliersService, useValue: { getSuppliers: () => of({ data: [] }) } },
        { provide: ProductsService, useValue: { getProducts: () => of({ data: [] }) } },
        {
          provide: CurrencyFormatService,
          useValue: {
            loadCurrency: () => Promise.resolve(null),
            format: (n: number | string | null | undefined) => '$' + Number(n ?? 0).toFixed(2),
            currencyFormatStyle: () => 'comma_dot' as const,
            currencyDecimals: () => 2,
          },
        },
      ],
    });
    fixture = TestBed.createComponent(InvoiceScannerModalComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
  });

  function scanAndConfirm(): { emitted: any } {
    component.selectedFile.set(new File(['x'], 'f.pdf', { type: 'application/pdf' }));
    component.startScan();
    component.aiAck.set(true);
    let emitted: any;
    component.confirmed.subscribe((e) => (emitted = e));
    return {
      get emitted() {
        return emitted;
      },
    } as { emitted: any };
  }

  it('con línea multi-impuesto se siembra el IMPRESO (11.900) y el total del modal usa esa cifra', () => {
    scanAndConfirm();
    expect(component.headerDiscount()).toBe(11900);
    expect(component.headerDiscountGross()).toBeTrue();
    // 119.000 - 11.900 = 107.100 (neto 90.000 + IVA 17.100).
    expect(component.purchaseTotals().total).toBe(107100);
  });

  it('confirmar sin editar entrega al carrito la MISMA cifra que ve el modal', () => {
    const h = scanAndConfirm();
    component.onConfirm();
    expect(h.emitted.scanResult.discount_amount_printed).toBe(11900);
    expect(resolveCartHeaderDiscount(h.emitted.scanResult, h.emitted.editedItems)).toBe(11900);
  });

  it('si el operador pone el descuento en 0, el carrito recibe 0 (no vuelve a los 10.000 netos)', () => {
    const h = scanAndConfirm();
    component.updateHeaderDiscount({ target: { value: '0' } } as unknown as Event);
    expect(component.purchaseTotals().total).toBe(119000);
    component.onConfirm();
    expect(h.emitted.scanResult.discount_amount_printed).toBe(0);
    expect(resolveCartHeaderDiscount(h.emitted.scanResult, h.emitted.editedItems)).toBe(0);
  });

  it('una edición (5.000) viaja en el campo bruto y llega tal cual', () => {
    const h = scanAndConfirm();
    component.updateHeaderDiscount({ target: { value: '5000' } } as unknown as Event);
    component.onConfirm();
    expect(h.emitted.scanResult.discount_amount_printed).toBe(5000);
    expect(resolveCartHeaderDiscount(h.emitted.scanResult, h.emitted.editedItems)).toBe(5000);
  });

  it('sin líneas multi-impuesto trabaja en NETO: siembra 10.000 y emite discount_amount con impreso null', () => {
    matched = [legacyLine()];
    const h = scanAndConfirm();
    expect(component.headerDiscount()).toBe(10000);
    expect(component.headerDiscountGross()).toBeFalse();
    component.updateHeaderDiscount({ target: { value: '0' } } as unknown as Event);
    component.onConfirm();
    expect(h.emitted.scanResult.discount_amount).toBe(0);
    expect(h.emitted.scanResult.discount_amount_printed).toBeNull();
    expect(resolveCartHeaderDiscount(h.emitted.scanResult, h.emitted.editedItems)).toBe(0);
  });

  it('escaneo sin descuento y sin edición: no emite cifra (no pisa el carrito)', () => {
    scanned = scan({ discount_amount: 0, discount_amount_printed: null });
    matched = [legacyLine()];
    const h = scanAndConfirm();
    component.onConfirm();
    expect(h.emitted.scanResult.discount_amount).toBeNull();
    expect(resolveCartHeaderDiscount(h.emitted.scanResult, h.emitted.editedItems)).toBeNull();
  });

  it('«Usar revalidación» siembra el descuento revalidado en la unidad de las líneas', () => {
    scanAndConfirm();
    component.revalidateResult.set({
      consolidated: scan({ discount_amount: 20000, discount_amount_printed: 23800 }),
      report: { summary: '', confidence: 'high', findings: [], red_flags: [], divergences: [] },
    } as never);
    component['revalidateSentIndexes'] = [0];
    component.useRevalidation();
    expect(component.headerDiscount()).toBe(23800);
    expect(component.headerDiscountGross()).toBeTrue();
  });
});
