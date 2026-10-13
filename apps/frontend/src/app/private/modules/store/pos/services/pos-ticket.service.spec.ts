/**
 * GEMELO DECLARADO — el mismo cuerpo de casos corre en
 * `apps/mobile/src/features/pos/services/pos-ticket.service.spec.ts` y en
 * `apps/backend/.../print-formats/services/fiscal-invoice-pdf-render.service.spec.ts`.
 * Si este pasa y alguno de aquellos no, los tiquetes divergieron.
 *
 * Num. 12 del art. 11 de la Res. DIAN 000165/2023 — cuatro calidades, y sólo
 * «cuando corresponda». El tiquete NO declara régimen: «Responsable de IVA» /
 * «No responsable de IVA» venían del art. 506 E.T., derogado por la Ley
 * 1943/2018 (art. 122) y la Ley 2010/2019 (art. 160). El defecto medido: Pollo
 * Árabe, restaurante responsable únicamente de INC, imprimía una obligación
 * tributaria que no tiene.
 */
import { firstValueFrom, of } from 'rxjs';
import { PosTicketService, resolveFiscalQualitiesLine } from './pos-ticket.service';
import type { TicketData } from '../models/ticket.model';

describe('resolveFiscalQualitiesLine (num. 12 art. 11 Res. 000165/2023)', () => {
  it('Pollo Árabe (INC, sin O-13/O-15/O-23/O-47) ⇒ ninguna línea', () => {
    expect(
      resolveFiscalQualitiesLine([
        'O-05',
        'O-07',
        'O-14',
        'O-33',
        'O-42',
        'O-52',
        'O-55',
      ]),
    ).toBe('');
  });

  it('la leyenda derogada no se reemplaza por «No responsable de IVA»', () => {
    expect(resolveFiscalQualitiesLine(['O-49'])).toBe('');
    expect(resolveFiscalQualitiesLine(['O-48'])).toBe('');
  });

  it('gran contribuyente + autorretenedor ⇒ dos calidades en el orden del num. 12', () => {
    expect(resolveFiscalQualitiesLine(['O-15', 'O-13'])).toBe(
      'Autorretenedor del Impuesto sobre la Renta y Complementarios | Gran contribuyente',
    );
  });

  it('régimen SIMPLE ⇒ su calidad', () => {
    expect(resolveFiscalQualitiesLine(['O-47'])).toBe(
      'Contribuyente del Régimen Simple de Tributación (SIMPLE)',
    );
  });

  it('agente retenedor de IVA ⇒ su calidad', () => {
    expect(resolveFiscalQualitiesLine(['O-23'])).toBe(
      'Agente retenedor del Impuesto sobre las Ventas (IVA)',
    );
  });

  it('normaliza la casilla 53 cruda', () => {
    expect(resolveFiscalQualitiesLine(['13', '15'])).toBe(
      resolveFiscalQualitiesLine(['O-13', 'O-15']),
    );
    expect(resolveFiscalQualitiesLine(['o-47'])).toBe(
      'Contribuyente del Régimen Simple de Tributación (SIMPLE)',
    );
  });

  it('tolera vacío, ausente y entradas no-string', () => {
    expect(resolveFiscalQualitiesLine([])).toBe('');
    expect(resolveFiscalQualitiesLine(undefined)).toBe('');
    expect(resolveFiscalQualitiesLine(null)).toBe('');
    expect(resolveFiscalQualitiesLine([null, 13, {}])).toBe('');
  });
});

describe('PosTicketService — automatic print trigger', () => {
  const createService = (documentPrint: any): PosTicketService => {
    const service = Object.create(PosTicketService.prototype) as any;
    service.documentPrint = documentPrint;
    service.defaultPrinterConfig = {
      name: 'Default Thermal Printer',
      type: 'thermal',
      paperWidth: 80,
      format: 'thermal_80',
      copies: 1,
      autoPrint: true,
      printHeader: true,
      printFooter: true,
      printBarcode: true,
    };
    return service as PosTicketService;
  };

  const documentPrintMock = () => ({
    canAutoPrintDocument: jasmine.createSpy('canAutoPrintDocument'),
    resolveConfig: jasmine.createSpy('resolveConfig').and.returnValue({
      format: 'thermal_80', widthMm: 80, isRoll: true, copies: 1,
    }),
    resolveAndPrint: jasmine.createSpy('resolveAndPrint'),
  });

  it('shouldAutoPrint delegates by POS document id to the central gate', async () => {
    const print = documentPrintMock();
    print.canAutoPrintDocument.and.returnValue(Promise.resolve(false));
    const service = createService(print);

    expect(await service.shouldAutoPrint(42)).toBe(false);
    expect(print.canAutoPrintDocument).toHaveBeenCalledWith('pos_order', 42);
  });

  it('sends automatic trigger and returns false when the final central gate omits printing', async () => {
    const print = documentPrintMock();
    print.resolveAndPrint.and.returnValue(Promise.resolve({
      documents: 0, pages: 0, copies: 0, format: 'thermal_80',
    }));
    const service = createService(print);

    const printed = await firstValueFrom(service.printTicket(
      { id: '42', orderId: 42 } as TicketData,
      { printReceipt: true, trigger: 'automatic' },
    ));

    expect(printed).toBe(false);
    expect(print.resolveAndPrint).toHaveBeenCalledWith({
      documentType: 'pos_order', documentId: 42, trigger: 'automatic',
    });
  });

  it('manual print defaults to explicit and does not preflight the auto gate', async () => {
    const print = documentPrintMock();
    print.resolveAndPrint.and.returnValue(Promise.resolve({
      documents: 1, pages: 1, copies: 1, format: 'thermal_80',
    }));
    const service = createService(print);

    const printed = await firstValueFrom(service.printTicket(
      { id: '42', orderId: 42 } as TicketData,
      { printReceipt: true },
    ));

    expect(printed).toBe(true);
    expect(print.resolveAndPrint).toHaveBeenCalledWith({
      documentType: 'pos_order', documentId: 42, trigger: 'explicit',
    });
    expect(print.canAutoPrintDocument).not.toHaveBeenCalled();
  });
});

