import {
  computeLineMath,
  lineDiscountExceedsSubtotal,
  lineGross,
} from './invoice-line-math';

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
