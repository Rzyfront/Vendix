import { NotFoundException } from '@nestjs/common';
import { DispatchNotePdfService } from './dispatch-note-pdf.service';
import {
  DispatchNotePdfBuilder,
  DispatchNotePdfData,
} from './dispatch-note-pdf.builder';

/**
 * Domiciliario (courier_name) en el PDF de la remisión.
 *
 * `dispatch_notes.courier_name` lo persiste DispatchNoteFlowService.deliver()
 * (texto libre con trim; NULL = sin domiciliario). El PDF debe mapearlo con
 * trim y ausentarlo cuando viene vacío, para que el builder pinte
 * "Domiciliario: <nombre>" junto a "Despachado por" solo cuando hay nombre.
 */
describe('DispatchNotePdfService — courier_name (domiciliario) en el PDF', () => {
  let service: DispatchNotePdfService;
  let prismaMock: any;
  let s3Mock: any;

  const baseNote = () => ({
    id: 220,
    dispatch_number: 'REM-220',
    status: 'delivered',
    emission_date: new Date(Date.UTC(2026, 7, 22)),
    customer_name: 'Tienda La Esquina',
    customer_tax_id: null,
    customer_address: null,
    subtotal_amount: 10000,
    discount_amount: 0,
    tax_amount: 0,
    grand_total: 10000,
    currency: 'COP',
    notes: null,
    courier_name: null,
    dispatch_note_items: [],
    dispatch_route_stops: [],
    order: null,
    sales_order: null,
    dispatch_location: null,
    store: {
      id: 1,
      organizations: {
        id: 1,
        name: 'Org Test',
        legal_name: null,
        tax_id: '900123456',
        phone: null,
        email: null,
        logo_url: null,
        addresses: [],
      },
    },
  });

  /** Espía el builder real y captura el DispatchNotePdfData que recibe. */
  const mockBuilder = () =>
    jest
      .spyOn(DispatchNotePdfBuilder, 'generate')
      .mockResolvedValue(Buffer.from('pdf-bytes'));

  beforeEach(() => {
    prismaMock = { dispatch_notes: { findFirst: jest.fn() } };
    s3Mock = { downloadImage: jest.fn() };
    service = new DispatchNotePdfService(prismaMock, s3Mock);
  });

  afterEach(() => jest.restoreAllMocks());

  it('mapea courier_name con trim al DispatchNotePdfData', async () => {
    const generateSpy = mockBuilder();
    prismaMock.dispatch_notes.findFirst.mockResolvedValue({
      ...baseNote(),
      courier_name: '  Edga  ',
    });

    await service.generatePdf(220);

    const data: DispatchNotePdfData = generateSpy.mock.calls[0][0];
    expect(data.courier_name).toBe('Edga');
  });

  it('ausenta courier_name cuando es NULL (PDF idéntico al actual)', async () => {
    const generateSpy = mockBuilder();
    prismaMock.dispatch_notes.findFirst.mockResolvedValue(baseNote());

    await service.generatePdf(220);

    const data: DispatchNotePdfData = generateSpy.mock.calls[0][0];
    expect(data.courier_name).toBeUndefined();
  });

  it('ausenta courier_name cuando es solo espacios', async () => {
    const generateSpy = mockBuilder();
    prismaMock.dispatch_notes.findFirst.mockResolvedValue({
      ...baseNote(),
      courier_name: '   ',
    });

    await service.generatePdf(220);

    const data: DispatchNotePdfData = generateSpy.mock.calls[0][0];
    expect(data.courier_name).toBeUndefined();
  });

  it('lanza NotFoundException si la remisión no existe', async () => {
    const generateSpy = mockBuilder();
    prismaMock.dispatch_notes.findFirst.mockResolvedValue(null);

    await expect(service.generatePdf(999)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(generateSpy).not.toHaveBeenCalled();
  });

  describe('builder — bloque de firmas con/sin domiciliario (smoke)', () => {
    const minimalData = (): DispatchNotePdfData => ({
      dispatch_number: 'REM-220',
      status: 'delivered',
      issue_date: '22/08/2026',
      company_name: 'Org Test',
      company_nit: '900123456',
      customer_name: 'Tienda La Esquina',
      items: [],
      subtotal_amount: 10000,
      discount_amount: 0,
      tax_amount: 0,
      grand_total: 10000,
    });

    it('genera PDF válido sin courier_name', async () => {
      const pdf = await DispatchNotePdfBuilder.generate(minimalData());
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
      expect(pdf.length).toBeGreaterThan(0);
    });

    it('genera PDF válido con courier_name (no estalla el bloque de firmas)', async () => {
      const pdf = await DispatchNotePdfBuilder.generate({
        ...minimalData(),
        courier_name: 'Edga',
      });
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
      expect(pdf.length).toBeGreaterThan(0);
    });
  });
});