describe('PosTicketService — gateway batch copies', () => {
  const html = (head: string, body: string) =>
    `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

  const createBatchService = (configs: Record<number, {
    html?: string;
    copies?: number;
    width_mm?: number;
    is_roll?: boolean;
    fail?: boolean;
  }>) => {
    const documentPrint = {
      normalizeGatewayCopies: (copies: unknown) =>
        typeof copies === 'number' && Number.isFinite(copies)
          ? Math.min(10, Math.max(1, Math.trunc(copies)))
          : 1,
      printGatewayHtml: jasmine.createSpy('printGatewayHtml').and.returnValue(Promise.resolve()),
      print: jasmine.createSpy('print').and.returnValue(Promise.resolve({ copies: 1 })),
      resolveAndPrint: jasmine.createSpy('resolveAndPrint'),
    };
    const gatewayClient = {
      resolveDocument: jasmine.createSpy('resolveDocument').and.callFake(
        (_type: string, id: number) => of({
          format_type: 'pos_sale_ticket', document_id: id, engine: 'html',
        }),
      ),
      renderDocument: jasmine.createSpy('renderDocument').and.callFake(
        (_type: string, id: number, _engine: string, bodyOnly: boolean) => {
          expect(bodyOnly).toBe(false);
          const config = configs[id];
          if (config?.fail) throw new Error('falló el render');
          return of({
            format_type: 'pos_sale_ticket',
            html: config?.html ?? html('<style>p{color:red}</style>', `<p>doc-${id}</p>`),
            copies: config?.copies,
            width_mm: config?.width_mm ?? 80,
            is_roll: config?.is_roll ?? true,
          });
        },
      ),
    };
    const service = Object.assign(Object.create(PosTicketService.prototype), {
      documentPrint,
      gatewayClient,
    }) as PosTicketService;
    return { service, documentPrint, gatewayClient };
  };

  it('expands each document copies contiguously under one compatible head and sends once', async () => {
    const { service, documentPrint, gatewayClient } = createBatchService({
      11: { copies: 2, html: html('<style>p{color:red}</style>', '<p>A</p>') },
      22: { copies: 3, html: html('<style>p{color:red}</style>', '<p>B</p>') },
    });
    const result = await service.printTicketsBatch([
      { id: '11', orderId: 11 } as TicketData,
      { id: '22', orderId: 22 } as TicketData,
    ]);

    expect(result).toEqual({ rendered: 2, pages: 5 });
    expect(gatewayClient.renderDocument).toHaveBeenCalledTimes(2);
    expect(documentPrint.printGatewayHtml).toHaveBeenCalledTimes(1);
    const assembled = documentPrint.printGatewayHtml.calls.argsFor(0)[0] as string;
    expect(assembled.match(/<head>/g)?.length).toBe(1);
    expect(assembled.match(/<p>A<\/p>/g)?.length).toBe(2);
    expect(assembled.match(/<p>B<\/p>/g)?.length).toBe(3);
    expect(Array.from(assembled.matchAll(/<p>([AB])<\/p>/g), (match) => match[1]))
      .toEqual(['A', 'A', 'B', 'B', 'B']);
    expect(documentPrint.print).not.toHaveBeenCalled();
  });

  it('normalizes missing/zero copy metadata to one copy', async () => {
    const { service, documentPrint } = createBatchService({
      11: { copies: 0 },
      22: {},
    });
    const result = await service.printTicketsBatch([
      { id: '11', orderId: 11 } as TicketData,
      { id: '22', orderId: 22 } as TicketData,
    ]);

    expect(result.pages).toBe(2);
    const assembled = documentPrint.printGatewayHtml.calls.argsFor(0)[0] as string;
    expect(assembled.match(/<p>doc-11<\/p>/g)?.length).toBe(1);
    expect(assembled.match(/<p>doc-22<\/p>/g)?.length).toBe(1);
  });

  it('rejects incompatible head or paper before printing anything', async () => {
    const { service, documentPrint } = createBatchService({
      11: { html: html('<style>.a{}</style>', '<p>A</p>') },
      22: { html: html('<style>.b{}</style>', '<p>B</p>'), width_mm: 58, is_roll: true },
    });

    await expectAsync(service.printTicketsBatch([
      { id: '11', orderId: 11 } as TicketData,
      { id: '22', orderId: 22 } as TicketData,
    ])).toBeRejectedWithError(/diseños o papeles incompatibles; imprima por separado/);
    expect(documentPrint.printGatewayHtml).not.toHaveBeenCalled();
    expect(documentPrint.print).not.toHaveBeenCalled();
  });

  it('prints successful documents and retains failed ids as a partial result', async () => {
    const warn = spyOn(console, 'warn');
    const { service, documentPrint } = createBatchService({
      11: { copies: 2 },
      22: { fail: true },
    });
    const result = await service.printTicketsBatch([
      { id: '11', orderId: 11 } as TicketData,
      { id: '22', orderId: 22 } as TicketData,
    ]);

    expect(result).toEqual({ rendered: 1, pages: 2 });
    expect(documentPrint.printGatewayHtml).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });
});
