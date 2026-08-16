import { InvoiceFlowService } from './invoice-flow.service';
import { CustomerFiscalIdentityValidator } from '../validators/customer-fiscal-identity.validator';
import { FiscalDocumentValidator } from '../validators/fiscal-document.validator';

/**
 * El desglose de tributos POR LÍNEA que va al emisor UBL.
 *
 * El emisor escribe un `cac:TaxSubtotal` por cada tributo DE LA LÍNEA. Cuando no
 * los recibe hereda el PRIMER tributo del documento, y en una cuenta mixta
 * IVA + INC eso hace que todas las líneas declaren el esquema de la primera —una
 * cuenta de restaurante sale entera como IVA 19 % o entera como INC 8 %— y la
 * DIAN recompone los impuestos desde lo que recibe.
 *
 * Hay DOS fuentes y este spec cubre las dos, porque las dos siguen vivas:
 *
 *   · El desglose PERSISTIDO (`invoice_taxes.invoice_item_id`), que es el dato
 *     real de los documentos nuevos.
 *   · La reconstrucción por subconjuntos, único camino de las facturas ya
 *     emitidas — que se reenvían tal cual años después y NUNCA van a tener la
 *     columna.
 *
 * Se ejercita el método directamente: la emisión real exige habilitación DIAN de
 * la tienda, que en dev no existe.
 */
