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
import { firstValueFrom } from 'rxjs';
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
