import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';

import {
  PrintFormatType,
  StorePrintFormatDetail,
} from '../../../core/models/print-formats.model';
import { StoreSettingsFacade } from '../../../core/store/store-settings/store-settings.facade';
import { DocumentPrintService } from './document-print.service';
import { PrintGatewayClientService } from './print-gateway-client.service';
import { MmToPxService } from './mm-to-px.service';

describe('DocumentPrintService Print Formats gates', () => {
  let service: DocumentPrintService;
  let gateway: jasmine.SpyObj<PrintGatewayClientService>;
  let settings: { receipts: jasmine.Spy; pos: jasmine.Spy };

  const formatDetail = (
    formatType: PrintFormatType,
    options: { active?: boolean; autoPrint?: boolean } = {},
  ): StorePrintFormatDetail =>
    ({
      format_type: formatType,
      name: formatType,
      category: 'Test',
      is_active: options.active ?? true,
      gateway_enabled: true,
      is_customized: false,
      template_id: null,
      template_name: null,
      definition: {
        paper: {
          format: 'thermal_80',
          width_mm: 80,
          is_roll: true,
          copies: 1,
          auto_print: options.autoPrint,
        },
        sections: [],
      },
      overrides: null,
      available_tokens: [],
    }) as StorePrintFormatDetail;

  const resolved = (formatType: PrintFormatType) => ({
    format_type: formatType,
    document_id: 81,
    engine: 'html' as const,
    reason: 'no_fiscal_activation' as const,
    requires_invoice_emission: false,
  });

  beforeEach(() => {
    gateway = jasmine.createSpyObj<PrintGatewayClientService>(
      'PrintGatewayClientService',
      ['getFormatDetail', 'resolveDocument', 'renderDocument'],
    );
    settings = {
      // Stale legacy aliases intentionally remain true: Print Formats must win.
      receipts: jasmine.createSpy('receipts').and.returnValue({
        print_pos_ticket: true,
        print_receipt: true,
      }),
      pos: jasmine.createSpy('pos').and.returnValue({ auto_print_receipt: true }),
    };

    TestBed.configureTestingModule({
      providers: [
        DocumentPrintService,
        { provide: PrintGatewayClientService, useValue: gateway },
        { provide: StoreSettingsFacade, useValue: settings },
        { provide: MmToPxService, useValue: {} },
      ],
    });
    service = TestBed.inject(DocumentPrintService);
    spyOn(service as any, 'sendToPrinter').and.resolveTo();
  });

  it('blocks automatic printing when paper.auto_print is false despite legacy POS flags being true', async () => {
    gateway.getFormatDetail.and.returnValue(of(formatDetail('pos_sale_ticket', { autoPrint: false })));
    const fallback = jasmine.createSpy('fallback').and.resolveTo({
      documents: 1,
      pages: 1,
      copies: 1,
      format: 'thermal_80',
    });
    spyOn(service, 'print').and.callFake(fallback as any);

    const result = await service.printViaGateway({
      formatType: 'pos_sale_ticket',
      documentId: 81,
      trigger: 'automatic',
      fallbackRequest: { document: 'pos_ticket', body: '<p>POS</p>' },
    });

    expect(result).toEqual({ documents: 0, pages: 0, copies: 0, format: 'pos_sale_ticket' as any });
    expect(settings.pos).not.toHaveBeenCalled();
    expect(settings.receipts).not.toHaveBeenCalled();
    expect(gateway.renderDocument).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('does not send dispatch to the local fallback when its automatic format is disabled', async () => {
    gateway.getFormatDetail.and.returnValue(
      of(formatDetail('dispatch_ticket', { active: true, autoPrint: false })),
    );
    const localPrint = spyOn(service, 'print');

    const result = await service.printViaGateway({
      formatType: 'dispatch_ticket',
      documentId: 81,
      trigger: 'automatic',
      fallbackRequest: { document: 'dispatch_ticket', body: '<p>Dispatch</p>' },
    });

    expect(result?.documents).toBe(0);
    expect(gateway.renderDocument).not.toHaveBeenCalled();
    expect(localPrint).not.toHaveBeenCalled();
  });

  it('fails closed when the Print Format is inactive', async () => {
    gateway.getFormatDetail.and.returnValue(of(formatDetail('dispatch_ticket', { active: false })));
    expect(await service.canAutoPrint('dispatch_ticket')).toBeFalse();
  });

  it('reads the current Print Format each time instead of caching a prior auto-print choice', async () => {
    gateway.getFormatDetail.and.returnValues(
      of(formatDetail('dispatch_ticket', { autoPrint: false })),
      of(formatDetail('dispatch_ticket', { autoPrint: true })),
    );

    expect(await service.canAutoPrint('dispatch_ticket')).toBeFalse();
    expect(await service.canAutoPrint('dispatch_ticket')).toBeTrue();
    expect(gateway.getFormatDetail).toHaveBeenCalledTimes(2);
  });

  it('allows auto-print when paper.auto_print is absent (legacy Print Formats default)', async () => {
    gateway.getFormatDetail.and.returnValue(of(formatDetail('dispatch_ticket')));

    expect(await service.canAutoPrint('dispatch_ticket')).toBeTrue();
    expect(gateway.getFormatDetail).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the current Print Format cannot be loaded', async () => {
    gateway.getFormatDetail.and.returnValue(throwError(() => new Error('offline')));
    expect(await service.canAutoPrint('dispatch_ticket')).toBeFalse();
  });

  it('allows explicit manual printing with auto_print off without querying the auto gate', async () => {
    gateway.renderDocument.and.returnValue(of({ html: '<html>ticket</html>', copies: 1 } as any));
    const result = await service.printViaGateway({
      formatType: 'dispatch_ticket',
      documentId: 81,
      trigger: 'explicit',
    });

    expect(result?.documents).toBe(1);
    expect(gateway.getFormatDetail).not.toHaveBeenCalled();
    expect((service as any).sendToPrinter).toHaveBeenCalledWith('<html>ticket</html>');
  });

  it('does not bypass an inactive format with the local dispatch fallback after HTTP 403', async () => {
    gateway.renderDocument.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 403 })),
    );
    const fallback = jasmine.createSpy('fallback');
    spyOn(service, 'print').and.callFake(fallback as any);

    const result = await service.printViaGateway({
      formatType: 'dispatch_ticket',
      documentId: 81,
      trigger: 'explicit',
      fallbackRequest: { document: 'dispatch_ticket', body: '<p>Dispatch</p>' },
    });

    expect(result).toBeNull();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('uses the final fiscal-resolved format for the document auto-print gate', async () => {
    gateway.resolveDocument.and.returnValue(of(resolved('fiscal_electronic_invoice')) as any);
    gateway.getFormatDetail.and.returnValue(
      of(formatDetail('fiscal_electronic_invoice', { autoPrint: false })),
    );

    expect(await service.canAutoPrintDocument('pos_order', 81)).toBeFalse();
    expect(gateway.resolveDocument).toHaveBeenCalledWith('pos_order', 81, 'html');
    expect(gateway.getFormatDetail).toHaveBeenCalledWith('fiscal_electronic_invoice');
  });

  it('resolves fiscal routing before gating and skips rendering when its selected format is auto-disabled', async () => {
    gateway.resolveDocument.and.returnValue(of(resolved('pos_electronic_invoice')) as any);
    gateway.getFormatDetail.and.returnValue(
      of(formatDetail('pos_electronic_invoice', { autoPrint: false })),
    );

    const result = await service.resolveAndPrint({
      documentType: 'pos_order',
      documentId: 81,
      trigger: 'automatic',
    });

    expect(result).toEqual({ documents: 0, pages: 0, copies: 0, format: 'pos_electronic_invoice' as any });
    expect(gateway.getFormatDetail).toHaveBeenCalledWith('pos_electronic_invoice');
    expect(gateway.renderDocument).not.toHaveBeenCalled();
  });

  it('preserves the automatic trigger when falling back from a non-403 dispatch gateway error', async () => {
    gateway.renderDocument.and.returnValue(throwError(() => new Error('gateway down')));
    gateway.getFormatDetail.and.returnValue(of(formatDetail('dispatch_ticket')));
    const localPrint = spyOn(service, 'print').and.resolveTo({
      documents: 1,
      pages: 1,
      copies: 1,
      format: 'thermal_80',
    });
    const fallbackRequest = { document: 'dispatch_ticket' as const, body: '<p>Dispatch</p>' };

    await service.printViaGateway({
      formatType: 'dispatch_ticket',
      documentId: 81,
      trigger: 'automatic',
      fallbackRequest,
    });

    expect(localPrint).toHaveBeenCalledWith({ ...fallbackRequest, trigger: 'automatic' });
  });
});