describe('InvoiceFlowService · desglose de tributos por línea', () => {
  const buildService = () =>
    new InvoiceFlowService(
      {} as any,
      {} as any,
      { emit: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      new CustomerFiscalIdentityValidator(),
      new FiscalDocumentValidator(),
      {} as any,
    );

  /** Línea del payload UBL, con lo mínimo que `dianLineExtension` necesita. */
  const line = (unit_price: number, tax_amount: number) => ({
    description: 'Línea',
    quantity: '1',
    unit_price: String(unit_price),
    discount_amount: '0',
    tax_amount: String(tax_amount),
    total_amount: String(unit_price + tax_amount),
  });

  const attach = (lines: any[], rows: any[], header_taxes: any[]) => {
    const service = buildService();
    (service as any).attachLineTaxes(lines, rows, header_taxes);
    return lines;
  };

  describe('desglose persistido', () => {
    it('le da a cada línea SU tributo en una cuenta mixta IVA + INC', () => {
      const lines = [line(100000, 19000), line(50000, 4000)];
      const rows = [
        { id: 1, is_inclusive: false },
        { id: 2, is_inclusive: false },
      ];
      // Una fila por (línea × tributo): así las escribe `InvoicingService`
      // cuando el documento lleva dos o más tributos distintos.
      const taxes = [
        {
          invoice_item_id: 1,
          tax_name: 'IVA',
          tax_rate: 19,
          taxable_amount: 100000,
          tax_amount: 19000,
          tax_type: 'iva',
        },
        {
          invoice_item_id: 2,
          tax_name: 'INC',
          tax_rate: 8,
          taxable_amount: 50000,
          tax_amount: 4000,
          tax_type: 'inc',
        },
      ];

      attach(lines, rows, taxes);

      expect((lines[0] as any).taxes).toEqual([
        {
          tax_name: 'IVA',
          tax_rate: '19.00',
          taxable_amount: '100000.00',
          tax_amount: '19000.00',
          tax_type: 'iva',
        },
      ]);
      expect((lines[1] as any).taxes).toEqual([
        {
          tax_name: 'INC',
          tax_rate: '8.00',
          taxable_amount: '50000.00',
          tax_amount: '4000.00',
          tax_type: 'inc',
        },
      ]);
    });

    it('acumula los DOS tributos de una misma línea', () => {
      // Restaurante: el mismo plato con IVA 19 % e INC 8 % sobre la misma base.
      const lines = [line(100000, 27000)];
      const rows = [{ id: 7, is_inclusive: false }];
      const taxes = [
        {
          invoice_item_id: 7,
          tax_name: 'IVA',
          tax_rate: 19,
          taxable_amount: 100000,
          tax_amount: 19000,
          tax_type: 'iva',
        },
        {
          invoice_item_id: 7,
          tax_name: 'INC',
          tax_rate: 8,
          taxable_amount: 100000,
          tax_amount: 8000,
          tax_type: 'inc',
        },
      ];

      attach(lines, rows, taxes);

      expect((lines[0] as any).taxes).toHaveLength(2);
      expect((lines[0] as any).taxes.map((t: any) => t.tax_type)).toEqual([
        'iva',
        'inc',
      ]);
    });

    it('NO toca la línea con precio impuesto-incluido', () => {
      // El emisor sigue escribiendo la base SIN despejar en
      // `cbc:LineExtensionAmount`, así que declarar acá la base despejada
      // dejaría el `TaxSubtotal` en desacuerdo con su propia línea. Un XML
      // internamente contradictorio es peor que un desglose ausente.
      const lines = [line(119000, 19000), line(50000, 4000)];
      const rows = [
        { id: 1, is_inclusive: true },
        { id: 2, is_inclusive: false },
      ];
      const taxes = [
        {
          invoice_item_id: 1,
          tax_name: 'IVA',
          tax_rate: 19,
          taxable_amount: 100000,
          tax_amount: 19000,
          tax_type: 'iva',
        },
        {
          invoice_item_id: 2,
          tax_name: 'INC',
          tax_rate: 8,
          taxable_amount: 50000,
          tax_amount: 4000,
          tax_type: 'inc',
        },
      ];

      attach(lines, rows, taxes);

      expect((lines[0] as any).taxes).toBeUndefined();
      // La línea sana sí se emite: la exclusión es POR LÍNEA, no por documento.
      expect((lines[1] as any).taxes).toHaveLength(1);
    });

    it('descarta el desglose cuya base no es la que el emisor va a escribir', () => {
      // La fila dice que grava 90.000 pero la línea declara 100.000 en
      // `cbc:LineExtensionAmount`. Emitirlo dejaría el subtotal contradiciendo
      // su propia línea.
      const lines = [line(100000, 17100)];
      const rows = [{ id: 1, is_inclusive: false }];
      const taxes = [
        {
          invoice_item_id: 1,
          tax_name: 'IVA',
          tax_rate: 19,
          taxable_amount: 90000,
          tax_amount: 17100,
          tax_type: 'iva',
        },
        {
          invoice_item_id: 1,
          tax_name: 'INC',
          tax_rate: 8,
          taxable_amount: 90000,
          tax_amount: 0,
          tax_type: 'inc',
        },
      ];

      attach(lines, rows, taxes);

      expect((lines[0] as any).taxes).toBeUndefined();
    });

    it('descarta el desglose que no suma el impuesto de la línea', () => {
      // Σ cuotas = 19.000 pero la línea declara 27.000: emitirlo descuadraría la
      // cabecera que la DIAN contrasta (FAS01b).
      const lines = [line(100000, 27000)];
      const rows = [{ id: 1, is_inclusive: false }];
      const taxes = [
        {
          invoice_item_id: 1,
          tax_name: 'IVA',
          tax_rate: 19,
          taxable_amount: 100000,
          tax_amount: 19000,
          tax_type: 'iva',
        },
        {
          invoice_item_id: 2,
          tax_name: 'INC',
          tax_rate: 8,
          taxable_amount: 100000,
          tax_amount: 8000,
          tax_type: 'inc',
        },
      ];

      attach(lines, rows, taxes);

      expect((lines[0] as any).taxes).toBeUndefined();
    });
  });

  describe('reconstrucción del histórico', () => {
    it('deduce el tributo de cada línea desde los agregados de cabecera', () => {
      // Documento SIN `invoice_item_id`: todo lo emitido antes de la columna.
      const lines = [line(100000, 19000), line(50000, 4000)];
      const rows = [
        { id: 1, is_inclusive: false },
        { id: 2, is_inclusive: false },
      ];
      const taxes = [
        {
          invoice_item_id: null,
          tax_name: 'IVA',
          tax_rate: 19,
          taxable_amount: 100000,
          tax_amount: 19000,
          tax_type: 'iva',
        },
        {
          invoice_item_id: null,
          tax_name: 'INC',
          tax_rate: 8,
          taxable_amount: 50000,
          tax_amount: 4000,
          tax_type: 'inc',
        },
      ];

      attach(lines, rows, taxes);

      expect((lines[0] as any).taxes).toHaveLength(1);
      expect((lines[0] as any).taxes[0].tax_type).toBe('iva');
      expect((lines[1] as any).taxes[0].tax_type).toBe('inc');
    });

    it('cae a la reconstrucción cuando sólo ALGUNAS filas traen vínculo', () => {
      // Dos verdades sobre el mismo impuesto —agregado y desglose— no se pueden
      // mezclar: el documento entero se trata como histórico.
      const lines = [line(100000, 19000), line(50000, 4000)];
      const rows = [
        { id: 1, is_inclusive: false },
        { id: 2, is_inclusive: false },
      ];
      const taxes = [
        {
          invoice_item_id: 1,
          tax_name: 'IVA',
          tax_rate: 19,
          taxable_amount: 100000,
          tax_amount: 19000,
          tax_type: 'iva',
        },
        {
          invoice_item_id: null,
          tax_name: 'INC',
          tax_rate: 8,
          taxable_amount: 50000,
          tax_amount: 4000,
          tax_type: 'inc',
        },
      ];

      attach(lines, rows, taxes);

      // La reconstrucción resuelve las dos igual, pero por deducción: lo que se
      // verifica es que el camino persistido NO se creyó una tabla a medias.
      expect((lines[0] as any).taxes[0].tax_type).toBe('iva');
      expect((lines[1] as any).taxes[0].tax_type).toBe('inc');
    });

    it('deja el documento de un solo tributo en el camino histórico', () => {
      // Con un tributo el emisor ya produce el mismo XML heredándolo, así que no
      // se toca: cero riesgo, cero beneficio.
      const lines = [line(100000, 19000)];
      const rows = [{ id: 1, is_inclusive: false }];
      const taxes = [
        {
          invoice_item_id: null,
          tax_name: 'IVA',
          tax_rate: 19,
          taxable_amount: 100000,
          tax_amount: 19000,
          tax_type: 'iva',
        },
      ];

      attach(lines, rows, taxes);

      expect((lines[0] as any).taxes).toBeUndefined();
    });
  });
});
