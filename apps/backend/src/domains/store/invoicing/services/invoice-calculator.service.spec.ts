import { Prisma } from '@prisma/client';
import {
  InvoiceCalculatorInput,
  InvoiceCalculatorService,
} from './invoice-calculator.service';

/**
 * El servicio es PURO (sin Prisma, sin ALS, sin HTTP), así que se instancia con
 * `new` en vez de armar un `Test.createTestingModule`. Ese es justamente el
 * punto de haberlo separado: la aritmética fiscal se tiene que poder verificar
 * a mano, sin levantar Nest.
 */
describe('InvoiceCalculatorService', () => {
  let service: InvoiceCalculatorService;

  beforeEach(() => {
    service = new InvoiceCalculatorService();
  });

  /** Atajo: una línea con un solo impuesto. */
  const oneLine = (
    line: InvoiceCalculatorInput['items'][number],
  ): InvoiceCalculatorInput => ({ items: [line] });

  describe('IVA 19 % — el caso base', () => {
    it('calcula base, impuesto y total de una línea exclusiva', () => {
      const result = service.calculate(
        oneLine({
          description: 'Producto A',
          quantity: 2,
          unit_price: 50000,
          taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
        }),
      );

      const [line] = result.lines;
      expect(line.gross_amount).toBe('100000.00');
      expect(line.line_extension_amount).toBe('100000.00');
      expect(line.tax_amount).toBe('19000.00');
      expect(line.total_amount).toBe('119000.00');

      expect(result.totals.total_before_tax).toBe('100000.00');
      expect(result.totals.tax_iva).toBe('19000.00');
      expect(result.totals.total_amount).toBe('119000.00');
    });

    it('resta el descuento antes de gravar', () => {
      const result = service.calculate(
        oneLine({
          quantity: 1,
          unit_price: 100000,
          discount_amount: 10000,
          taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
        }),
      );

      const [line] = result.lines;
      expect(line.gross_amount).toBe('100000.00');
      expect(line.discount_amount).toBe('10000.00');
      expect(line.net_entered_amount).toBe('90000.00');
      expect(line.line_extension_amount).toBe('90000.00');
      // 90.000 × 19 % — NO 100.000 × 19 %: la base es neta de descuento.
      expect(line.tax_amount).toBe('17100.00');
      expect(line.total_amount).toBe('107100.00');
    });

    it('escala el importe por la *price unit* (precio por kilo, stock en gramos)', () => {
      const result = service.calculate(
        oneLine({
          description: 'Queso a $28.000/kg, 2.500 g',
          quantity: 2500,
          unit_price: 28000,
          price_unit_quantity: 1000,
          taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
        }),
      );

      // Sin el divisor esto declararía $70.000.000 por una venta de $70.000.
      expect(result.lines[0].line_extension_amount).toBe('70000.00');
      expect(result.totals.tax_iva).toBe('13300.00');
    });
  });

  describe('EL DEFECTO — el servidor ya no confía en el cliente', () => {
    it('calcula el IVA aunque el frontend mande tax_amount: 0', () => {
      const result = service.calculate(
        oneLine({
          quantity: 1,
          unit_price: 100000,
          taxes: [
            {
              tax_name: 'IVA',
              tax_rate: 19,
              tax_type: 'iva',
              // Literalmente lo que manda invoice-create.component.ts:731.
              tax_amount: 0,
            },
          ],
        }),
      );

      // Antes se persistía 0 y la factura salía con IVA cero.
      expect(result.lines[0].tax_amount).toBe('19000.00');
      expect(result.lines[0].taxes[0].tax_amount).toBe('19000.00');
      expect(result.totals.tax_iva).toBe('19000.00');
      expect(result.totals.total_amount).toBe('119000.00');
    });

    it('reporta la divergencia en vez de callarla', () => {
      const result = service.calculate(
        oneLine({
          description: 'Producto A',
          quantity: 1,
          unit_price: 100000,
          taxes: [
            { tax_name: 'IVA', tax_rate: 19, tax_type: 'iva', tax_amount: 0 },
          ],
        }),
      );

      expect(result.divergences).toHaveLength(1);
      expect(result.divergences[0]).toMatchObject({
        scope: 'line_tax',
        line_index: 0,
        line_description: 'Producto A',
        tax_name: 'IVA',
        tax_type: 'iva',
        expected: '19000.00',
        received: '0.00',
        difference: '-19000.00',
      });
    });

    it('no lanza excepciones: la política la decide el llamador', () => {
      expect(() =>
        service.calculate(
          oneLine({
            quantity: 1,
            unit_price: 100000,
            taxes: [
              { tax_name: 'IVA', tax_rate: 19, tax_type: 'iva', tax_amount: 0 },
            ],
          }),
        ),
      ).not.toThrow();
    });

    it('no reporta nada cuando el cliente acertó', () => {
      const result = service.calculate(
        oneLine({
          quantity: 1,
          unit_price: 100000,
          taxes: [
            {
              tax_name: 'IVA',
              tax_rate: 19,
              tax_type: 'iva',
              tax_amount: 19000,
            },
          ],
        }),
      );

      expect(result.divergences).toEqual([]);
    });

    it('tolera un centavo (el cliente redondea donde el anexo trunca)', () => {
      const within = service.calculate(
        oneLine({
          quantity: 1,
          unit_price: 100000,
          taxes: [
            {
              tax_name: 'IVA',
              tax_rate: 19,
              tax_type: 'iva',
              tax_amount: 19000.01,
            },
          ],
        }),
      );
      expect(within.divergences).toEqual([]);

      const beyond = service.calculate(
        oneLine({
          quantity: 1,
          unit_price: 100000,
          taxes: [
            {
              tax_name: 'IVA',
              tax_rate: 19,
              tax_type: 'iva',
              tax_amount: 19000.02,
            },
          ],
        }),
      );
      expect(beyond.divergences).toHaveLength(1);
      expect(beyond.divergences[0].scope).toBe('line_tax');
    });

    it('marca la línea legacy con importe pero sin tarifa de la que derivarlo', () => {
      const result = service.calculate(
        oneLine({ quantity: 1, unit_price: 100000, tax_amount: 19000 }),
      );

      expect(result.lines[0].tax_amount).toBe('0.00');
      expect(result.divergences).toHaveLength(1);
      expect(result.divergences[0]).toMatchObject({
        scope: 'untaxed_line_with_amount',
        expected: '0.00',
        received: '19000.00',
      });
    });
  });

  describe('is_inclusive — despeje hacia atrás', () => {
    it('deriva base y cuota de un precio con IVA incluido', () => {
      const result = service.calculate(
        oneLine({
          quantity: 1,
          unit_price: 119000,
          is_inclusive: true,
          taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
        }),
      );

      const [line] = result.lines;
      expect(line.net_entered_amount).toBe('119000.00');
      // 119.000 / 1,19
      expect(line.line_extension_amount).toBe('100000.00');
      expect(line.tax_amount).toBe('19000.00');
      expect(line.total_amount).toBe('119000.00');
      expect(line.is_inclusive).toBe(true);
    });

    it('despeja contra la SUMA de tarifas, no en cascada (IVA 19 % + INC 8 %)', () => {
      const result = service.calculate(
        oneLine({
          quantity: 1,
          unit_price: 127000,
          is_inclusive: true,
          taxes: [
            { tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' },
            { tax_name: 'INC', tax_rate: 8, tax_type: 'inc' },
          ],
        }),
      );

      const [line] = result.lines;
      // 127.000 / (1 + 0,19 + 0,08) = 100.000 exacto.
      // En cascada (127.000 / 1,19 / 1,08) daría 98.847,63: una base ~1,5 %
      // más baja, menos IVA declarado, y un ValImp1 que la DIAN no reproduce.
      expect(line.line_extension_amount).toBe('100000.00');
      expect(line.taxes[0].tax_amount).toBe('19000.00');
      expect(line.taxes[1].tax_amount).toBe('8000.00');
      expect(line.total_amount).toBe('127000.00');
    });

    it('deja los impuestos exclusivos fuera del divisor (IVA incluido + ICA encima)', () => {
      const result = service.calculate(
        oneLine({
          quantity: 1,
          unit_price: 119000,
          taxes: [
            {
              tax_name: 'IVA',
              tax_rate: 19,
              tax_type: 'iva',
              is_inclusive: true,
            },
            // 7 ‰ = 0,7 %, sobre la base neta, encima del precio.
            {
              tax_name: 'ICA',
              tax_rate: 7,
              tax_type: 'ica',
              is_inclusive: false,
            },
          ],
        }),
      );

      const [line] = result.lines;
      expect(line.line_extension_amount).toBe('100000.00');
      expect(line.taxes[0].tax_amount).toBe('19000.00');
      expect(line.taxes[1].tax_amount).toBe('700.00');
      expect(line.total_amount).toBe('119700.00');
    });

    it('acepta el centavo que el truncado se lleva, en vez de romper base × tarifa', () => {
      const result = service.calculate(
        oneLine({
          quantity: 1,
          unit_price: 100,
          is_inclusive: true,
          taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
        }),
      );

      const [line] = result.lines;
      // 100 / 1,19 = 84,033613... → 84,03 (truncado, §11.2)
      expect(line.line_extension_amount).toBe('84.03');
      // 84,03 × 0,19 = 15,9657 → 15,96
      expect(line.tax_amount).toBe('15.96');
      // 84,03 + 15,96 = 99,99, un centavo bajo el precio de mostrador.
      // Es deliberado: la DIAN valida TaxAmount = TaxableAmount × Percent, así
      // que inflar la cuota para cuadrar con los $100 rompería esa regla.
      expect(line.total_amount).toBe('99.99');
    });
  });

  /**
   * DESCUENTOS, de punta a punta.
   *
   * El descuento es el único dato de la línea que toca las TRES magnitudes que
   * la DIAN revalida a la vez —base gravable, cuota y total— y el defecto que
   * produce no se ve: la factura cuadra consigo misma, sólo que declara IVA
   * sobre una base que el cliente no pagó (o menos IVA del debido, si se
   * descuenta dos veces). Estos casos fijan el orden de las operaciones.
   *
   * Vendix origina el descuento SIEMPRE por línea: `CreateInvoiceDto` no expone
   * un descuento de documento, y `invoices.discount_amount` es exactamente la Σ
   * de los de línea (ver `totals.discount_amount`). Esa igualdad es lo que hace
   * que `UblCommonBuilder.documentDiscount` calcule un remanente cero y no emita
   * ningún `cac:AllowanceCharge` de cabecera que reste dos veces.
   */
  describe('Descuentos — el impuesto se calcula sobre la base YA descontada', () => {
    it('el descuento de una línea INCLUSIVA se resta ANTES de despejar la base', () => {
      const result = service.calculate(
        oneLine({
          description: '119.000 IVA incluido con 11.900 de descuento',
          quantity: 1,
          unit_price: 119000,
          discount_amount: 11900,
          is_inclusive: true,
          taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
        }),
      );

      const [line] = result.lines;
      // El descuento vive en la moneda CAPTURADA, o sea con el IVA dentro.
      expect(line.discount_amount).toBe('11900.00');
      expect(line.net_entered_amount).toBe('107100.00');
      // 107.100 / 1,19 = 90.000. Despejar ANTES de descontar habría dado
      // 100.000 − 11.900 = 88.100 de base y 16.739 de cuota: la línea declararía
      // 361 pesos menos de IVA y un total de 104.839 contra los 107.100 que el
      // cliente efectivamente paga.
      expect(line.line_extension_amount).toBe('90000.00');
      expect(line.tax_amount).toBe('17100.00');
      expect(line.total_amount).toBe('107100.00');
    });

    it('descuenta por línea y agrega: la cabecera es la Σ de lo ya descontado', () => {
      const result = service.calculate({
        items: [
          {
            description: 'Con descuento',
            quantity: 1,
            unit_price: 200000,
            discount_amount: 50000,
            taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
          },
          {
            description: 'Sin descuento',
            quantity: 1,
            unit_price: 100000,
            taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
          },
        ],
      });

      // El bruto capturado sigue disponible, pero no es la base.
      expect(result.totals.gross_subtotal).toBe('300000.00');
      expect(result.totals.discount_amount).toBe('50000.00');
      // 150.000 + 100.000 — `cbc:LineExtensionAmount` de cabecera (FAU14).
      expect(result.totals.total_before_tax).toBe('250000.00');
      // 28.500 + 19.000, nunca 57.000 (que sería gravar el bruto).
      expect(result.totals.tax_iva).toBe('47500.00');
      expect(result.totals.total_amount).toBe('297500.00');

      // La fila de cabecera declara la base DESCONTADA: es la que el XML emite
      // como `cac:TaxSubtotal/cbc:TaxableAmount` y contra la que la DIAN aplica
      // `TaxAmount = TaxableAmount × Percent / 100`.
      expect(result.header_taxes).toHaveLength(1);
      expect(result.header_taxes[0].taxable_amount).toBe('250000.00');
      expect(result.header_taxes[0].tax_amount).toBe('47500.00');
    });

    it('descuenta una sola vez: `discount_amount` no vuelve a restarse del total', () => {
      const result = service.calculate(
        oneLine({
          quantity: 1,
          unit_price: 100000,
          discount_amount: 30000,
          taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
        }),
      );

      const { totals } = result;
      // La identidad que la DIAN recomputa. Restar además el descuento acá —el
      // error natural, porque `discount_amount` está en el mismo objeto— daría
      // 53.300 y rompería `base + tributos = PayableAmount`.
      expect(totals.total_amount).toBe('83300.00');
      expect(totals.total_amount).toBe(totals.tax_inclusive_amount);
      expect(
        new Prisma.Decimal(totals.total_before_tax)
          .plus(totals.tax_amount)
          .toFixed(2),
      ).toBe(totals.total_amount);
    });

    it('un descuento con centavos trunca la base antes de gravarla, no después', () => {
      const result = service.calculate(
        oneLine({
          quantity: 1,
          unit_price: 100000,
          discount_amount: 33333.335,
          taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
        }),
      );

      const [line] = result.lines;
      // 100.000 − 33.333,335 = 66.666,665 → 66.666,66 (truncado, §11.2).
      expect(line.line_extension_amount).toBe('66666.66');
      // 66.666,66 × 0,19 = 12.666,6654 → 12.666,66. Gravar la base en precisión
      // plena daría 12.666,67, un centavo que la DIAN no puede reproducir desde
      // el XML —donde la base ya viaja truncada— y que rompe la regla
      // aritmética del `cac:TaxSubtotal`.
      expect(line.tax_amount).toBe('12666.66');
      expect(line.total_amount).toBe('79333.32');
    });

    it('un descuento mayor que el precio no produce base ni impuesto negativos', () => {
      const result = service.calculate(
        oneLine({
          quantity: 1,
          unit_price: 50000,
          discount_amount: 80000,
          taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
        }),
      );

      const [line] = result.lines;
      // Es un error de captura, no una base a declarar: un importe en rojo en
      // `cbc:LineExtensionAmount` es rechazo, y `-0.00` en el XML también.
      expect(line.line_extension_amount).toBe('0.00');
      expect(line.tax_amount).toBe('0.00');
      expect(result.totals.total_amount).toBe('0.00');
    });
  });

  describe('Multi-impuesto por línea', () => {
    it('grava IVA e INC exclusivos sobre la misma base', () => {
      const result = service.calculate(
        oneLine({
          quantity: 1,
          unit_price: 100000,
          taxes: [
            { tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' },
            { tax_name: 'INC', tax_rate: 8, tax_type: 'inc' },
          ],
        }),
      );

      const [line] = result.lines;
      expect(line.taxes.map((t) => t.taxable_amount)).toEqual([
        '100000.00',
        '100000.00',
      ]);
      expect(line.tax_amount).toBe('27000.00');
      expect(line.total_amount).toBe('127000.00');

      expect(result.totals.tax_iva).toBe('19000.00');
      expect(result.totals.tax_inc).toBe('8000.00');
      expect(result.totals.tax_ica).toBe('0.00');
      expect(result.totals.tax_other).toBe('0.00');
    });

    it('respeta una base explícita distinta por impuesto (régimen AIU)', () => {
      const result = service.calculate(
        oneLine({
          quantity: 1,
          unit_price: 1000000,
          taxes: [
            {
              tax_name: 'IVA',
              tax_rate: 19,
              tax_type: 'iva',
              // En AIU el IVA grava solo la utilidad, no el total facturado.
              taxable_amount: 300000,
            },
          ],
        }),
      );

      const [line] = result.lines;
      expect(line.line_extension_amount).toBe('1000000.00');
      expect(line.taxes[0].taxable_amount).toBe('300000.00');
      expect(line.taxes[0].tax_amount).toBe('57000.00');
      expect(line.total_amount).toBe('1057000.00');
    });

    it('trata el ICA en por mil, no en porcentaje', () => {
      const result = service.calculate(
        oneLine({
          quantity: 1,
          unit_price: 1000000,
          taxes: [{ tax_name: 'ICA', tax_rate: 7, tax_type: 'ica' }],
        }),
      );

      const [tax] = result.lines[0].taxes;
      expect(tax.rate_basis).toBe('per_mil');
      expect(tax.dian_tax_code).toBe('03');
      // 7 ‰ = 0,7 % ⇒ 7.000, no 70.000.
      expect(tax.tax_amount).toBe('7000.00');
      expect(result.totals.tax_ica).toBe('7000.00');
    });
  });

  describe('Exento (0 %) vs excluido (sin impuesto) — no son lo mismo', () => {
    it('exento: emite una fila de impuesto al 0 %', () => {
      const result = service.calculate(
        oneLine({
          quantity: 1,
          unit_price: 100000,
          taxes: [{ tax_name: 'IVA', tax_rate: 0, tax_type: 'iva' }],
        }),
      );

      expect(result.lines[0].taxes).toHaveLength(1);
      expect(result.lines[0].taxes[0]).toMatchObject({
        dian_tax_code: '01',
        tax_rate: '0.00',
        taxable_amount: '100000.00',
        tax_amount: '0.00',
      });
      // El esquema existe: el XML emitirá un TaxSubtotal con Percent 0.00.
      expect(result.tax_schemes).toHaveLength(1);
      expect(result.header_taxes).toHaveLength(1);
      expect(result.totals.total_amount).toBe('100000.00');
    });

    it('excluido: no emite ninguna fila de impuesto', () => {
      const result = service.calculate(
        oneLine({ quantity: 1, unit_price: 100000 }),
      );

      expect(result.lines[0].taxes).toEqual([]);
      // Sin esquema no hay TaxSubtotal en el XML — que es exactamente la
      // diferencia entre un bien exento y uno excluido.
      expect(result.tax_schemes).toEqual([]);
      expect(result.header_taxes).toEqual([]);
      expect(result.totals.total_amount).toBe('100000.00');
    });

    it('el total coincide pero la estructura no', () => {
      const exento = service.calculate(
        oneLine({
          quantity: 1,
          unit_price: 100000,
          taxes: [{ tax_name: 'IVA', tax_rate: 0, tax_type: 'iva' }],
        }),
      );
      const excluido = service.calculate(
        oneLine({ quantity: 1, unit_price: 100000 }),
      );

      expect(exento.totals.total_amount).toBe(excluido.totals.total_amount);
      expect(exento.tax_schemes.length).not.toBe(excluido.tax_schemes.length);
    });
  });

  describe('Truncado, no redondeo (Anexo 1.9 §11.2)', () => {
    it('baja el tercer decimal ≥ 5 en vez de subir el centavo', () => {
      const result = service.calculate(
        oneLine({
          quantity: 1,
          unit_price: 100.05,
          taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
        }),
      );

      // 100,05 × 0,19 = 19,0095 → redondeado sería 19,01; truncado es 19,00.
      expect(result.lines[0].tax_amount).toBe('19.00');
      expect(result.lines[0].total_amount).toBe('119.05');
    });

    it('trunca también sobre cantidades fraccionadas', () => {
      const result = service.calculate(
        oneLine({
          quantity: 3,
          unit_price: 33.33,
          taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
        }),
      );

      expect(result.lines[0].line_extension_amount).toBe('99.99');
      // 99,99 × 0,19 = 18,9981 → 18,99 (redondeado sería 19,00).
      expect(result.lines[0].tax_amount).toBe('18.99');
    });

    it('suma valores YA truncados: la cabecera es la suma de lo que va al XML', () => {
      // Dos líneas de 10,005. Si la cabecera sumara en precisión plena y
      // truncara al final daría 20,01, mientras el XML lleva 10,00 + 10,00 =
      // 20,00 → descuadre FAU14 y rechazo.
      const result = service.calculate({
        items: [
          { quantity: 1, unit_price: 10.005 },
          { quantity: 1, unit_price: 10.005 },
        ],
      });

      expect(result.lines.map((l) => l.line_extension_amount)).toEqual([
        '10.00',
        '10.00',
      ]);
      expect(result.totals.total_before_tax).toBe('20.00');
    });
  });

  describe('Retenciones — NO restan del total (Anexo 1.9 §11.9.1)', () => {
    const base_invoice: InvoiceCalculatorInput = {
      items: [
        {
          quantity: 1,
          unit_price: 1000000,
          taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
        },
      ],
    };

    it('el total es idéntico con y sin retención', () => {
      const sin = service.calculate(base_invoice);
      const con = service.calculate({
        ...base_invoice,
        withholdings: [
          {
            withholding_type: 'retefuente',
            concept_code: 'compras_generales',
            rate: 2.5,
          },
        ],
      });

      expect(con.totals.total_amount).toBe(sin.totals.total_amount);
      expect(con.totals.total_amount).toBe('1190000.00');
      expect(con.totals.tax_inclusive_amount).toBe('1190000.00');
      // Calculada y devuelta aparte, nunca netada.
      expect(con.totals.withholding_amount).toBe('25000.00');
    });

    it('retefuente retiene sobre la base gravable', () => {
      const result = service.calculate({
        ...base_invoice,
        withholdings: [{ withholding_type: 'retefuente', rate: 2.5 }],
      });

      expect(result.withholdings[0]).toMatchObject({
        withholding_type: 'retefuente',
        base: '1000000.00',
        amount: '25000.00',
        rate_basis: 'percent',
      });
    });

    it('reteIVA retiene sobre el IVA de la operación, no sobre el subtotal', () => {
      const result = service.calculate({
        ...base_invoice,
        withholdings: [{ withholding_type: 'reteiva', rate: 15 }],
      });

      expect(result.withholdings[0]).toMatchObject({
        withholding_type: 'reteiva',
        base: '190000.00',
        amount: '28500.00',
      });
      expect(result.totals.total_amount).toBe('1190000.00');
    });

    it('reteICA se expresa en por mil', () => {
      const result = service.calculate({
        ...base_invoice,
        withholdings: [{ withholding_type: 'reteica', rate: 9.66 }],
      });

      expect(result.withholdings[0].rate_basis).toBe('per_mil');
      // 1.000.000 × 9,66 ‰ = 9.660
      expect(result.withholdings[0].amount).toBe('9660.00');
    });

    it('saca del documento una retención infiltrada como impuesto de línea', () => {
      const result = service.calculate(
        oneLine({
          quantity: 1,
          unit_price: 1000000,
          taxes: [
            { tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' },
            // `CreateInvoiceTaxDto.tax_type` admite retenciones; sin este
            // corte, "ReteICA" caería al heurístico por nombre y se
            // clasificaría como ICA ('03'), contaminando ValImp3 del CUFE.
            { tax_name: 'ReteICA', tax_rate: 10, tax_type: 'reteica' },
          ],
        }),
      );

      expect(result.totals.tax_ica).toBe('0.00');
      expect(
        result.tax_schemes.map((scheme) => scheme.dian_tax_code),
      ).not.toContain('03');
      expect(result.totals.total_amount).toBe('1190000.00');

      expect(result.withholdings).toHaveLength(1);
      expect(result.withholdings[0].amount).toBe('10000.00');
      expect(
        result.divergences.some((d) => d.scope === 'withholding_as_tax'),
      ).toBe(true);
    });

    it('reporta una retención cuyo importe declarado no cuadra', () => {
      const result = service.calculate({
        ...base_invoice,
        withholdings: [
          { withholding_type: 'retefuente', rate: 2.5, amount: 30000 },
        ],
      });

      expect(result.divergences).toHaveLength(1);
      expect(result.divergences[0]).toMatchObject({
        scope: 'withholding_amount',
        expected: '25000.00',
        received: '30000.00',
        difference: '5000.00',
      });
    });
  });

  describe('Anticipos — informativos desde el Anexo 1.8', () => {
    it('no restan del total', () => {
      const result = service.calculate({
        items: [
          {
            quantity: 1,
            unit_price: 1000000,
            taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
          },
        ],
        prepaid_amount: 500000,
      });

      expect(result.totals.prepaid_amount).toBe('500000.00');
      expect(result.totals.total_amount).toBe('1190000.00');
    });
  });

  describe('Agregación por esquema DIAN (ValImp1/2/3 del CUFE)', () => {
    it('agrupa por el código de esquema y respeta el orden 01 → 04 → 03', () => {
      const result = service.calculate({
        items: [
          {
            quantity: 1,
            unit_price: 100000,
            taxes: [
              { tax_name: 'ICA', tax_rate: 7, tax_type: 'ica' },
              { tax_name: 'INC', tax_rate: 8, tax_type: 'inc' },
              { tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' },
            ],
          },
        ],
      });

      expect(result.tax_schemes.map((s) => s.dian_tax_code)).toEqual([
        '01',
        '04',
        '03',
      ]);
      expect(result.tax_schemes.map((s) => s.scheme_name)).toEqual([
        'IVA',
        'INC',
        'ICA',
      ]);
      expect(result.totals.tax_iva).toBe('19000.00');
      expect(result.totals.tax_inc).toBe('8000.00');
      expect(result.totals.tax_ica).toBe('700.00');
    });

    it('clasifica por tax_type persistido aunque el nombre mienta', () => {
      const result = service.calculate(
        oneLine({
          quantity: 1,
          unit_price: 100000,
          taxes: [
            // Nombre libre del usuario; el tipo fiscal manda.
            { tax_name: 'Impuesto al consumo', tax_rate: 8, tax_type: 'inc' },
          ],
        }),
      );

      expect(result.lines[0].taxes[0].dian_tax_code).toBe('04');
      expect(result.totals.tax_inc).toBe('8000.00');
      expect(result.totals.tax_iva).toBe('0.00');
    });

    it('trata una fila sin tax_type como IVA', () => {
      const result = service.calculate(
        oneLine({
          quantity: 1,
          unit_price: 100000,
          taxes: [{ tax_name: 'IVA', tax_rate: 19 }],
        }),
      );

      expect(result.lines[0].taxes[0].tax_type).toBe('iva');
      expect(result.lines[0].taxes[0].dian_tax_code).toBe('01');
      expect(result.totals.tax_iva).toBe('19000.00');
    });

    it('agrupa dos líneas con el mismo impuesto en una sola fila de cabecera', () => {
      const result = service.calculate({
        items: [
          {
            quantity: 1,
            unit_price: 100000,
            taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
          },
          {
            quantity: 1,
            unit_price: 200000,
            taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
          },
        ],
      });

      expect(result.header_taxes).toHaveLength(1);
      expect(result.header_taxes[0]).toMatchObject({
        tax_name: 'IVA',
        tax_rate: '19.00',
        taxable_amount: '300000.00',
        tax_amount: '57000.00',
      });
    });

    it('separa las tarifas distintas del mismo impuesto', () => {
      const result = service.calculate({
        items: [
          {
            quantity: 1,
            unit_price: 100000,
            taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
          },
          {
            quantity: 1,
            unit_price: 100000,
            taxes: [{ tax_name: 'IVA', tax_rate: 5, tax_type: 'iva' }],
          },
        ],
      });

      expect(result.header_taxes).toHaveLength(2);
      // Pero un solo esquema: los dos son IVA ⇒ un único ValImp1.
      expect(result.tax_schemes).toHaveLength(1);
      expect(result.totals.tax_iva).toBe('24000.00');
    });
  });

  describe('Identidad aritmética que valida la DIAN', () => {
    const complex: InvoiceCalculatorInput = {
      items: [
        {
          description: 'Exclusivo con descuento',
          quantity: 3,
          unit_price: 33333,
          discount_amount: 999,
          taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
        },
        {
          description: 'Inclusivo IVA + INC',
          quantity: 2,
          unit_price: 63500,
          is_inclusive: true,
          taxes: [
            { tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' },
            { tax_name: 'INC', tax_rate: 8, tax_type: 'inc' },
          ],
        },
        {
          description: 'Exento',
          quantity: 1,
          unit_price: 45000,
          taxes: [{ tax_name: 'IVA', tax_rate: 0, tax_type: 'iva' }],
        },
        {
          description: 'Excluido',
          quantity: 7,
          unit_price: 1234.56,
        },
      ],
      withholdings: [{ withholding_type: 'retefuente', rate: 2.5 }],
      prepaid_amount: 10000,
    };

    const sum = (values: string[]): string =>
      values
        .reduce(
          (acc, value) => acc.plus(new Prisma.Decimal(value)),
          new Prisma.Decimal(0),
        )
        .toFixed(2);

    it('la suma de las líneas es la base de la cabecera (FAU14)', () => {
      const result = service.calculate(complex);
      expect(sum(result.lines.map((l) => l.line_extension_amount))).toBe(
        result.totals.total_before_tax,
      );
    });

    it('la suma de los impuestos de línea es el TaxTotal', () => {
      const result = service.calculate(complex);
      expect(sum(result.lines.map((l) => l.tax_amount))).toBe(
        result.totals.tax_amount,
      );
    });

    it('base + impuestos = total pagadero', () => {
      const result = service.calculate(complex);
      expect(
        sum([result.totals.total_before_tax, result.totals.tax_amount]),
      ).toBe(result.totals.total_amount);
    });

    it('ValImp1 + ValImp2 + ValImp3 + otros = TaxTotal', () => {
      const result = service.calculate(complex);
      expect(
        sum([
          result.totals.tax_iva,
          result.totals.tax_inc,
          result.totals.tax_ica,
          result.totals.tax_other,
        ]),
      ).toBe(result.totals.tax_amount);
    });

    it('la suma de los totales de línea es el total del documento', () => {
      const result = service.calculate(complex);
      expect(sum(result.lines.map((l) => l.total_amount))).toBe(
        result.totals.total_amount,
      );
    });

    it('los esquemas suman exactamente el TaxTotal', () => {
      const result = service.calculate(complex);
      expect(sum(result.tax_schemes.map((s) => s.tax_amount))).toBe(
        result.totals.tax_amount,
      );
    });

    it('las filas de cabecera suman exactamente el TaxTotal', () => {
      const result = service.calculate(complex);
      expect(sum(result.header_taxes.map((t) => t.tax_amount))).toBe(
        result.totals.tax_amount,
      );
    });

    it('ni la retención ni el anticipo tocan el total', () => {
      const result = service.calculate(complex);
      const without = service.calculate({ items: complex.items });
      expect(result.totals.total_amount).toBe(without.totals.total_amount);
      expect(result.totals.withholding_amount).not.toBe('0.00');
      expect(result.totals.prepaid_amount).toBe('10000.00');
    });
  });

  describe('Entrada defensiva', () => {
    it('devuelve ceros con un documento sin líneas', () => {
      const result = service.calculate({ items: [] });
      expect(result.totals).toMatchObject({
        total_before_tax: '0.00',
        tax_amount: '0.00',
        total_amount: '0.00',
        withholding_amount: '0.00',
        prepaid_amount: '0.00',
      });
      expect(result.divergences).toEqual([]);
    });

    it('nunca emite una base negativa cuando el descuento supera el precio', () => {
      const result = service.calculate(
        oneLine({
          quantity: 1,
          unit_price: 100,
          discount_amount: 500,
          is_inclusive: true,
          taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
        }),
      );

      expect(result.lines[0].line_extension_amount).toBe('0.00');
      expect(result.lines[0].tax_amount).toBe('0.00');
      expect(result.totals.total_amount).toBe('0.00');
    });

    it('acepta Prisma.Decimal y strings además de number', () => {
      const result = service.calculate(
        oneLine({
          quantity: new Prisma.Decimal('2'),
          unit_price: '50000.00',
          taxes: [
            {
              tax_name: 'IVA',
              tax_rate: new Prisma.Decimal('19.00'),
              tax_type: 'iva',
            },
          ],
        }),
      );

      expect(result.lines[0].line_extension_amount).toBe('100000.00');
      expect(result.lines[0].tax_amount).toBe('19000.00');
    });
  });

  /**
   * AIU — el bloque que protege el error que NO se ve.
   *
   * Un contrato AIU mal clasificado no produce rechazo: produce una factura que
   * la DIAN acepta declarando menos IVA del debido. Estos casos fijan las dos
   * bases gravables y el piso legal para que un cambio futuro tenga que
   * romperlos antes de volver a mezclarlas.
   */
  describe('AIU — base gravable por régimen', () => {
    /**
     * Contrato de aseo por $100M: $90M de costo reembolsable (sin componente),
     * $6M de administración, $1M de imprevistos y $3M de utilidad.
     */
    const aiuContract = (
      aiu: InvoiceCalculatorInput['aiu'],
    ): InvoiceCalculatorInput => ({
      aiu,
      items: [
        {
          description: 'Costo reembolsable (nómina e insumos)',
          quantity: 1,
          unit_price: 90_000_000,
        },
        {
          description: 'Administración',
          quantity: 1,
          unit_price: 6_000_000,
          aiu_component: 'administracion',
          taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
        },
        {
          description: 'Imprevistos',
          quantity: 1,
          unit_price: 1_000_000,
          aiu_component: 'imprevistos',
          taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
        },
        {
          description: 'Utilidad',
          quantity: 1,
          unit_price: 3_000_000,
          aiu_component: 'utilidad',
          taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
        },
      ],
    });

    it('E.T. art. 462-1: grava el AIU COMPLETO (A+I+U) y nunca el costo', () => {
      const result = service.calculate(aiuContract({ taxable_basis: 'aiu' }));

      // La línea de costo reembolsable NO hace parte del AIU: sale sin grupo de
      // impuesto (regla CAX01), no con impuesto en cero.
      expect(result.lines[0].omit_tax_total).toBe(true);
      expect(result.lines[0].tax_amount).toBe('0.00');

      // Los tres componentes gravan.
      expect(result.lines[1].omit_tax_total).toBe(false);
      expect(result.lines[2].omit_tax_total).toBe(false);
      expect(result.lines[3].omit_tax_total).toBe(false);

      // IVA sobre $10M de AIU, no sobre los $100M del contrato.
      expect(result.totals.tax_iva).toBe('1900000.00');
      expect(result.aiu?.contract_value).toBe('100000000.00');
      expect(result.aiu?.aiu_value).toBe('10000000.00');
      expect(result.aiu?.taxable_base).toBe('10000000.00');
    });

    it('Decreto 1372/1992: grava SÓLO la utilidad', () => {
      const result = service.calculate(
        aiuContract({ taxable_basis: 'utilidad' }),
      );

      // Administración e imprevistos quedan fuera de la base y por tanto sin
      // `cac:TaxTotal` de línea.
      expect(result.lines[1].omit_tax_total).toBe(true);
      expect(result.lines[2].omit_tax_total).toBe(true);
      expect(result.lines[3].omit_tax_total).toBe(false);

      // IVA sobre $3M, no sobre $10M: la diferencia entre los dos regímenes es
      // exactamente lo que se declara de menos si se elige el equivocado.
      expect(result.totals.tax_iva).toBe('570000.00');
      expect(result.aiu?.taxable_base).toBe('3000000.00');
      // El AIU declarado sigue siendo el mismo; lo que cambia es qué grava.
      expect(result.aiu?.aiu_value).toBe('10000000.00');
    });

    it('Subtotal: declina el AIU y grava el contrato COMPLETO, costo incluido', () => {
      const result = service.calculate(
        aiuContract({ taxable_basis: 'subtotal', enforce_minimum_base: true }),
      );

      // Las CUATRO líneas gravan, incluida la de costo reembolsable
      // (`aiu_component` ausente): es exactamente lo que distingue esta base.
      expect(result.lines[0].omit_tax_total).toBe(false);
      expect(result.lines[1].omit_tax_total).toBe(false);
      expect(result.lines[2].omit_tax_total).toBe(false);
      expect(result.lines[3].omit_tax_total).toBe(false);

      // La base gravable es el contrato completo, no sólo el AIU.
      expect(result.aiu?.taxable_base).toBe('100000000.00');
      expect(result.aiu?.contract_value).toBe('100000000.00');
      // El AIU declarado sigue siendo el mismo dato informativo de siempre.
      expect(result.aiu?.aiu_value).toBe('10000000.00');

      // Sin piso: no hay régimen AIU al que aplicárselo. `enforce_minimum_base`
      // en `true` no lo activa por accidente bajo esta base.
      expect(
        result.divergences.some((d) => d.scope === 'aiu_base_below_minimum'),
      ).toBe(false);
    });

    /**
     * EL DOCUMENTO CAPTURABLE E INEMITIBLE — la divergencia tiene que VER la
     * línea de costo.
     *
     * Contrato de 100 M bajo `'subtotal'`: 90 M de costo reembolsable
     * capturados SIN impuesto y 10 M de A/I/U con IVA al 19 %. Bajo esta base el
     * costo ENTRA a la base gravable, así que capturarlo sin tarifa
     * sub-declara el IVA de los 90 M — nueve veces el daño de la factura 83.
     *
     * El defecto que este caso fija: la divergencia exigía
     * `aiu_component !== null`, que es una SEGUNDA derivación de «la línea entra
     * a la base». La primera es `omit_tax_total`, y las dos se separaron justo
     * en esta base, donde la línea sin componente sí grava. Resultado: CERO
     * divergencias en el calculador, captura exitosa, consecutivo gastado, y el
     * rechazo apareciendo recién al emitir en
     * `InvoiceFlowService.assertAiuLineTaxCoherence` con `INVOICING_AIU_004` —
     * un documento que existe, tiene número, y no se puede emitir nunca.
     *
     * Restaurar `aiu_component !== null` vuelve `sin_tarifa` a longitud 0 y este
     * caso falla. Es la única razón de que esté escrito con `toHaveLength(1)` y
     * no con un `some(...)`.
     */
    it('Subtotal: la línea de COSTO sin impuesto produce su divergencia', () => {
      const result = service.calculate(
        aiuContract({ taxable_basis: 'subtotal' }),
      );

      // El costo llega sin impuesto: es la línea 0 del contrato.
      expect(result.lines[0].taxes).toHaveLength(0);
      expect(result.lines[0].omit_tax_total).toBe(false);

      const sin_tarifa = result.divergences.filter(
        (d) => d.scope === 'aiu_taxable_line_without_tax',
      );
      // UNA divergencia, y en la línea del costo. Las tres de A/I/U declaran su
      // IVA, así que no divergen.
      expect(sin_tarifa).toHaveLength(1);
      expect(sin_tarifa[0].line_index).toBe(0);
      expect(sin_tarifa[0].line_description).toBe(
        'Costo reembolsable (nómina e insumos)',
      );
      // Sin componente que nombrar: el campo va ausente, no inventado.
      expect(sin_tarifa[0].tax_type).toBeUndefined();
      // El motor no conoce la tarifa del costo: informa el hecho, no el importe.
      expect(sin_tarifa[0].expected).toBe('0.00');
      expect(sin_tarifa[0].received).toBe('0.00');
      expect(sin_tarifa[0].difference).toBe('0.00');

      // La contradicción que la divergencia explica: la base gravable declarada
      // es el contrato entero, pero el impuesto calculado es el 19 % de 10 M.
      // Los dos números pueden convivir —los produjo la captura— pero no pueden
      // viajar sin que la respuesta diga por qué.
      expect(result.aiu?.taxable_base).toBe('100000000.00');
      expect(result.totals.tax_amount).toBe('1900000.00');
    });

    /**
     * La contracara: bajo `'aiu'` y `'utilidad'` el nuevo predicado NO inventa
     * divergencias sobre la línea de costo. Ahí esa línea no entra a la base
     * (`omit_tax_total: true`), y exigirle impuesto habría vuelto inemitible
     * TODA factura AIU del régimen normal — el falso positivo que un
     * `!omit_tax_total` mal razonado produciría.
     */
    it.each(['aiu', 'utilidad'] as const)(
      'base «%s»: el costo sin impuesto NO diverge, porque no entra a la base',
      (basis) => {
        const result = service.calculate(aiuContract({ taxable_basis: basis }));

        expect(result.lines[0].omit_tax_total).toBe(true);
        expect(
          result.divergences.filter(
            (d) => d.scope === 'aiu_taxable_line_without_tax',
          ),
        ).toHaveLength(0);
      },
    );

    it('reporta —sin inflar— el AIU que no llega al 10 % del contrato', () => {
      const result = service.calculate({
        aiu: { taxable_basis: 'aiu' },
        items: [
          { description: 'Costo', quantity: 1, unit_price: 95_000_000 },
          {
            description: 'Utilidad',
            quantity: 1,
            unit_price: 5_000_000,
            aiu_component: 'utilidad',
            taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
          },
        ],
      });

      const floor = result.divergences.find(
        (d) => d.scope === 'aiu_base_below_minimum',
      );
      expect(floor).toBeDefined();
      expect(floor?.expected).toBe('10000000.00');
      expect(floor?.received).toBe('5000000.00');

      // La base NO se sube por cuenta propia: el AIU es una cifra pactada.
      expect(result.aiu?.taxable_base).toBe('5000000.00');
      expect(result.totals.tax_iva).toBe('950000.00');
    });

    it('el piso del 10 % NO aplica bajo Decreto 1372/1992', () => {
      const result = service.calculate({
        aiu: { taxable_basis: 'utilidad' },
        items: [
          { description: 'Obra', quantity: 1, unit_price: 95_000_000 },
          {
            description: 'Utilidad',
            quantity: 1,
            unit_price: 5_000_000,
            aiu_component: 'utilidad',
            taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
          },
        ],
      });

      expect(
        result.divergences.some((d) => d.scope === 'aiu_base_below_minimum'),
      ).toBe(false);
    });

    /**
     * El caso del céntimo: un AIU que no reparte exacto.
     *
     * Con un costo de $1.000.000 y un AIU del 10 % del contrato, el AIU exacto
     * es 1.000.000 × 10/90 = 111.111,111… — no cabe en dos decimales, y el
     * reparto 5/2/3 tampoco. El frontend deduce el AIU en céntimos enteros con
     * UNA división y deja el residuo en la utilidad, así que las tres líneas
     * suman el AIU y el AIU más el costo suman el contrato SIN céntimo suelto
     * (un céntimo de diferencia entre cabecera y líneas es rechazo FAU06).
     *
     * Lo que este caso fija es que ese redondeo no cruza el piso legal: el AIU
     * en céntimos queda hasta medio céntimo POR DEBAJO del exacto, pero
     * `minimum_base` se calcula con {@link dianAmount}, que TRUNCA, y el piso
     * truncado nunca supera al AIU declarado. Si alguien cambiara ese truncado
     * por un redondeo, o el reparto del frontend por un `floor`, este caso
     * empezaría a emitir una divergencia y la factura se frenaría por diez
     * milésimas de peso.
     */
    it('un AIU no divisible NO cae por debajo del piso: el piso se trunca', () => {
      const iva = [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' as const }];
      const result = service.calculate({
        aiu: { taxable_basis: 'aiu', enforce_minimum_base: true },
        items: [
          { description: 'Costo directo', quantity: 1, unit_price: 1_000_000 },
          {
            description: 'Administración',
            quantity: 1,
            unit_price: 55_555.55,
            aiu_component: 'administracion',
            taxes: iva,
          },
          {
            description: 'Imprevistos',
            quantity: 1,
            unit_price: 22_222.22,
            aiu_component: 'imprevistos',
            taxes: iva,
          },
          {
            // El residuo del reparto vive acá: gravable bajo los DOS regímenes,
            // así que el céntimo se declara de más, nunca de menos.
            description: 'Utilidad',
            quantity: 1,
            unit_price: 33_333.34,
            aiu_component: 'utilidad',
            taxes: iva,
          },
        ],
      });

      expect(result.aiu?.aiu_value).toBe('111111.11');
      expect(result.aiu?.contract_value).toBe('1111111.11');
      // 10 % de 1.111.111,11 es 111.111,111 — truncado a 111.111,11, que es
      // exactamente el AIU declarado.
      expect(result.aiu?.minimum_base).toBe('111111.11');
      expect(
        result.divergences.some((d) => d.scope === 'aiu_base_below_minimum'),
      ).toBe(false);

      // El contrato es costo + AIU al céntimo: sin descuadre de cabecera.
      // `total_before_tax` es el `ValFac` del CUFE y el
      // `cac:LegalMonetaryTotal/cbc:LineExtensionAmount` del XML.
      expect(result.totals.total_before_tax).toBe('1111111.11');
      // El IVA de cabecera es la SUMA de los IVAs de línea, cada uno truncado
      // a dos decimales (10555.55 + 4222.22 + 6333.33), y eso deja un céntimo
      // por debajo del 19 % de la base (21111.1109 → 21111.11). El número
      // correcto es el de la suma: la regla FAS02 compara el tributo de
      // cabecera contra sus subtotales, no contra base × tarifa. «Arreglarlo»
      // calculando el 19 % de la base es lo que descuadra el XML.
      expect(result.totals.tax_iva).toBe('21111.10');
    });

    it('descarta el impuesto que una línea fuera de base intente declarar', () => {
      const result = service.calculate({
        aiu: { taxable_basis: 'utilidad' },
        items: [
          {
            description: 'Administración',
            quantity: 1,
            unit_price: 1_000_000,
            aiu_component: 'administracion',
            // El cliente manda IVA en una línea que bajo este régimen NO grava.
            taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
          },
        ],
      });

      expect(result.lines[0].omit_tax_total).toBe(true);
      expect(result.lines[0].tax_amount).toBe('0.00');
      expect(result.lines[0].taxes).toHaveLength(0);
      expect(
        result.divergences.some(
          (d) => d.scope === 'aiu_untaxable_line_declares_tax',
        ),
      ).toBe(true);
    });

    it('sin bloque `aiu` el documento es normal y `aiu_component` se ignora', () => {
      const result = service.calculate({
        items: [
          {
            description: 'Utilidad',
            quantity: 1,
            unit_price: 1_000_000,
            aiu_component: 'utilidad',
            taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
          },
        ],
      });

      expect(result.aiu).toBeUndefined();
      expect(result.lines[0].omit_tax_total).toBe(false);
      expect(result.lines[0].tax_amount).toBe('190000.00');
    });
  });

  /**
   * Multi-impuesto por línea: dos tributos DISTINTOS sobre la misma base. El
   * XML necesita un `cac:TaxSubtotal` por cada uno, así que el motor tiene que
   * conservarlos separados en vez de agregarlos en un único importe.
   */
  describe('multi-impuesto por línea', () => {
    it('conserva IVA e INC separados en la línea y por esquema en la cabecera', () => {
      const result = service.calculate(
        oneLine({
          description: 'Menú de restaurante',
          quantity: 1,
          unit_price: 100_000,
          taxes: [
            { tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' },
            { tax_name: 'INC', tax_rate: 8, tax_type: 'inc' },
          ],
        }),
      );

      expect(result.lines[0].taxes).toHaveLength(2);
      expect(result.lines[0].tax_amount).toBe('27000.00');
      expect(result.totals.tax_iva).toBe('19000.00');
      expect(result.totals.tax_inc).toBe('8000.00');

      // Cabecera: una fila por esquema, no una sola con la suma.
      expect(result.header_taxes).toHaveLength(2);
    });
  });

  /**
   * La factura 83 de producción, reproducida a escala: el cliente declara IVA
   * SÓLO en Administración y deja Imprevistos y Utilidad limpios. Bajo
   * `et_462_1` los tres componentes hacen parte de la base gravable, así que el
   * documento sale corto — y la DIAN lo ACEPTA, porque es internamente
   * consistente. Faltan 95.000 COP que sólo se corrigen con nota crédito.
   *
   * Lo que el motor puede y no puede hacer acá está en el centro del diseño:
   * sabe QUÉ componentes gravan (lo decide el régimen) pero no A QUÉ TARIFA,
   * porque la tarifa depende del bien o servicio y este servicio no tiene el
   * catálogo. Por eso reporta el hecho con los tres importes en cero en vez de
   * inventar el faltante, y la decisión de no emitir la toma
   * `InvoicingService.recalculateDocument` con `INVOICING_AIU_004`.
   */
  describe('AIU — el componente gravable que llega sin tarifa', () => {
    const factura83 = (
      aiu: InvoiceCalculatorInput['aiu'],
      taxUtilidad = false,
    ): InvoiceCalculatorInput => ({
      aiu,
      items: [
        {
          description: 'Administracion',
          quantity: 1,
          unit_price: 1_000_000,
          aiu_component: 'administracion',
          taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
        },
        {
          description: 'Imprevistos',
          quantity: 1,
          unit_price: 200_000,
          aiu_component: 'imprevistos',
        },
        {
          description: 'Utilidad',
          quantity: 1,
          unit_price: 300_000,
          aiu_component: 'utilidad',
          ...(taxUtilidad
            ? { taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }] }
            : {}),
        },
      ],
    });

    it('reporta una divergencia por CADA componente gravable sin tarifa', () => {
      const result = service.calculate(factura83({ taxable_basis: 'aiu' }));

      const sin_tarifa = result.divergences.filter(
        (d) => d.scope === 'aiu_taxable_line_without_tax',
      );
      expect(sin_tarifa.map((d) => d.line_index)).toEqual([1, 2]);
      // El componente viaja en `tax_type` para que quien decide sepa DE QUÉ
      // parte del contrato se trata sin volver a leer las líneas.
      expect(sin_tarifa.map((d) => d.tax_type)).toEqual([
        'imprevistos',
        'utilidad',
      ]);

      // Los tres importes en cero NO son un descuido: el motor no puede afirmar
      // cuánto faltaba sin conocer la tarifa. Lo que informa es el hecho.
      expect(sin_tarifa[0].expected).toBe('0.00');
      expect(sin_tarifa[0].received).toBe('0.00');
      expect(sin_tarifa[0].difference).toBe('0.00');

      // El daño, en cifras: 190.000 declarados sobre una base de 1.500.000.
      expect(result.aiu?.taxable_base).toBe('1500000.00');
      expect(result.totals.tax_amount).toBe('190000.00');
    });

    it('con la tarifa declarada en las tres líneas la base cierra en 285.000', () => {
      // Es lo que el formulario del panel produce por defecto, y es la cifra
      // correcta: 19 % de 1.500.000. Los 95.000 de diferencia contra el caso
      // anterior son exactamente el faltante de la factura 83.
      const result = service.calculate({
        aiu: { taxable_basis: 'aiu' },
        items: factura83({ taxable_basis: 'aiu' }, true).items.map((item) => ({
          ...item,
          taxes: item.taxes ?? [
            { tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' },
          ],
        })),
      });

      expect(result.totals.tax_amount).toBe('285000.00');
      expect(
        result.divergences.filter(
          (d) => d.scope === 'aiu_taxable_line_without_tax',
        ),
      ).toHaveLength(0);
    });

    it('bajo Decreto 1372/1992 las mismas líneas NO divergen', () => {
      // Sólo la Utilidad grava, y es la única que necesita tarifa. El mismo
      // documento es correcto o incorrecto según el régimen: por eso el régimen
      // se congela en la factura y no se relee en la emisión.
      const result = service.calculate(
        factura83({ taxable_basis: 'utilidad' }, true),
      );

      expect(
        result.divergences.filter(
          (d) => d.scope === 'aiu_taxable_line_without_tax',
        ),
      ).toHaveLength(0);
      expect(result.totals.tax_amount).toBe('57000.00');
    });

    it('tarifa 0 explícita no es lo mismo que omitir el impuesto', () => {
      // Exento emite `cac:TaxTotal` con `cbc:Percent` en 0,00; excluido no lo
      // emite. Colapsar las dos cosas en «no tiene impuesto» borraría la
      // diferencia justo donde cambia el resultado — y dejaría al componente
      // exento indistinguible del sub-declarado.
      const result = service.calculate({
        aiu: { taxable_basis: 'utilidad' },
        items: [
          {
            description: 'Utilidad exenta',
            quantity: 1,
            unit_price: 300_000,
            aiu_component: 'utilidad',
            taxes: [{ tax_name: 'IVA exento', tax_rate: 0, tax_type: 'iva' }],
          },
        ],
      });

      expect(
        result.divergences.filter(
          (d) => d.scope === 'aiu_taxable_line_without_tax',
        ),
      ).toHaveLength(0);
      expect(result.lines[0].omit_tax_total).toBe(false);
      expect(result.lines[0].taxes).toHaveLength(1);
      expect(result.lines[0].taxes[0].tax_rate).toBe('0.00');
      expect(result.totals.tax_amount).toBe('0.00');
    });
  });
});
