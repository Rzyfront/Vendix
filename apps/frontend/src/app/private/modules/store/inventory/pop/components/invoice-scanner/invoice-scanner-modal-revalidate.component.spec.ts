import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';

import { InvoiceScannerModalComponent } from './invoice-scanner-modal.component';
import { InvoiceScannerService } from '../../services/invoice-scanner.service';
import { UomService } from '../../../services/uom.service';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { SuppliersService } from '../../../services/suppliers.service';
import { ProductsService } from '../../../../products/services/products.service';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import {
  InvoiceMatchResult,
  InvoiceRevalidateResult,
  InvoiceScanResult,
  MatchedLineItem,
} from '../../interfaces/invoice-scanner.interface';

function buildScan(withAttachment = true): InvoiceScanResult {
  return {
    supplier: { name: 'Proveedor OCR S.A.S.' },
    invoice_number: 'FV-0001',
    invoice_date: '2026-09-20',
    line_items: [],
    scan_attachment: withAttachment
      ? { key: 'scans/a.pdf', file_name: 'factura-a.pdf', file_type: 'application/pdf', file_size: 10 }
      : null,
    subtotal: 2000,
    tax_amount: 0,
    total: 2000,
    confidence: 0.9,
  };
}

function buildItem(over: Partial<MatchedLineItem> = {}): MatchedLineItem {
  return {
    description: 'Arroz',
    quantity: 2,
    unit_price: 1000,
    total: 2000,
    tax_rate: 0,
    discount_percentage: 0,
    match_status: 'matched',
    selected_product_id: 7,
    candidates: [{ id: 7, name: 'Arroz 500g', sku: 'A1', confidence: 90 }],
    ...over,
  };
}

function buildMatch(): InvoiceMatchResult {
  return {
    supplier_match: { name: 'Proveedor OCR S.A.S.', confidence: 0.9, is_new: false, matched_id: 1 },
    items: [buildItem()],
    warnings: [],
  };
}

function buildResult(): InvoiceRevalidateResult {
  return {
    consolidated: {
      supplier: { name: 'Proveedor OCR S.A.S.' },
      invoice_number: 'FV-0001',
      invoice_date: '2026-09-20',
      line_items: [
        { description: 'ARROZ IA', quantity: 5, unit_price: 900, total: 4500, tax_rate: 0, discount_percentage: 0 },
      ],
      subtotal: 4500,
      tax_amount: 0,
      total: 4500,
      confidence: 0.95,
    },
    report: {
      summary: 'Se corrigió la cantidad de la línea 1.',
      confidence: 'medium',
      findings: [{ severity: 'warning', message: 'Cantidad borrosa' }],
      red_flags: [{ message: 'Total no cuadra', line_index: 0 }],
      divergences: [
        {
          line_index: 0,
          field: 'quantity',
          consolidated_value: 2,
          document_value: 5,
          revalidated_value: 5,
          reason: 'El documento dice 5',
        },
      ],
    },
  };
}

