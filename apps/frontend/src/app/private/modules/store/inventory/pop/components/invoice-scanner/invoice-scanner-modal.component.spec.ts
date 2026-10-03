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
    scanInvoiceAndWait: () => of(null),
    matchProducts: () => of(null),
  }) as unknown as InvoiceScannerService;

const buildUomStub = () =>
  ({
    getCatalog: () => of({ data: [] }),
    peekCatalog: () => null,
  }) as unknown as UomService;

/**
 * QUI-845 — quick-create desde el confirm (proveedor nuevo por OCR).
 *
 * Cubre el contrato que la revisión pidió: `pendingSupplierConfirm` →
 * `onConfirm`. El quick-create solo se abre cuando NO hay proveedor en ninguno
 * de los dos lados (ni el del carrito `currentSupplierId` ni uno elegido);
 * al crear, la confirmación continúa sola; al cancelar, re-confirmar confirma
 * con `supplierId: null` (no cambia proveedor) en vez de reabrir el modal.
 */
describe('InvoiceScannerModalComponent — QUI-845 proveedor nuevo en el confirm', () => {
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
    fixture.componentRef.setInput('orderType', 'retail');
    fixture.componentRef.setInput('currentSupplierId', null);
    fixture.detectChanges();
  });

  function primeNewSupplier(match: InvoiceMatchResult = buildMatch(true)): void {
    component.scanResult.set(buildScan());
    component.matchResult.set(match);
    component.editableItems.set([buildItem()]);
    component.aiAck.set(true);
    fixture.detectChanges();
  }

  function confirmedSpy(): jasmine.Spy {
    return spyOn(component.confirmed, 'emit');
  }

  it('(a) is_new sin proveedor en ningún lado → abre quick-create y NO emite aún', () => {
    const emit = confirmedSpy();
    primeNewSupplier();

    component.onConfirm();

    expect(emit).not.toHaveBeenCalled();
    expect(component.showSupplierCreate()).toBe(true);
    expect(component.supplierCreatePreload()).toEqual({
      name: 'Proveedor OCR S.A.S.',
      tax_id: '901234567-8',
      phone: '3001234567',
    });
    // El decline no se marca al abrir: crear el proveedor debe continuar solo.
    expect((component as any).supplierConfirmDeclined).toBe(false);
  });

  it('(b) crear el proveedor desde el quick-create completa el confirm pendiente', () => {
    const emit = confirmedSpy();
    primeNewSupplier();
    component.onConfirm();
    expect(component.supplierCreatePreload()).not.toBeNull();

    component.onSupplierCreated({
      id: 42,
      name: 'Proveedor OCR S.A.S.',
      tax_id: '901234567-8',
      state: 'active' as any,
    } as any);

    expect(component.showSupplierCreate()).toBe(false);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      jasmine.objectContaining({ supplierId: 42 }),
    );
  });

  it('(c) REGRESIÓN: is_new con proveedor en el carrito → NO abre quick-create y emite null (no cambia proveedor)', () => {
    const emit = confirmedSpy();
    fixture.componentRef.setInput('currentSupplierId', 7);
    fixture.detectChanges();
    primeNewSupplier();

    component.onConfirm();

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      jasmine.objectContaining({ supplierId: null }),
    );
    expect(component.showSupplierCreate()).toBe(false);
  });

  it('(d) cancelar el quick-create marcado como decline → re-confirmar emite null sin reabrir', () => {
    const emit = confirmedSpy();
    primeNewSupplier();

    component.onConfirm();
    expect(component.showSupplierCreate()).toBe(true);

    // El modal hijo real, al cancelar, emite isOpenChange(false) (cierra el
    // `[(isOpen)]`) y luego close → onSupplierCreateClosed.
    component.showSupplierCreate.set(false);
    component.onSupplierCreateClosed();
    expect((component as any).supplierConfirmDeclined).toBe(true);

    component.onConfirm();

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      jasmine.objectContaining({ supplierId: null }),
    );
    expect(component.showSupplierCreate()).toBe(false);
  });

  it('(e) decline se reinicia con un escaneo nuevo', () => {
    primeNewSupplier();
    component.onConfirm();
    component.onSupplierCreateClosed();
    expect((component as any).supplierConfirmDeclined).toBe(true);

    component.selectedFile.set(new File(['x'], 'factura.png'));
    component.startScan();

    expect((component as any).supplierConfirmDeclined).toBe(false);
    expect((component as any).pendingSupplierConfirm).toBe(false);
  });
});