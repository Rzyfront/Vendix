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
    expect((service as any).sendToPrinter).toHaveBeenCalledWith(
      service.withGatewayPrintGuard('<html>ticket</html>'),
    );
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

  it('normalizes gateway copy counts to an integer in the range 1..10', () => {
    expect(service.normalizeGatewayCopies(0)).toBe(1);
    expect(service.normalizeGatewayCopies(1)).toBe(1);
    expect(service.normalizeGatewayCopies(3)).toBe(3);
    expect(service.normalizeGatewayCopies(10)).toBe(10);
    expect(service.normalizeGatewayCopies(12)).toBe(10);
    expect(service.normalizeGatewayCopies(3.9)).toBe(3);
    expect(service.normalizeGatewayCopies(Number.NaN)).toBe(1);
    expect(service.normalizeGatewayCopies(undefined)).toBe(1);
  });

  it('materializes gateway copies in body order while preserving one document head and its assets', async () => {
    const html = '<html lang="es"><head><style>.logo{color:red}</style></head>' +
      '<body class="ticket"><article>A<img src="logo.png"></article>' +
      '<article>B</article></body></html>';
    gateway.renderDocument.and.returnValue(of({ html, copies: 3 } as any));

    const result = await service.printViaGateway({
      formatType: 'pos_sale_ticket',
      documentId: 81,
      trigger: 'explicit',
    });

    const sentHtml = (service as any).sendToPrinter.calls.mostRecent().args[0] as string;
    expect(result).toEqual({ documents: 1, pages: 3, copies: 3, format: 'pos_sale_ticket' as any });
    expect((service as any).sendToPrinter).toHaveBeenCalledTimes(1);
    expect(sentHtml.match(/<head>/gi)?.length).toBe(1);
    expect(sentHtml).toContain('<html lang="es">');
    expect(sentHtml).toContain('<style>.logo{color:red}</style>');
    expect(sentHtml).toContain('<body class="ticket">');
    expect(sentHtml).toContain('<img src="logo.png">');
    expect(sentHtml.indexOf('<article>A')).toBeLessThan(sentHtml.indexOf('<article>B'));
    expect(sentHtml.match(/<article>A/g)?.length).toBe(3);
    expect(sentHtml.match(/<article>B/g)?.length).toBe(3);
  });

  it('sends one body for zero/one copies and exactly ten for the maximum gateway count', async () => {
    for (const copies of [0, 1, 10]) {
      (service as any).sendToPrinter.calls.reset();
      gateway.renderDocument.and.returnValue(of({
        html: '<html><head><title>one head</title></head><body><p>Copy</p></body></html>',
        copies,
      } as any));

      const result = await service.printViaGateway({
        formatType: 'pos_sale_ticket',
        documentId: 81,
        trigger: 'explicit',
      });

      const sentHtml = (service as any).sendToPrinter.calls.mostRecent().args[0] as string;
      const expected = copies === 10 ? 10 : 1;
      expect(result?.copies).toBe(expected);
      expect(sentHtml.match(/<p>Copy<\/p>/g)?.length).toBe(expected);
      expect(sentHtml.match(/<head>/gi)?.length).toBe(1);
      expect((service as any).sendToPrinter).toHaveBeenCalledTimes(1);
    }
  });

  it('uses the same body-only expansion when resolving a fiscal document', async () => {
    gateway.resolveDocument.and.returnValue(of(resolved('pos_electronic_invoice')) as any);
    gateway.renderDocument.and.returnValue(of({
      html: '<html><head><style>p{color:blue}</style></head><body><p>Invoice</p></body></html>',
      copies: 3,
    } as any));

    const result = await service.resolveAndPrint({
      documentType: 'pos_order',
      documentId: 81,
      trigger: 'explicit',
    });

    const sentHtml = (service as any).sendToPrinter.calls.mostRecent().args[0] as string;
    expect(result).toEqual({ documents: 1, pages: 3, copies: 3, format: 'pos_electronic_invoice' as any });
    expect(sentHtml.match(/<head>/gi)?.length).toBe(1);
    expect(sentHtml.match(/<p>Invoice<\/p>/g)?.length).toBe(3);
    expect(sentHtml).toContain('<style>p{color:blue}</style>');
    expect((service as any).sendToPrinter).toHaveBeenCalledTimes(1);
  });

  it('applies requested copies to a full gateway HTML document, and leaves no-body HTML alone for one copy', async () => {
    const html = '<html data-format="draft"><head><title>draft</title></head><body><p>Draft</p></body></html>';
    await service.printGatewayHtml(html, 3);
    const sentHtml = (service as any).sendToPrinter.calls.mostRecent().args[0] as string;
    expect(sentHtml.match(/<p>Draft<\/p>/g)?.length).toBe(3);
    expect(sentHtml.match(/<head>/gi)?.length).toBe(1);

    (service as any).sendToPrinter.calls.reset();
    await service.printGatewayHtml('<html><head><title>legacy</title></head></html>', 0);
    expect((service as any).sendToPrinter).toHaveBeenCalledTimes(1);
    const legacySent = (service as any).sendToPrinter.calls.mostRecent().args[0] as string;
    expect(legacySent).toContain('<title>legacy</title>');
    expect(legacySent).toContain('data-vx-print-guard');
  });

  it('rejects multi-copy gateway HTML without a body instead of cloning full documents', async () => {
    await expectAsync(service.printGatewayHtml('<html><head></head></html>', 2))
      .toBeRejectedWithError(/no <body>/i);
    expect((service as any).sendToPrinter).not.toHaveBeenCalled();
  });

  it('rejects, instead of resolving silently, when the print iframe has no document', async () => {
    (service as any).sendToPrinter.and.callThrough();
    const iframe = window.document.createElement('iframe');
    Object.defineProperty(iframe, 'contentDocument', { value: null });
    Object.defineProperty(iframe, 'contentWindow', { value: null });
    spyOn(window.document, 'createElement').and.returnValue(iframe);

    await expectAsync(
      service.printGatewayHtml('<html><head></head><body><p>A</p></body></html>', 1),
    ).toBeRejectedWithError('No se pudo preparar el documento de impresión.');
    expect(iframe.isConnected).toBeFalse();
  });

  it('preserves replacement-token sequences literally when expanding body content', async () => {
    const literal = "$& $` $' $$";
    const html = `<html><head><title>tokens</title></head><body><p>${literal}</p></body></html>`;

    await service.printGatewayHtml(html, 3);

    const sentHtml = (service as any).sendToPrinter.calls.mostRecent().args[0] as string;
    expect(sentHtml.match(/\$& \$` \$' \$\$/g)?.length).toBe(3);
    expect(sentHtml.match(/<head>/gi)?.length).toBe(1);
  });

  describe('print geometry', () => {
    const withPrinting = (printing: Record<string, unknown>) =>
      settings.receipts.and.returnValue({ printing });

    it('resolves thermal_80 to a 72 mm content width and emits it in the HTML', () => {
      withPrinting({ pos_ticket: { format: 'thermal_80', copies: 1 } });
      const config = service.resolveConfig('pos_ticket');
      expect(config.paperWidthMm).toBe(80);
      expect(config.widthMm).toBe(80);
      expect(config.contentWidthMm).toBe(72);
      const html = service.buildDocumentHtml(config, '<p>x</p>');
      expect(html).toContain('width: 72mm');
      expect(html).toContain('class="vx-print-root"');
    });

    it('resolves thermal_58 to a 48 mm content width', () => {
      withPrinting({ pos_ticket: { format: 'thermal_58', copies: 1 } });
      const config = service.resolveConfig('pos_ticket');
      expect(config.contentWidthMm).toBe(48);
      expect(service.buildDocumentHtml(config, '<p>x</p>')).toContain('width: 48mm');
    });

    it('honours a stored printable_width_mm on a roll', () => {
      withPrinting({ pos_ticket: { format: 'thermal_80', printable_width_mm: 64, copies: 1 } });
      const config = service.resolveConfig('pos_ticket');
      expect(config.printableWidthMm).toBe(64);
      expect(config.contentWidthMm).toBe(64);
      expect(service.buildDocumentHtml(config, '<p>x</p>')).toContain('width: 64mm');
    });

    it('never lets a sheet margin go below 5 mm', () => {
      withPrinting({ sales_order: { format: 'a4', margin_mm: 0, copies: 1 } });
      const config = service.resolveConfig('sales_order');
      expect(config.margins.top).toBeGreaterThanOrEqual(5);
      expect(config.margins.right).toBeGreaterThanOrEqual(5);
      expect(config.margins.bottom).toBeGreaterThanOrEqual(5);
      expect(config.margins.left).toBeGreaterThanOrEqual(5);
    });

    it('buildDocumentHtml carries the base overflow guard', () => {
      withPrinting({ pos_ticket: { format: 'thermal_80', copies: 1 } });
      const html = service.buildDocumentHtml(service.resolveConfig('pos_ticket'), '<p>x</p>');
      expect(html).toContain('table-layout: fixed');
      expect(html).toContain('<meta charset="utf-8">');
      expect(html).toContain('box-sizing: border-box');
    });

    it('injects the gateway guard once, without touching @page', () => {
      const html = '<html><head><style>@page{size:80mm auto;margin:0 4mm}</style></head><body><p>a</p></body></html>';
      const once = service.withGatewayPrintGuard(html);
      expect(once).toContain('@page{size:80mm auto;margin:0 4mm}');
      expect(once.match(/data-vx-print-guard/g)?.length).toBe(1);
      expect(service.withGatewayPrintGuard(once)).toBe(once);
    });
  });
  describe('printGatewayBatch', () => {
    const doc = (label: string) =>
      `<html><head><style>.n{}</style></head><body class="note"><p>${label}</p></body></html>`;

    it('prints every document in one dialog, one sheet each, with one head', async () => {
      gateway.renderDocument.and.callFake(((_f: PrintFormatType, id: number | string) =>
        of({ html: doc(`R-${id}`), copies: 1 } as any)) as any);

      const result = await service.printGatewayBatch({
        formatType: 'dispatch_note',
        documentIds: [1, 2, 3],
      });

      expect(result).toEqual({ printedIds: [1, 2, 3], failedIds: [] });
      expect(gateway.renderDocument.calls.allArgs().map((a) => a[0])).toEqual([
        'dispatch_note',
        'dispatch_note',
        'dispatch_note',
      ]);
      expect((service as any).sendToPrinter).toHaveBeenCalledTimes(1);
      const sent = (service as any).sendToPrinter.calls.mostRecent().args[0] as string;
      expect(sent.match(/<head>/gi)?.length).toBe(1);
      expect(sent.indexOf('R-1')).toBeLessThan(sent.indexOf('R-2'));
      expect(sent.indexOf('R-2')).toBeLessThan(sent.indexOf('R-3'));
      expect(sent.match(/break-before: page/g)?.length).toBe(2);
      expect(sent).toContain('<body class="note">');
    });

    it('reports a document that fails to render and still prints the rest', async () => {
      gateway.renderDocument.and.callFake(((_f: PrintFormatType, id: number | string) =>
        id === 2
          ? throwError(() => new Error('render failed'))
          : of({ html: doc(`R-${id}`), copies: 1 } as any)) as any);

      const result = await service.printGatewayBatch({
        formatType: 'dispatch_note',
        documentIds: [1, 2, 3],
      });

      expect(result).toEqual({ printedIds: [1, 3], failedIds: [2] });
      const sent = (service as any).sendToPrinter.calls.mostRecent().args[0] as string;
      expect(sent).not.toContain('R-2');
    });

    it('aborts the whole batch when the format is inactive (403)', async () => {
      gateway.renderDocument.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 403 })),
      );

      const result = await service.printGatewayBatch({
        formatType: 'dispatch_note',
        documentIds: [1, 2],
      });

      expect(result).toBeNull();
      expect((service as any).sendToPrinter).not.toHaveBeenCalled();
    });
  });
});
