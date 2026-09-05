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
  /**
   * MODELO 1 DEL AIU (`'no_sumada'`): la línea ES el contrato entero.
   *
   * Su base gravable NO es su importe sino una fracción —bajo Decreto 1372/1992,
   * la utilidad—, y ninguno de los dos caminos de arriba se la puede dar: con un
   * solo tributo el persistido no existe y la reconstrucción sale por
   * `candidates.length < 2`. El emisor caía entonces al camino histórico, que
   * escribe `cbc:TaxableAmount = cbc:LineExtensionAmount`, y declaraba el
   * contrato completo como base gravable.
   *
   * Las cifras son las de la factura 63 (`FVJL11`), la primera del modelo que
   * llegó a producción: contrato de $2.328.800 en dos líneas de $852.000 y
   * $1.476.800, utilidad del 3 %, IVA 19 %.
   */
  describe('línea de contrato AIU (Modelo 1)', () => {
    const attachContrato = (
      lines: any[],
      rows: any[],
      header_taxes: any[],
    ) => {
      const service = buildService();
      (service as any).attachLineTaxes(lines, rows, header_taxes);
      (service as any).attachAiuContratoLineTaxes(lines, rows, header_taxes);
      return lines;
    };

    const IVA_CABECERA = [
      {
        invoice_item_id: null,
        tax_name: 'IVA',
        tax_rate: 19,
        // La base que el calculador escribió: 3 % de $2.328.800.
        taxable_amount: 69864,
        tax_amount: 13274.16,
        tax_type: 'iva',
      },
    ];

    const CONTRATO = [
      { id: 1, is_inclusive: false, aiu_component: 'contrato' },
      { id: 2, is_inclusive: false, aiu_component: 'contrato' },
    ];

    it('declara la UTILIDAD como base, no el importe de la línea', () => {
      const lines = [line(852000, 4856.4), line(1476800, 8417.76)];

      attachContrato(lines, CONTRATO, IVA_CABECERA);

      // 4.856,40 ÷ 19 % = 25.560,00 — exactamente el 3 % de $852.000.
      expect((lines[0] as any).taxes).toEqual([
        expect.objectContaining({
          taxable_amount: '25560.00',
          tax_amount: '4856.40',
          tax_rate: '19.00',
        }),
      ]);
      // 8.417,76 ÷ 19 % = 44.304,00 — el 3 % de $1.476.800.
      expect((lines[1] as any).taxes).toEqual([
        expect.objectContaining({
          taxable_amount: '44304.00',
          tax_amount: '8417.76',
        }),
      ]);
    });

    it('la Σ de las bases de línea cierra contra la base de cabecera', () => {
      // Es la identidad que la DIAN contrasta en FAU04:
      // `round(//cbc:TaxExclusiveAmount) == round(sum(<línea>/…/cbc:TaxableAmount))`.
      const lines = [line(852000, 4856.4), line(1476800, 8417.76)];

      attachContrato(lines, CONTRATO, IVA_CABECERA);

      const suma = (lines as any[]).reduce(
        (acc, l) => acc + Number(l.taxes[0].taxable_amount),
        0,
      );
      expect(suma).toBeCloseTo(69864, 2);
    });

    it('la línea que CALLA su grupo no recibe base: no declara ninguna', () => {
      // Bajo `'utilidad'` administración e imprevistos quedan fuera de la base y
      // `attachAiuLineExtras` ya les puso `omit_tax_total`. Darles un desglose
      // acá sería contradecir la bandera que decide que no emiten `cac:TaxTotal`.
      const lines: any[] = [line(852000, 4856.4), line(1476800, 8417.76)];
      lines[1].omit_tax_total = true;

      attachContrato(lines, CONTRATO, IVA_CABECERA);

      expect(lines[1].taxes).toBeUndefined();
    });

    it('no toca la línea que NO es de contrato', () => {
      // El Modelo 2 (`'sumada'`) reparte A/I/U en líneas propias, y ahí la base
      // de la línea gravable ES su importe: el camino histórico ya la emite bien
      // y meterse sólo podría romperlo.
      const lines = [line(852000, 4856.4)];

      attachContrato(lines, [{ id: 1, aiu_component: 'utilidad' }], IVA_CABECERA);

      expect((lines[0] as any).taxes).toBeUndefined();
    });

    it('no reescribe un desglose que ya vino persistido', () => {
      // Con dos tributos el documento SÍ persiste su desglose, y ese trae la base
      // que el calculador computó. Derivarla otra vez acá crearía una segunda
      // verdad sobre la misma línea.
      // La línea declara la SUMA de las dos cuotas: 4.856,40 de IVA más
      // 2.044,80 de INC, las dos sobre la misma base de utilidad.
      const lines = [line(852000, 6901.2)];
      const persisted = [
        {
          invoice_item_id: 1,
          tax_name: 'IVA',
          tax_rate: 19,
          taxable_amount: 25560,
          tax_amount: 4856.4,
          tax_type: 'iva',
        },
        {
          invoice_item_id: 1,
          tax_name: 'INC',
          tax_rate: 8,
          taxable_amount: 25560,
          tax_amount: 2044.8,
          tax_type: 'inc',
        },
      ];

      attachContrato(lines, [CONTRATO[0]], persisted);

      expect((lines[0] as any).taxes).toHaveLength(2);
      expect((lines[0] as any).taxes[0].taxable_amount).toBe('25560.00');
    });

    it('si la Σ despejada no cierra contra la cabecera NO inventa base', () => {
      // Las dos mitades no describen el mismo documento. Emitir una base
      // derivada de números que no concuerdan es peor que fallar con
      // diagnóstico: la compuerta de coherencia sigue viva justo detrás.
      const lines = [line(852000, 4856.4)];
      const incoherente = [
        {
          invoice_item_id: null,
          tax_name: 'IVA',
          tax_rate: 19,
          // 500.000 no es la base de la que salieron 4.856,40 al 19 %.
          taxable_amount: 500000,
          tax_amount: 4856.4,
          tax_type: 'iva',
        },
      ];

      attachContrato(lines, [CONTRATO[0]], incoherente);

      expect((lines[0] as any).taxes).toBeUndefined();
    });

    it('el contrato EXENTO se deja como está: de una cuota cero no se despeja nada', () => {
      const lines = [line(852000, 0)];
      const exento = [
        {
          invoice_item_id: null,
          tax_name: 'IVA',
          tax_rate: 0,
          taxable_amount: 0,
          tax_amount: 0,
          tax_type: 'iva',
        },
      ];

      attachContrato(lines, [CONTRATO[0]], exento);

      expect((lines[0] as any).taxes).toBeUndefined();
    });
  });
});
