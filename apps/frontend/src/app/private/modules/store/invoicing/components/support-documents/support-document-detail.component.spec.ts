import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { SupportDocumentDetailComponent } from './support-document-detail.component';
import { SupportDocumentService } from '../../services/support-document.service';
import { InvoicingService } from '../../services/invoicing.service';
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
  let invoicing: {
    validateInvoice: jasmine.Spy;
    sendInvoice: jasmine.Spy;
    listNotes: jasmine.Spy;
    getInvoicePdfUrl: jasmine.Spy;
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
    invoicing = {
      validateInvoice: jasmine
        .createSpy('validateInvoice')
        .and.returnValue(of({ success: true, data: { ...doc, status: 'validated' } })),
      sendInvoice: jasmine
        .createSpy('sendInvoice')
        .and.returnValue(of({ success: true, data: { ...doc, status: 'sent' } })),
      listNotes: jasmine.createSpy('listNotes').and.returnValue(of({ success: true, data: [] })),
      getInvoicePdfUrl: jasmine.createSpy('getInvoicePdfUrl'),
    };
    dialog = { confirm: jasmine.createSpy('confirm').and.resolveTo(true) };

    // Algunos casos montan varios documentos en el mismo `it`.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SupportDocumentDetailComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: SupportDocumentService, useValue: service },
        { provide: InvoicingService, useValue: invoicing },
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

  it('muestra la OC de origen con enlace al detalle de la OC cuando existe', () => {
    const fixture = setup(baseDocument({ purchase_order: { id: 7, order_number: 'OC-0007' } }));

    const link = query(fixture, 'po-link') as HTMLAnchorElement | null;
    expect(link?.textContent).toContain('OC-0007');
    expect(link?.getAttribute('href')).toBe('/admin/orders/purchase-orders/7');
    expect(text(fixture)).toContain('Orden de compra de origen');
  });

  it('oculta la OC de origen cuando el documento no viene de una OC', () => {
    const fixture = setup(baseDocument({ purchase_order: null }));

    expect(query(fixture, 'po-link')).toBeNull();
    expect(text(fixture)).not.toContain('Orden de compra de origen');
  });

  it('lista las notas de ajuste del documento y abre su detalle', () => {
    const fixture = setup(baseDocument());
    invoicing.listNotes.and.returnValue(
      of({
        success: true,
        data: [
          { id: 201, invoice_number: 'NA201', invoice_type: 'support_adjustment_note', status: 'accepted', total_amount: '500.00' },
        ],
      }),
    );
    fixture.componentInstance.reload();
    fixture.detectChanges();
    fixture.detectChanges();

    expect(invoicing.listNotes).toHaveBeenCalledWith(100);
    const rows = (fixture.nativeElement as HTMLElement).ownerDocument.body.querySelectorAll('[data-testid="note-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('NA201');
    expect(rows[0].textContent).toContain('Aceptado');
    const opened: number[] = [];
    fixture.componentInstance.openRelated.subscribe((id) => opened.push(id));
    (query(fixture, 'note-open')?.querySelector('button') as HTMLButtonElement).click();
    expect(opened).toEqual([201]);
  });

  it('una nota de ajuste no consulta ni muestra notas propias', () => {
    const fixture = setup(
      baseDocument({ invoice_type: 'support_adjustment_note' as never, related_invoice_id: 90 }),
    );

    expect(invoicing.listNotes).not.toHaveBeenCalled();
    expect(query(fixture, 'notes-section')).toBeNull();
  });

  it('«Emitir a la DIAN» solo aparece en borrador o validado', () => {
    expect(query(setup(baseDocument({ status: 'draft' })), 'action-emit')).not.toBeNull();
    expect(query(setup(baseDocument({ status: 'validated' })), 'action-emit')).not.toBeNull();
    expect(query(setup(baseDocument({ status: 'accepted' })), 'action-emit')).toBeNull();
    expect(query(setup(baseDocument({ status: 'sent' })), 'action-emit')).toBeNull();
  });

  it('emitir un borrador valida y luego envía', () => {
    const fixture = setup(baseDocument({ status: 'draft', cufe: undefined }));

    fixture.componentInstance.emitToDian();

    expect(invoicing.validateInvoice).toHaveBeenCalledWith(100);
    expect(invoicing.sendInvoice).toHaveBeenCalledWith(100);
    expect(invoicing.validateInvoice.calls.count()).toBe(1);
  });

  it('emitir un documento ya validado solo envía', () => {
    const fixture = setup(baseDocument({ status: 'validated', cufe: undefined }));

    fixture.componentInstance.emitToDian();

    expect(invoicing.validateInvoice).not.toHaveBeenCalled();
    expect(invoicing.sendInvoice).toHaveBeenCalledWith(100);
  });

  it('un rechazo de la DIAN al emitir se muestra en el panel', () => {
    const fixture = setup(baseDocument({ status: 'validated', cufe: undefined }));
    invoicing.sendInvoice.and.returnValue(
      throwError(() => ({
        status: 422,
        error: {
          error_code: 'INVOICING_PROVIDER_004',
          message: 'rechazo',
          details: { invoice_id: 100, dian_errors: [{ code: 'FAB10a', message: 'Valor del CUDS incorrecto' }] },
        },
      })),
    );

    fixture.componentInstance.emitToDian();
    fixture.detectChanges();

    expect(text(fixture)).toContain('FAB10a');
  });

  it('el PDF se oculta en la nota de ajuste y se ofrece en el documento soporte', () => {
    expect(query(setup(baseDocument()), 'action-pdf')).not.toBeNull();
    expect(
      query(setup(baseDocument({ invoice_type: 'support_adjustment_note' as never })), 'action-pdf'),
    ).toBeNull();
  });

  it('«Descargar PDF» pide la URL firmada al endpoint de la factura', () => {
    const fixture = setup(baseDocument());
    invoicing.getInvoicePdfUrl.and.returnValue(of({ success: true, data: { url: 'https://s3/doc.pdf' } }));
    const open = spyOn(window, 'open').and.returnValue({} as Window);

    fixture.componentInstance.downloadPdf();

    expect(invoicing.getInvoicePdfUrl).toHaveBeenCalledWith(100);
    expect(open).toHaveBeenCalledWith('https://s3/doc.pdf', '_blank', 'noopener');
  });

  it('el botón de XML solo existe cuando hay xml_document', () => {
    expect(query(setup(baseDocument({ xml_document: '<Invoice/>' })), 'action-xml')).not.toBeNull();
    expect(query(setup(baseDocument({ xml_document: null })), 'action-xml')).toBeNull();
  });

  it('muestra el rechazo persistido de la DIAN con el mismo texto que la factura', () => {
    const fixture = setup(
      baseDocument({
        status: 'rejected',
        dian_status: 'rejected',
        provider_response: {
          provider_data: { dian_errors: [{ code: 'FAD06', message: 'NIT no coincide' }] },
        },
      } as Partial<SupportDocumentDetail>),
    );

    const panel = query(fixture, 'dian-rejection')?.textContent ?? '';
    expect(panel).toContain('La DIAN rechazó el documento');
    expect(panel).toContain('FAD06');
  });

  it('pinta las celdas fiscales con el helper de la factura', () => {
    const fixture = setup(
      baseDocument({ transmission_status: 'accepted', dian_status: 'accepted' } as Partial<SupportDocumentDetail>),
    );

    const cells = query(fixture, 'fiscal-cells')?.textContent ?? '';
    expect(cells).toContain('Transmisión');
    expect(cells).toContain('Aceptado por la DIAN');
  });
});
