import {
  aggregatePreviewTaxBreakdown,
  aggregatePreviewTotals,
  clearLineMathCache,
  computeLineMath,
  INCLUSIVE_ABSORB_CAP_CENTS,
  lineDiscountExceedsSubtotal,
  lineGross,
  normalizeRatePercent,
  previewTotalInWords,
} from './invoice-line-math';
import type { TaxSelection } from '../../../../../shared/components/tax-selector';

/**
 * D.10 — la previsión de la línea divide por `price_unit_quantity` IGUAL QUE EL
 * SERVIDOR.
 *
 * El espejo que estas pruebas cuidan vive en
 * `apps/backend/src/domains/store/invoicing/utils/dian-money.util.ts`:
 *
 *   lineGrossDecimal     = cantidad × precio ÷ divisor        (`dianLineGross`)
 *   lineExtensionDecimal = lineGrossDecimal − descuento       (`dianLineExtension`)
 *   priceUnitDivisor     = n > 1 ? n : 1
 *
 * El orden IMPORTA: el descuento se resta DESPUÉS de escalar porque es un
 * importe absoluto de la línea. Dividir `(cantidad × precio − descuento)`
 * produciría una cifra que el servidor no calcula — otra vez «una cifra en
 * pantalla y otra en la factura», el fallo que da nombre al plan.
 */
describe('invoice-line-math — price_unit_quantity (D.10)', () => {
  describe('producto con escala: la pantalla iguala al servidor', () => {
    it('producto 382 (base_price 18000, escala 12) con cantidad 1 ⇒ gross/base = 1500', () => {
      // `cbc:LineExtensionAmount` que devuelve la previsualización del backend
      // para esa misma línea: 18000 ÷ 12 = 1500.
      const math = computeLineMath({
        quantity: 1,
        unit_price: 18000,
        discount_amount: 0,
        price_unit_quantity: 12,
      });

      expect(math.gross).toBe(1500);
      expect(math.base).toBe(1500);
      expect(math.total).toBe(1500);
    });

    it('cantidad > 1 con escala > 1: 3 docenas a $18.000 la docena ⇒ 4500', () => {
      const math = computeLineMath({
        quantity: 3,
        unit_price: 18000,
        price_unit_quantity: 12,
      });

      expect(math.gross).toBe(4500);
      expect(math.base).toBe(4500);
    });

    it('el impuesto INCLUIDO se despeja sobre el bruto ya escalado', () => {
      const math = computeLineMath({
        quantity: 1,
        unit_price: 18000,
        price_unit_quantity: 12,
        taxes: [
          { tax_rate_id: 1, name: 'IVA', rate: 19, tax_type: 'iva', is_inclusive: true },
        ],
      });

      expect(math.gross).toBe(1500);
      expect(math.base).toBeCloseTo(1500 / 1.19, 10);
      expect(math.taxInclusive).toBeCloseTo(1500 - 1500 / 1.19, 10);
      // El total no cambia por despejar: 1500 sigue siendo lo que paga el cliente.
      expect(math.total).toBeCloseTo(1500, 10);
    });
  });

  describe('producto sin escala: la cifra NO se mueve', () => {
    const SIN_ESCALA = [undefined, null, 0, 1, -3, 'abc', '', 'no-numérico'];

    // Jasmine del repo no tiene `it.each`: el barrido de fallbacks va con un
    // bucle que registra un `it` por variante.
    for (const escala of SIN_ESCALA) {
      it(`fallback del backend con price_unit_quantity=${String(escala)} ⇒ divisor 1`, () => {
        // Ausente, 0, 1, negativo o no numérico ⇒ divisor 1 — el fallback
        // EXACTO de `priceUnitDivisor` (`dian-money.util.ts`). Idéntico, no
        // parecido: los 113 productos por pieza no pueden moverse un centavo.
        const math = computeLineMath({
          quantity: 2,
          unit_price: 5000,
          discount_amount: 0,
          price_unit_quantity: escala,
        });

        expect(math.gross).toBe(10000);
      });
    }
    it('la escala llega como STRING del catálogo y divide igual', () => {
      const math = computeLineMath({
        quantity: 1,
        unit_price: 18000,
        price_unit_quantity: '12',
      });

      expect(math.gross).toBe(1500);
    });
  });

  describe('el descuento se resta DESPUÉS de escalar (espejo de dianLineExtension)', () => {
    it('18000 ÷ 12 − 600 = 900, y NO (18000 − 600) ÷ 12 = 1450', () => {
      // El valor equivocado es exactamente el que saldría de dividir el
      // descuento también; si alguien invierte el orden, esta prueba lo delata.
      expect(lineGross({ quantity: 1, unit_price: 18000, price_unit_quantity: 12, discount_amount: 600 })).toBe(900);
      expect(lineGross({ quantity: 1, unit_price: 18000, price_unit_quantity: 12, discount_amount: 600 })).not.toBe(1450);
    });

    it('sin descuento el orden es indistinguible: 1500 en ambos', () => {
      expect(lineGross({ quantity: 1, unit_price: 18000, price_unit_quantity: 12, discount_amount: 0 })).toBe(1500);
    });
  });

  describe('lineDiscountExceedsSubtotal decide sobre el bruto YA ESCALADO', () => {
    it('un descuento holgado sobre el bruto inflado se come la línea escalada', () => {
      // Bruto inflado 18000: un descuento de 1500 parece pequeño. Contra el
      // bruto escalado 1500 es EXACTAMENTE la línea entera — y es contra ese
      // importe contra el que el servidor compara antes de tumbar
      // LINE_AMOUNT_NEGATIVE.
      expect(
        lineDiscountExceedsSubtotal({ quantity: 1, unit_price: 18000, price_unit_quantity: 12, discount_amount: 1500 }),
      ).toBeTrue();
      expect(
        lineDiscountExceedsSubtotal({ quantity: 1, unit_price: 18000, price_unit_quantity: 12, discount_amount: 1400 }),
      ).toBeFalse();
    });

    it('sin escala manda el comportamiento histórico, intacto', () => {
      expect(
        lineDiscountExceedsSubtotal({ quantity: 1, unit_price: 18000, discount_amount: 18000 }),
      ).toBeTrue();
      expect(
        lineDiscountExceedsSubtotal({ quantity: 1, unit_price: 18000, discount_amount: 17999 }),
      ).toBeFalse();
    });

    it('descuento 0 o línea vacía nunca exceden', () => {
      expect(
        lineDiscountExceedsSubtotal({ quantity: 1, unit_price: 18000, price_unit_quantity: 12, discount_amount: 0 }),
      ).toBeFalse();
      expect(lineDiscountExceedsSubtotal({})).toBeFalse();
    });
  });

  describe('el recorte a cero queda intacto', () => {
    it('descuento mayor que el bruto escalado ⇒ línea de cero, sin negativos', () => {
      expect(lineGross({ quantity: 1, unit_price: 18000, price_unit_quantity: 12, discount_amount: 2000 })).toBe(0);

      // Y sin escala, el recorte histórico no cambia:
      expect(lineGross({ quantity: 2, unit_price: 5000, discount_amount: 12000 })).toBe(0);
    });
  });
});

