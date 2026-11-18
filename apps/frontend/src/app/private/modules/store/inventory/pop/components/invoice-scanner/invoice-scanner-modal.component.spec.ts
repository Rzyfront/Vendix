import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';

import { InvoiceScannerModalComponent } from './invoice-scanner-modal.component';
import { InvoiceScannerService } from '../../services/invoice-scanner.service';
import { AiScanJobError } from '../../../../../../../core/utils/ai-job-error';
import { AiScanJobService } from '../../../../../../../core/services/ai-scan-job.service';
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
    scanEnqueueUrl: () => '/scan/async',
    scanStatusUrl: (id: string) => `/scan/async/${id}`,
    scanFormData: () => new FormData(),
    revalidateEnqueueUrl: () => '/scan/revalidate',
    revalidateStatusUrl: (id: string) => `/scan/revalidate/${id}`,
    matchProducts: () => of(null),
  }) as unknown as InvoiceScannerService;

/** `AiScanJobService` doble: la espera real se prueba en su propio spec. */
const buildAiScanJobsStub = () => ({
  enqueueAndWait: () => of(null),
  resume: () => null,
});

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
        { provide: AiScanJobService, useValue: buildAiScanJobsStub() },
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
/**
 * QUI-1020 — la espera del escaneo es de `AiScanJobService`: el modal solo
 * pinta la barra, conserva el archivo al fallar y retoma el trabajo en curso.
 */
describe('InvoiceScannerModalComponent — QUI-1020 barra, reintento y reenganche', () => {
  let fixture: ComponentFixture<InvoiceScannerModalComponent>;
  let component: InvoiceScannerModalComponent;
  let jobs: {
    enqueueAndWait: jasmine.Spy;
    resume: jasmine.Spy;
  };

  const FILE = () => new File(['x'], 'factura.pdf', { type: 'application/pdf' });

  function setup(): void {
    const scanner = {
      ...buildScannerStub(),
      matchProducts: () => of({ success: true, data: buildMatch(false) }),
    };
    TestBed.configureTestingModule({
      imports: [InvoiceScannerModalComponent],
      providers: [
        { provide: InvoiceScannerService, useValue: scanner },
        { provide: AiScanJobService, useValue: jobs },
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
  }

  beforeEach(() => {
    jobs = {
      enqueueAndWait: jasmine.createSpy('enqueueAndWait'),
      resume: jasmine.createSpy('resume').and.returnValue(null),
    };
  });

  it('un escaneo fallido deja el archivo, muestra el panel con reintento y no vuelve al paso 1', () => {
    jobs.enqueueAndWait.and.callFake(
      (_u: string, _b: unknown, opts: { progress: { onUploadStart(): void; onFailed(e: unknown): void } }) => {
        opts.progress.onUploadStart();
        const err = new AiScanJobError('Algo falló en Vendix', 'technical', 'X_001');
        opts.progress.onFailed(err);
        return throwError(() => err);
      },
    );
    setup();
    const file = FILE();
    component.selectedFile.set(file);
    component.startScan();
    fixture.detectChanges();

    expect(component.selectedFile()).toBe(file);
    expect(component.currentStep()).toBe(2);
    expect(component.isScanning()).toBe(false);
    expect(component.scanProgress.phase()).toBe('failed');
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="ai-job-error"]')).not.toBeNull();

    component.backToFileSelection();
    expect(component.currentStep()).toBe(1);
    expect(component.selectedFile()).toBe(file);
  });

  it('encola con la clave de reenganche y el estado propio de la cola', () => {
    jobs.enqueueAndWait.and.returnValue(of(buildScan()));
    setup();
    component.selectedFile.set(FILE());
    component.startScan();

    const [url, , opts] = jobs.enqueueAndWait.calls.mostRecent().args;
    expect(url).toBe('/scan/async');
    expect(opts.resumeKey).toBe('po_invoice_scan:new');
    expect(opts.statusUrl('3')).toBe('/scan/async/3');
    expect(opts.progress).toBe(component.scanProgress);
    expect(component.currentStep()).toBe(3);
  });

  it('al abrir retoma el escaneo en curso y llega a la revisión sin archivo', () => {
    jobs.resume.and.callFake(
      (): Observable<InvoiceScanResult> => of(buildScan()),
    );
    setup();

    expect(jobs.resume).toHaveBeenCalledWith(
      'po_invoice_scan:new',
      jasmine.objectContaining({ progress: component.scanProgress }),
    );
    expect(component.selectedFile()).toBeNull();
    expect(component.currentStep()).toBe(3);
    expect(component.scanResult()).toEqual(buildScan());
  });
});