describe('InvoiceScannerModalComponent — QUI-855 paso 8b revalidación con IA', () => {
  let fixture: ComponentFixture<InvoiceScannerModalComponent>;
  let component: InvoiceScannerModalComponent;
  let revalidate$: Subject<InvoiceRevalidateResult>;
  let revalidateSpy: jasmine.Spy;

  beforeEach(() => {
    revalidate$ = new Subject<InvoiceRevalidateResult>();
    revalidateSpy = jasmine.createSpy('revalidateAndWait').and.callFake(() => revalidate$.asObservable());
    TestBed.configureTestingModule({
      imports: [InvoiceScannerModalComponent],
      providers: [
        {
          provide: InvoiceScannerService,
          useValue: { scanInvoiceAndWait: () => of(null), matchProducts: () => of(null), revalidateAndWait: revalidateSpy },
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

  function prime(withAttachment = true): void {
    component.scanResult.set(buildScan(withAttachment));
    component.matchResult.set(buildMatch());
    component.editableItems.set([buildItem()]);
    component.currentStep.set(3);
    component.editInvoiceNumber = 'FV-0001';
    fixture.detectChanges();
  }

  const text = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';

  function goToResult(): void {
    prime();
    component.onRevalidateToggle(true);
    component.openRevalidateSummary();
    component.onRevalidateNoteChange('la cantidad es 5');
    component.sendRevalidate();
    revalidate$.next(buildResult());
    fixture.detectChanges();
  }

  it('el checkbox cambia el CTA de «Agregar al Carrito» a «Revalidar»', () => {
    prime();
    expect(text()).toContain('Agregar al Carrito');
    expect(text()).not.toContain('Revalidar datos consolidados con IA Revalidar');
    component.onRevalidateToggle(true);
    fixture.detectChanges();
    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('app-button')).map((b) =>
      (b.textContent ?? '').trim(),
    );
    expect(buttons).toContain('Revalidar');
    expect(buttons).not.toContain('Agregar al Carrito');
  });

  it('sin scan_attachment el checkbox queda deshabilitado con su texto', () => {
    prime(false);
    expect(component.canRevalidate()).toBeFalse();
    component.onRevalidateToggle(true);
    expect(component.revalidateChecked()).toBeFalse();
    expect(text()).toContain('El documento original no se guardó; no se puede revalidar');
  });

  it('el resumen muestra líneas, total y nombre del documento', () => {
    prime();
    component.onRevalidateToggle(true);
    component.openRevalidateSummary();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="revalidate-summary-lines"]')?.textContent?.trim()).toBe('1');
    expect(root.querySelector('[data-testid="revalidate-summary-file"]')?.textContent).toContain('factura-a.pdf');
    expect(text()).toContain('Enviar a revalidar');
  });

  it('enviar llama al servicio con key, consolidated y nota', () => {
    prime();
    component.onRevalidateToggle(true);
    component.openRevalidateSummary();
    component.onRevalidateNoteChange('la cantidad es 5');
    component.sendRevalidate();
    fixture.detectChanges();

    expect(revalidateSpy).toHaveBeenCalledTimes(1);
    const arg = revalidateSpy.calls.mostRecent().args[0];
    expect(arg.scan_attachment_key).toBe('scans/a.pdf');
    expect(arg.note).toBe('la cantidad es 5');
    expect(arg.order_type).toBe('retail');
    expect(arg.consolidated.invoice_number).toBe('FV-0001');
    expect(arg.consolidated.line_items.length).toBe(1);
    expect(arg.consolidated.line_items[0].quantity).toBe(2);
    expect(arg.consolidated.scan_attachment).toBeUndefined();
    expect(component.revalidateView()).toBe('loading');
    expect(text()).toContain('La IA está releyendo el documento original');
  });

  it('un error muestra mensaje en español y permite reintentar', () => {
    prime();
    component.onRevalidateToggle(true);
    component.openRevalidateSummary();
    component.sendRevalidate();
    revalidate$.error(new Error('La revalidación tardó demasiado. Intenta nuevamente.'));
    fixture.detectChanges();
    expect(component.revalidateView()).toBe('error');
    expect(text()).toContain('La revalidación tardó demasiado');
    expect(text()).toContain('Reintentar');
    expect(text()).toContain('Volver a la precarga');
  });

  it('completado muestra resumen, alertas, hallazgos y divergencias', () => {
    goToResult();
    expect(component.revalidateView()).toBe('result');
    const t = text();
    expect(t).toContain('Se corrigió la cantidad de la línea 1.');
    expect(t).toContain('Confianza media');
    expect(t).toContain('Total no cuadra');
    expect(t).toContain('Cantidad borrosa');
    expect(t).toContain('El documento dice 5');
    expect(t).toContain('Cantidad');
    expect(t).not.toContain('quantity');
    expect(t).toContain('Usar revalidación');
    expect(t).toContain('Mantener precarga');
    expect(t).toContain('Editar manualmente');
  });

  it('oculta las divergencias sin diferencia y cuenta solo las reales', () => {
    const taxes = [{ type: 'iva', rate: 19, fixed_amount_per_unit: null, amount: null, inclusive: false }];
    const res = buildResult();
    const noise = Array.from({ length: 3 }, () => ({
      line_index: 0,
      field: 'taxes',
      consolidated_value: taxes,
      document_value: taxes,
      revalidated_value: taxes,
      reason: 'igual',
    }));
    res.report.divergences.push(...noise);
    prime();
    component.onRevalidateToggle(true);
    component.openRevalidateSummary();
    component.sendRevalidate();
    revalidate$.next(res);
    fixture.detectChanges();
    const t = text();
    expect(t).toContain('Divergencias (1)');
    expect(t).toContain('3 campos verificados sin diferencias');
    expect(t).not.toContain('"type"');
  });

  it('«Usar revalidación» aplica el merge, marca la línea y resetea el ack', () => {
    goToResult();
    component.aiAck.set(true);
    component.useRevalidation();
    fixture.detectChanges();

    const item = component.editableItems()[0];
    expect(item.quantity).toBe(5);
    expect(item.unit_price).toBe(900);
    expect(item.description).toBe('Arroz');
    expect(item.selected_product_id).toBe(7);
    expect(item.revalidation).toBe('changed');
    expect(component.revalidateView()).toBe('review');
    expect(component.revalidateChecked()).toBeFalse();
    expect(component.aiAck()).toBeFalse();
    expect(text()).toContain('Revalidado');
    expect(text()).toContain('Agregar al Carrito');
  });

  it('«Mantener precarga» no cambia las líneas y resetea checkbox y ack', () => {
    goToResult();
    component.aiAck.set(true);
    component.keepPreload();
    fixture.detectChanges();

    const item = component.editableItems()[0];
    expect(item.quantity).toBe(2);
    expect(item.unit_price).toBe(1000);
    expect(item.revalidation).toBeUndefined();
    expect(component.revalidateView()).toBe('review');
    expect(component.revalidateChecked()).toBeFalse();
    expect(component.aiAck()).toBeFalse();
  });

  it('«Editar manualmente» vuelve sin cambios, desmarca y resetea el ack', () => {
    goToResult();
    component.aiAck.set(true);
    component.editManually();
    fixture.detectChanges();

    expect(component.editableItems()[0].quantity).toBe(2);
    expect(component.revalidateView()).toBe('review');
    expect(component.revalidateChecked()).toBeFalse();
    expect(component.aiAck()).toBeFalse();
  });
});
