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

// ---------------------------------------------------------------------------
// FIXTURES
// ---------------------------------------------------------------------------

function buildScan(): InvoiceScanResult {
  return {
    supplier: {
      name: 'Proveedor OCR S.A.S.',
      tax_id: '901234567-8',
      phone: '3001234567',
    },
    invoice_number: 'FV-0001',
    invoice_date: '2026-09-20',
    line_items: [],
    subtotal: 11800,
    tax_amount: 0,
    total: 11800,
    confidence: 0.9,
  };
}

function buildItem(): MatchedLineItem {
  return {
    description: 'Producto escaneado',
    quantity: 1,
    unit_price: 11800,
    total: 11800,
    tax_rate: 0,
    match_status: 'new',
    candidates: [],
  };
}

function buildMatch(isNew: boolean): InvoiceMatchResult {
  return {
    supplier_match: {
      name: 'Proveedor OCR S.A.S.',
      tax_id: '901234567-8',
      confidence: 0.6,
      is_new: isNew,
    },
    items: [buildItem()],
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// STUBS — mismos contratos que usa el template real (InputComponent pide la
// señal de moneda al montar inputs; sin estos el setup explota antes de tocar
// una línea de lógica del modal).
// ---------------------------------------------------------------------------

const buildCurrencyStub = () =>
  ({
    loadCurrency: () => Promise.resolve(null),
    format: (n: number | string | null | undefined) =>
      `$${Number(n ?? 0).toFixed(2)}`,
    currencyFormatStyle: () => 'comma_dot' as const,
    currencyDecimals: () => 2,
  }) as unknown as CurrencyFormatService;

const buildToastStub = () =>
  ({
    success: () => undefined,
    error: () => undefined,
  }) as unknown as ToastService;

const buildSuppliersStub = () =>
  ({
    getSuppliers: () => of({ data: [] }),
    createSupplier: () => of({ data: {} }),
  }) as unknown as SuppliersService;

const buildProductsStub = () =>
  ({
    getProducts: () => of({ data: [] }),
  }) as unknown as ProductsService;

const buildScannerStub = () =>
  ({
    scanInvoice: () => of(null),
    matchProducts: () => of(null),
  }) as unknown as InvoiceScannerService;

const buildUomStub = () =>
  ({
    getCatalog: () => of({ data: [] }),
    peekCatalog: () => null,
  }) as unknown as UomService;


describe('InvoiceScannerModalComponent — QUI-855 multi-impuesto por línea', () => {
  let fixture: ComponentFixture<InvoiceScannerModalComponent>;
  let component: InvoiceScannerModalComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [InvoiceScannerModalComponent],
      providers: [
        { provide: InvoiceScannerService, useFactory: buildScannerStub },
        { provide: UomService, useFactory: buildUomStub },
        { provide: ToastService, useFactory: buildToastStub },
        { provide: SuppliersService, useFactory: buildSuppliersStub },
        { provide: ProductsService, useFactory: buildProductsStub },
        { provide: CurrencyFormatService, useFactory: buildCurrencyStub },
      ],
    });
    fixture = TestBed.createComponent(InvoiceScannerModalComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
  });

  function prime(item: MatchedLineItem, scan: Partial<InvoiceScanResult> = {}): void {
    component.scanResult.set({ ...buildScan(), ...scan });
    component.matchResult.set(buildMatch(false));
    component.editableItems.set([item]);
    component.aiAck.set(true);
    fixture.detectChanges();
  }

  function multiItem(): MatchedLineItem {
    return {
      ...buildItem(),
      quantity: 1,
      unit_price: 1000,
      unit_price_gross: 1270,
      tax_rate: 0.19,
      taxes: [
        { tax_type: 'iva', tax_rate: 19, calc_mode: 'percent', fixed_amount_per_unit: null, amount_override: null, is_inclusive: true },
        { tax_type: 'inc', tax_rate: 8, calc_mode: 'percent', fixed_amount_per_unit: null, amount_override: null, is_inclusive: true },
      ],
    };
  }

  it('línea sin taxes: chip IVA desde tax_rate ×100', () => {
    prime({ ...buildItem(), tax_rate: 0.19 });
    expect(component.taxChips()[0].map((c) => c.label)).toEqual(['IVA 19 %']);
  });

  it('línea con IVA + INC: dos chips y editor sobre el bruto impreso', () => {
    prime(multiItem(), { prices_include_tax: true });
    expect(component.taxChips()[0].map((c) => c.label)).toEqual(['IVA 19 %', 'INC 8 %']);
    const panel = component.taxPanelData()[0];
    expect(panel.unit_price).toBe(1270);
    expect(panel.include).toBe(true);
    // 1270 incluido: neto 1000, impuestos 270.
    expect(component.lineTaxRows()[0].net_line).toBe(1000);
    expect(component.lineTaxRows()[0].tax_amount).toBe(270);
  });

  it('legacy: cambiar sólo la tasa del IVA sigue en camino legacy', () => {
    prime({ ...buildItem(), tax_rate: 0.19 });
    component.onLineTaxesChange(0, [
      { tax_type: 'iva', tax_rate: 5, calc_mode: 'percent', add_to_cost: false },
    ]);
    const item = component.editableItems()[0];
    expect(item.tax_rate).toBe(0.05);
    expect(item.taxes).toBeUndefined();
  });

  it('legacy: agregar INC pasa a multi-impuesto con el neto como base', () => {
    prime({ ...buildItem(), unit_price: 1000, tax_rate: 0.19 });
    component.onLineTaxesChange(0, [
      { tax_type: 'iva', tax_rate: 19, calc_mode: 'percent', add_to_cost: false },
      { tax_type: 'inc', tax_rate: 8, calc_mode: 'percent', add_to_cost: true },
    ]);
    const item = component.editableItems()[0];
    expect(item.taxes?.length).toBe(2);
    expect(item.unit_price_gross).toBe(1000);
    expect(item.prices_include_tax).toBe(false);
  });

  it('editar el precio de una línea multi-impuesto escribe el bruto', () => {
    prime(multiItem());
    component.updateItemPrice(0, { target: { value: '1500' } } as unknown as Event);
    const item = component.editableItems()[0];
    expect(item.unit_price_gross).toBe(1500);
    expect(item.unit_price).toBe(1000);
  });

  it('descuento en dinero sincroniza el % y el monto impreso gana', () => {
    prime({ ...multiItem(), quantity: 1 }, { prices_include_tax: true });
    component.updateItemDiscountAmount(0, { target: { value: '127' } } as unknown as Event);
    const item = component.editableItems()[0];
    expect(item.discount_amount_printed).toBe(127);
    expect(item.discount_percentage).toBeCloseTo(10, 5);
    component.updateItemDiscountPercent(0, { target: { value: '5' } } as unknown as Event);
    expect(component.editableItems()[0].discount_amount_printed).toBeNull();
  });

  it('onConfirm emite las líneas editadas y el adjunto del escaneo', () => {
    const emit = spyOn(component.confirmed, 'emit');
    const att = { key: 'k', file_name: 'f.pdf', file_type: 'application/pdf', file_size: 1 };
    prime(multiItem(), { scan_attachment: att });
    component.onConfirm();
    expect(emit).toHaveBeenCalledTimes(1);
    const arg = emit.calls.mostRecent().args[0] as any;
    expect(arg.scanAttachment).toEqual(att);
    expect(arg.editedItems[0].taxes.length).toBe(2);
    expect(arg.editedItems[0].unit_price_gross).toBe(1270);
  });

  // ---- Descuento por línea en % o $ (el monto gana, como en el kernel) ----

  function scanWith(item: MatchedLineItem): void {
    const scanner = TestBed.inject(InvoiceScannerService) as any;
    scanner.scanInvoice = () => of({ success: true, data: buildScan() });
    scanner.matchProducts = () =>
      of({ success: true, data: { ...buildMatch(false), items: [item] } });
    component.selectedFile.set(new File(['x'], 'factura.png'));
    component.startScan();
    fixture.detectChanges();
  }

  it('escaneo con monto 762 y % 19 (IVA mal leído) sobre 84 x 1370: gana el monto, unidad $', () => {
    scanWith({
      ...buildItem(),
      quantity: 84,
      unit_price: 1370,
      discount_amount: 762,
      discount_percentage: 19,
    });
    const item = component.editableItems()[0];
    expect(component.discountUnit(0, item)).toBe('amount');
    expect(component.discountInputValue(0, item)).toBe(762);
    expect(component.ownDiscountMoney(item)).toBe(762);
    // net_line = 115.080 - 762
    expect(component.lineTaxRows()[0].net_line).toBe(114318);
  });

  it('escaneo multi-impuesto con monto impreso 762 y % 19: gana el monto', () => {
    scanWith({
      ...multiItem(),
      quantity: 84,
      unit_price: 1000,
      unit_price_gross: 1370,
      discount_amount_printed: 762,
      discount_percentage: 19,
    });
    const item = component.editableItems()[0];
    expect(component.discountUnit(0, item)).toBe('amount');
    expect(component.discountInputValue(0, item)).toBe(762);
    expect(item.discount_percentage).toBeCloseTo((762 / 115080) * 100, 5);
  });

  it('escaneo con solo 10 %: unidad % y valor 10', () => {
    scanWith({ ...buildItem(), quantity: 1, unit_price: 1000, discount_percentage: 10 });
    const item = component.editableItems()[0];
    expect(component.discountUnit(0, item)).toBe('pct');
    expect(component.discountInputValue(0, item)).toBe(10);
  });

  it('monto y % coherentes (redondeo del % impreso): se conserva el %', () => {
    scanWith({
      ...buildItem(),
      quantity: 84,
      unit_price: 1370,
      discount_amount: 759.5,
      discount_percentage: 0.66,
    });
    expect(component.editableItems()[0].discount_percentage).toBe(0.66);
  });

  it('cambiar de unidad conserva el descuento efectivo', () => {
    prime({ ...buildItem(), quantity: 2, unit_price: 500, discount_percentage: 10 });
    const before = component.lineTaxRows()[0].net_line;
    const item = () => component.editableItems()[0];
    expect(component.discountInputValue(0, item())).toBe(10);
    component.setDiscountUnit(0, 'amount');
    expect(component.discountInputValue(0, item())).toBe(100);
    component.setDiscountUnit(0, 'pct');
    expect(component.discountInputValue(0, item())).toBe(10);
    expect(component.lineTaxRows()[0].net_line).toBe(before);
  });

  it('en unidad $ el input edita el monto y deriva el %', () => {
    prime({ ...buildItem(), quantity: 1, unit_price: 1000 });
    component.setDiscountUnit(0, 'amount');
    component.updateItemDiscountAmount(0, { target: { value: '250.5' } } as unknown as Event);
    const item = component.editableItems()[0];
    expect(component.ownDiscountMoney(item)).toBe(250.5);
    expect(item.discount_percentage).toBeCloseTo(25.05, 5);
  });

  it('el panel de impuestos ya no trae el input Descuento $', () => {
    prime(multiItem());
    component.expandedTaxRow.set(0);
    fixture.detectChanges();
    const html = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(html).not.toContain('Descuento $');
  });
});