/**
 * A.3 (CP-facturacion-impuesto-incluido-redondeo) — el preview espeja el motor
 * en centavos enteros con la misma regla trunc+absorb.
 *
 * TODAS las cifras esperadas están calculadas A MANO (misma aritmética que los
 * comentarios de `tax-inclusive-math.regression.spec.ts` A.1, nunca llamando a
 * la función bajo prueba). La paridad que estos casos custodian es de
 * DESGLOSE (base + cada cuota), no solo de total: el total coincidía
 * trivialmente incluso en floats (F-011).
 */
describe('invoice-line-math — preview en centavos con trunc+absorb (A.3)', () => {
  const incl = (rate: number, extra: Partial<TaxSelection> = {}): TaxSelection => ({
    tax_rate_id: 1,
    rate,
    name: 'INC 8 %',
    tax_type: 'inc',
    is_inclusive: true,
    ...extra,
  });
  const iva19Incl = (extra: Partial<TaxSelection> = {}): TaxSelection => ({
    tax_rate_id: 2,
    rate: 19,
    name: 'IVA 19 %',
    tax_type: 'iva',
    is_inclusive: true,
    ...extra,
  });

  beforeEach(() => clearLineMathCache());

  describe('casos que cierran: preview == motor al centavo', () => {
    it('$3.000 con INC 8 % dentro ⇒ base 2777.78, cuota 222.22, total 3000.00', () => {
      // B0 = trunc(3000/1.08) = 2777.77; f(B0) = 2999.99.
      // +1¢: trunc(2777.78×0.08) = 222.22; f = 3000.00 ✓.
      const math = computeLineMath({
        quantity: 1,
        unit_price: 3000,
        taxes: [incl(8)],
      });
      expect(math.gross).toBe(3000);
      expect(math.base).toBe(2777.78);
      expect(math.taxInclusive).toBe(222.22);
      expect(math.taxAdditional).toBe(0);
      expect(math.total).toBe(3000);
      expect(math.baseCents).toBe(277778);
      expect(math.totalCents).toBe(300000);
      expect(math.unclosedResidualCents).toBe(0);
      // La cuota viaja truncada sobre la base FINAL, igual que `invoice_taxes`.
      expect(math.taxes).toHaveLength(1);
      expect(math.taxes[0].cents).toBe(22222);
      expect(math.taxes[0].ratePercent).toBe(8);
    });

    it('$5.000 con INC 8 % dentro ⇒ base 4629.63, cuota 370.37, total 5000.00', () => {
      // B0 = trunc(5000/1.08) = 4629.62; f(B0) = 4999.98 (−2¢ por doble truncado).
      // +1¢: trunc(4629.63×0.08) = 370.37; f = 5000.00 ✓.
      const math = computeLineMath({
        quantity: 1,
        unit_price: 5000,
        taxes: [incl(8)],
      });
      expect(math.base).toBe(4629.63);
      expect(math.taxInclusive).toBe(370.37);
      expect(math.total).toBe(5000);
      expect(math.unclosedResidualCents).toBe(0);
    });

    it('$100 con IVA 19 % dentro ⇒ base 84.04, cuota 15.96 (DISCRIMINANTE)', () => {
      // F-002: este es el caso que el redondeo NO pasa. B0 = trunc(100/1.19)
      // = 84.03; f(B0) = 99.99. +1¢: trunc(84.04×0.19) = 15.96; f = 100.00.
      // Redondear daría 84.03/15.97: ese centavo es el defecto.
      const math = computeLineMath({
        quantity: 1,
        unit_price: 100,
        taxes: [iva19Incl()],
      });
      expect(math.base).toBe(84.04);
      expect(math.taxInclusive).toBe(15.96);
      expect(math.total).toBe(100);
      expect(math.unclosedResidualCents).toBe(0);
    });
  });

  describe('residuo inalcanzable: closest-below sin colgar ni sobrecobrar', () => {
    it('$17 con INC 8 % ⇒ 15.74 + 1.25 = 16.99 con residuo 1 (F-039/ADR-04)', () => {
      // f(15.74) = 16.99; f(15.75) = 17.01 > 17: el bruto es INALCANZABLE.
      // Se persiste lo mejor con f ≤ bruto y se expone el residuo. El timeout
      // es la prueba de terminación: un loop de igualdad abierto colgaría acá.
      const math = computeLineMath({
        quantity: 1,
        unit_price: 17,
        taxes: [incl(8)],
      });
      expect(math.base).toBe(15.74);
      expect(math.taxInclusive).toBe(1.25);
      expect(math.total).toBe(16.99);
      expect(math.total).toBeLessThanOrEqual(17);
      expect(math.unclosedResidualCents).toBe(1);
    }, 10000);

    it('$3.000 con IVA 19 % + INC 8 % dentro ⇒ 2362.21 + 448.81 + 188.97 = 2999.99', () => {
      // B0 = trunc(3000/1.27) = 2362.20; f(B0) = 2998.98… en detalle:
      // 2362.20 + trunc(448.818) + trunc(188.976) = 2999.98.
      // +1¢: 2362.21 + 448.81 + 188.97 = 2999.99 ✓.
      // +2¢ salta a 3000.01 (overshoot): multi-tasa avanza de a 1+k.
      const math = computeLineMath({
        quantity: 1,
        unit_price: 3000,
        taxes: [iva19Incl(), incl(8)],
      });
      expect(math.base).toBe(2362.21);
      expect(math.taxes[0].cents).toBe(44881);
      expect(math.taxes[1].cents).toBe(18897);
      expect(math.total).toBe(2999.99);
      expect(math.total).toBeLessThanOrEqual(3000);
      expect(math.unclosedResidualCents).toBe(1);
    });
  });

  describe('mixto: primero se despeja, lo adicional suma encima', () => {
    it('$100.000 con INC 8 % dentro + IVA 19 % fuera ⇒ total 117592.59', () => {
      // Divisor = 1.08 (SOLO lo inclusivo). B0 = trunc(100000/1.08) = 92592.59;
      // f(B0) = 99999.99. +1¢: base 92592.60 con cuota INC trunc(7407.408) =
      // 7407.40; f = 100000.00 ✓. IVA sobre la base FINAL:
      // trunc(92592.60×0.19) = 17592.59. Total = 100000 + 17592.59.
      //
      // NOTA A.2: A.1 escribió la base SIN absorber (92592.59) en
      // `tax-inclusive-math.regression.spec.ts` caso 3; la regla de absorción
      // del plan cierra en 92592.60 con las MISMAS cuotas y el MISMO total.
      // El preview sigue la regla, no el B0.
      const math = computeLineMath({
        quantity: 1,
        unit_price: 100000,
        taxes: [incl(8), { ...iva19Incl(), is_inclusive: false }],
      });
      expect(math.base).toBe(92592.6);
      expect(math.taxInclusive).toBe(7407.4);
      expect(math.taxAdditional).toBe(17592.59);
      expect(math.total).toBe(117592.59);
      expect(math.unclosedResidualCents).toBe(0);
    });
  });

  describe('unidad de tarifa: el borde es porcentaje (F-013)', () => {
    it('8 y 0.08 rinden lo mismo (guarda del catálogo `toPercent`)', () => {
      const percent = computeLineMath({
        quantity: 1,
        unit_price: 3000,
        taxes: [incl(8)],
      });
      const fraction = computeLineMath({
        quantity: 1,
        unit_price: 3000,
        taxes: [incl(0.08)],
      });
      expect(fraction.base).toBe(percent.base);
      expect(fraction.taxInclusive).toBe(percent.taxInclusive);
      expect(fraction.total).toBe(percent.total);
      expect(fraction.taxes[0].ratePercent).toBe(8);
    });

    it('normalizeRatePercent espeja `toPercent`: > 1 es porcentaje', () => {
      expect(normalizeRatePercent(19)).toBe(19);
      expect(normalizeRatePercent(0.19)).toBe(19);
      expect(normalizeRatePercent(8)).toBe(8);
      expect(normalizeRatePercent(0)).toBe(0);
      expect(normalizeRatePercent(NaN)).toBe(0);
      expect(normalizeRatePercent(-3)).toBe(0);
    });

    it('ICA 9.66 ‰ sobre $1.000.000 ⇒ base 990432.43, cuota 9567.57', () => {
      // Sin `rate_basis` el ICA va POR MIL (espejo de `resolveRateBasis`):
      // 9.66 ‰ = fracción 0.00966. B0 = trunc(1000000/1.00966) = 990432.42;
      // f(B0) = 999999.99. +1¢: trunc(990432.43×0.00966) = 9567.57 ✓.
      const math = computeLineMath({
        quantity: 1,
        unit_price: 1000000,
        taxes: [incl(9.66, { name: 'ICA 9.66', tax_type: 'ica' })],
      });
      expect(math.base).toBe(990432.43);
      expect(math.taxInclusive).toBe(9567.57);
      expect(math.total).toBe(1000000);
    });
  });

  describe('is_inclusive estricto y saneo (F-035)', () => {
    // Jasmine del repo no tiene `it.each`: un `it` por variante.
    const STRINGY_FLAGS: Array<[string, unknown]> = [
      ["'false'", 'false'],
      ["'true'", 'true'],
      ['1 numérico', 1],
      ['0 numérico', 0],
    ];
    for (const [label, flag] of STRINGY_FLAGS) {
      it(`is_inclusive ${label} ⇒ adicional: solo \`true\` booleano despeja`, () => {
        const math = computeLineMath({
          quantity: 1,
          unit_price: 100000,
          taxes: [incl(19, { is_inclusive: flag as unknown as boolean })],
        });
        expect(math.taxes[0].isInclusive).toBe(false);
        expect(math.base).toBe(100000);
        expect(math.total).toBe(119000);
      });
    }

    it('tasa negativa/NaN ⇒ 0: no despeja ni aporta cuota', () => {
      const math = computeLineMath({
        quantity: 1,
        unit_price: 100000,
        taxes: [incl(NaN)],
      });
      expect(math.base).toBe(100000);
      expect(math.total).toBe(100000);
    });
  });

  describe('memoización por firma (F-040)', () => {
    it('misma entrada ⇒ mismo objeto (O(1) por keystroke en filas intactas)', () => {
      const input = { quantity: 1, unit_price: 3000, taxes: [incl(8)] };
      expect(computeLineMath(input)).toBe(computeLineMath(input));
    });

    it('la cota del loop es fija y pública para paridad con el motor', () => {
      expect(INCLUSIVE_ABSORB_CAP_CENTS).toBeGreaterThanOrEqual(8);
      expect(INCLUSIVE_ABSORB_CAP_CENTS).toBeLessThanOrEqual(16);
    });
  });

  describe('agregado multi-línea en centavos (F-015)', () => {
    it('$3.000 + $5.000 con INC 8 % ⇒ base 7407.41, impuesto 592.59, total 8000.00', () => {
      // La suma en floats de 2777.777… + 4629.629… es el defecto; la suma de
      // truncados del servidor da 2777.78 + 4629.63 = 7407.41.
      const a = computeLineMath({ quantity: 1, unit_price: 3000, taxes: [incl(8)] });
      const b = computeLineMath({ quantity: 1, unit_price: 5000, taxes: [incl(8)] });
      const totals = aggregatePreviewTotals([a, b], [0, 0], []);
      expect(totals.base).toBe(7407.41);
      expect(totals.taxInclusive).toBe(592.59);
      expect(totals.total).toBe(8000);
      expect(totals.base + totals.taxInclusive).toBeCloseTo(totals.total, 2);
    });

    it('el desglose agrega cuotas truncadas, no `base × tarifa` en float', () => {
      const a = computeLineMath({ quantity: 1, unit_price: 3000, taxes: [incl(8)] });
      const b = computeLineMath({ quantity: 1, unit_price: 5000, taxes: [incl(8)] });
      const rows = aggregatePreviewTaxBreakdown(
        [{ taxes: [incl(8)] }, { taxes: [incl(8)] }],
        [a, b],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].base).toBe(7407.41);
      expect(rows[0].amount).toBe(592.59);
      expect(rows[0].rate).toBe(8);
    });

    it('contrato mixto: inclusiva $3.000/8 % + adicional $100.000/19 %', () => {
      const incLine = computeLineMath({
        quantity: 1,
        unit_price: 3000,
        taxes: [incl(8)],
      });
      const addLine = computeLineMath({
        quantity: 1,
        unit_price: 100000,
        taxes: [{ ...iva19Incl(), is_inclusive: false }],
      });
      const totals = aggregatePreviewTotals([incLine, addLine], [0, 0], []);
      expect(totals.base).toBe(102777.78);
      expect(totals.taxInclusive).toBe(222.22);
      expect(totals.taxAdditional).toBe(19000);
      expect(totals.total).toBe(122000);
      const rows = aggregatePreviewTaxBreakdown(
        [
          { taxes: [incl(8)] },
          { taxes: [{ ...iva19Incl(), is_inclusive: false }] },
        ],
        [incLine, addLine],
      );
      expect(rows).toHaveLength(2);
    });
  });

  describe('total en letras de referencia', () => {
    it('$3.000 ⇒ TRES MIL PESOS M/CTE (objetivo 1 del plan)', () => {
      expect(previewTotalInWords(3000)).toBe('TRES MIL PESOS M/CTE');
    });

    it('corpus: coincide con `amountToSpanishWords` en los casos fijados', () => {
      expect(previewTotalInWords(5000)).toBe('CINCO MIL PESOS M/CTE');
      expect(previewTotalInWords(100)).toBe('CIEN PESOS M/CTE');
      expect(previewTotalInWords(1)).toBe('UN PESO M/CTE');
      expect(previewTotalInWords(21)).toBe('VEINTIÚN PESOS M/CTE');
      expect(previewTotalInWords(101)).toBe('CIENTO UN PESOS M/CTE');
      expect(previewTotalInWords(1000000)).toBe('UN MILLÓN DE PESOS M/CTE');
      expect(previewTotalInWords(1234.56)).toBe(
        'MIL DOSCIENTOS TREINTA Y CUATRO PESOS CON CINCUENTA Y SEIS CENTAVOS M/CTE',
      );
      expect(previewTotalInWords(5355000)).toBe(
        'CINCO MILLONES TRESCIENTOS CINCUENTA Y CINCO MIL PESOS M/CTE',
      );
    });

    it('trunca a 2 sin redondear y no rompe el render con basura', () => {
      expect(previewTotalInWords(10.999)).toBe('DIEZ PESOS CON NOVENTA Y NUEVE CENTAVOS M/CTE');
      expect(previewTotalInWords(0)).toBe('CERO PESOS M/CTE');
      expect(previewTotalInWords(null)).toBeNull();
      expect(previewTotalInWords('abc')).toBeNull();
    });
  });
});
