import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { SupportDocumentDetailComponent } from './support-document-detail.component';
import { SupportDocumentService } from '../../services/support-document.service';
import { DialogService } from '../../../../../../shared/components/index';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import type {
  SupportDocumentAdjustmentSource,
  SupportDocumentDetail,
  SupportDocumentDianStatus,
} from '../../interfaces/support-document.interface';

/**
 * QUI-683 — el detalle del documento soporte muestra las acciones que la
 * política de producto permite en cada estado:
 * aceptado con CUDS → «Nota de ajuste» (no se anula); rechazado → «Anular»;
 * borrador/validado → «Descartar»; con CUDS → «Consultar en DIAN».
 */
describe('SupportDocumentDetailComponent — acciones según el estado', () => {
  const baseDocument = (overrides: Partial<SupportDocumentDetail> = {}): SupportDocumentDetail =>
    ({
      id: 100,
      organization_id: 1,
      store_id: 2,
      invoice_number: 'DS100',
      invoice_type: 'support_document',
      status: 'accepted',
      supplier_id: 50,
      customer_name: 'Proveedor No Obligado',
      customer_tax_id: '123456789',
      subtotal_amount: '1000.00',
      discount_amount: '0.00',
      tax_amount: '0.00',
      withholding_amount: '0.00',
      total_amount: '1000.00',
      send_status: 'sent_ok',
      issue_date: '2026-03-10T00:00:00.000Z',
      created_at: '2026-03-10T00:00:00.000Z',
      updated_at: '2026-03-10T00:00:00.000Z',
      cufe: 'cuds-original-abc',
      invoice_items: [
        {
          id: 1,
          invoice_id: 100,
          product_name: 'Servicio',
          description: 'Servicio de transporte',
          quantity: 1,
          unit_price: '1000.00',
          discount_amount: '0.00',
          tax_amount: '0.00',
          total_amount: '1000.00',
        },
      ],
      supplier: { id: 50, name: 'Proveedor No Obligado', tax_id: '123456789' },
      ...overrides,
    }) as unknown as SupportDocumentDetail;

  let service: {
    getById: jasmine.Spy;
    getDianStatus: jasmine.Spy;
    voidDocument: jasmine.Spy;
    cancelDocument: jasmine.Spy;
  };
  let dialog: { confirm: jasmine.Spy };

  const setup = (doc: SupportDocumentDetail): ComponentFixture<SupportDocumentDetailComponent> => {
    service = {
      getById: jasmine.createSpy('getById').and.returnValue(of({ success: true, data: doc })),
      getDianStatus: jasmine.createSpy('getDianStatus'),
      voidDocument: jasmine
        .createSpy('voidDocument')
        .and.returnValue(of({ success: true, data: { ...doc, status: 'voided' } })),
      cancelDocument: jasmine
        .createSpy('cancelDocument')
        .and.returnValue(of({ success: true, data: { ...doc, status: 'cancelled' } })),
    };
    dialog = { confirm: jasmine.createSpy('confirm').and.resolveTo(true) };

    TestBed.configureTestingModule({
      imports: [SupportDocumentDetailComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: SupportDocumentService, useValue: service },
        { provide: DialogService, useValue: dialog },
        {
          provide: ToastService,
          useValue: { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') },
        },
        {
          provide: CurrencyFormatService,
          useValue: {
            loadCurrency: () => undefined,
            currencyFormatStyle: () => 'dot_comma',
            currencyDecimals: () => 0,
            format: (v: number) => `$${Math.round(v)}`,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(SupportDocumentDetailComponent);
    fixture.componentRef.setInput('documentId', doc.id);
    fixture.componentInstance.isOpen.set(true);
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture;
  };

  const query = (fixture: ComponentFixture<unknown>, testId: string): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`) ??
    document.body.querySelector(`[data-testid="${testId}"]`);

  const text = (fixture: ComponentFixture<unknown>): string =>
    ((fixture.nativeElement as HTMLElement).textContent ?? '') + (document.body.textContent ?? '');

  it('hidrata el detalle con GET :id y muestra los datos y el CUDS', () => {
    const fixture = setup(baseDocument());

    expect(service.getById).toHaveBeenCalledWith(100);
    expect(query(fixture, 'doc-cuds')?.textContent).toContain('cuds-original-abc');
    expect(query(fixture, 'doc-status')?.textContent).toContain('Aceptado');
    expect(text(fixture)).toContain('Proveedor No Obligado');
    expect(text(fixture)).toContain('Servicio de transporte');
  });

  it('aceptado con CUDS: ofrece «Nota de ajuste» y «Consultar en DIAN», nunca «Anular»', () => {
    const fixture = setup(baseDocument());

    expect(query(fixture, 'action-adjust')?.textContent).toContain('Nota de ajuste');
    expect(query(fixture, 'action-query-dian')?.textContent).toContain('Consultar en DIAN');
    expect(query(fixture, 'action-void')).toBeNull();
    expect(query(fixture, 'action-discard')).toBeNull();
    expect(text(fixture)).toContain('no se anula');
  });

  it('rechazado: ofrece «Anular» y no la nota de ajuste', () => {
    const fixture = setup(baseDocument({ status: 'rejected' }));

    expect(query(fixture, 'action-void')?.textContent).toContain('Anular');
    expect(query(fixture, 'action-adjust')).toBeNull();
    expect(query(fixture, 'action-discard')).toBeNull();
  });

  it('borrador sin CUDS: solo «Descartar»; no hay nada que consultar en la DIAN', () => {
    const fixture = setup(baseDocument({ status: 'draft', cufe: undefined }));

    expect(query(fixture, 'action-discard')?.textContent).toContain('Descartar');
    expect(query(fixture, 'action-query-dian')).toBeNull();
    expect(query(fixture, 'action-void')).toBeNull();
    expect(query(fixture, 'action-adjust')).toBeNull();
    expect(text(fixture)).toContain('Sin CUDS');
  });

  it('una nota de ajuste aceptada no ofrece otra nota de ajuste ni anularse', () => {
    const fixture = setup(
      baseDocument({ invoice_type: 'support_adjustment_note' as never, related_invoice_id: 90 }),
    );

    expect(query(fixture, 'action-adjust')).toBeNull();
    expect(query(fixture, 'action-void')).toBeNull();
    expect(query(fixture, 'action-query-dian')).not.toBeNull();
  });

  it('«Nota de ajuste» emite el original prellenado y cierra el detalle', () => {
    const fixture = setup(baseDocument());
    const emitted: SupportDocumentAdjustmentSource[] = [];
    fixture.componentInstance.adjust.subscribe((value) => emitted.push(value));

    query(fixture, 'action-adjust')?.querySelector('button')?.click();

    expect(emitted).toEqual([{ id: 100, invoice_number: 'DS100', supplier_id: 50 }]);
    expect(fixture.componentInstance.isOpen()).toBeFalse();
  });

  it('«Consultar en DIAN» muestra el estado mapeado por el backend', () => {
    const fixture = setup(baseDocument());
    const status: SupportDocumentDianStatus = {
      invoice_id: 100,
      invoice_number: 'DS100',
      invoice_type: 'support_document',
      document_key: 'cuds-original-abc',
      document_key_label: 'CUDS',
      local_status: 'accepted',
      dian_status: 'accepted',
      dian_status_code: '00',
      message: 'Procesado Correctamente.',
      rules: [{ code: 'RUT01', text: 'Responsabilidad no informada', severity: 'notificacion' }],
      checked_at: '2026-03-12T15:00:00.000Z',
    };
    service.getDianStatus.and.returnValue(of({ success: true, data: status }));

    fixture.componentInstance.queryDian();
    fixture.detectChanges();

    expect(service.getDianStatus).toHaveBeenCalledWith(100);
    const result = query(fixture, 'dian-result')?.textContent ?? '';
    expect(result).toContain('Aceptado por la DIAN');
    expect(result).toContain('Procesado Correctamente.');
    expect(result).toContain('RUT01');
  });

  it('una DIAN sin respuesta se muestra como no disponible, no como rechazo', () => {
    const fixture = setup(baseDocument());
    service.getDianStatus.and.returnValue(
      of({
        success: true,
        data: {
          invoice_id: 100,
          invoice_number: 'DS100',
          invoice_type: 'support_document',
          document_key: 'cuds-original-abc',
          document_key_label: 'CUDS',
          local_status: 'accepted',
          dian_status: 'unavailable',
          dian_status_code: 'PARSE_ERROR',
          message: null,
          rules: [],
          checked_at: '2026-03-12T15:00:00.000Z',
        } satisfies SupportDocumentDianStatus,
      }),
    );

    fixture.componentInstance.queryDian();
    fixture.detectChanges();

    const result = query(fixture, 'dian-result')?.textContent ?? '';
    expect(result).toContain('La DIAN no respondió');
    expect(result).not.toContain('No válido');
  });

  it('«Anular» confirma, anula el rechazado y avisa al listado', async () => {
    const fixture = setup(baseDocument({ status: 'rejected' }));
    let changed = 0;
    fixture.componentInstance.changed.subscribe(() => changed++);

    await fixture.componentInstance.voidDocument();

    expect(dialog.confirm).toHaveBeenCalled();
    expect(service.voidDocument).toHaveBeenCalledWith(100);
    expect(changed).toBe(1);
  });
});
