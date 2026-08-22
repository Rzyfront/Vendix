import {
  deriveLineTax,
  derivePurchaseTotals,
  prorateHeaderDiscount,
} from './purchase-line-tax.util';

/**
 * Invariante de PARIDAD entre el frontend y el backend.
 *
 * `purchase-line-tax.util.ts` es espejo byte-a-byte de
 * `PurchaseOrdersService.deriveLineTax` / `prorateHeaderDiscount`. Es el único
 * lugar del frontend que tiene derecho a decir cuánto vale una línea de compra:
 * el modal del escáner, el carrito y el resumen lo consumen para mostrar la
 * MISMA cifra que la base de datos va a persistir.
 *
 * Las cifras esperadas de este archivo están calculadas A MANO, no derivadas de
 * la función bajo prueba. Un test que llama a la función para producir su propio
 * valor esperado sólo prueba que la función es determinista — y habría dejado
 * pasar exactamente el bug que motivó este hotfix.
 */
describe('purchase-line-tax.util — paridad con el backend', () => {
  const ADDED = { prices_include_tax: false };
  const INCLUDED = { prices_include_tax: true };

  describe('deriveLineTax — split de IVA', () => {
    it('IVA por fuera: 1000 × 2 al 19% ⇒ neto 1000, IVA 380, total 2380', () => {
      // El precio tecleado YA es neto: el IVA se suma encima.
      // neto/u = 1000 · IVA/u = 1000 × 0.19 = 190 · total = 2000 + 380.
      const r = deriveLineTax(
        { unit_price: 1000, quantity: 2, tax_rate: 19 },
        ADDED,
      );

      expect(r.unit_price_net).toBe(1000);
      expect(r.tax_amount).toBe(380);
      expect(r.net_line).toBe(2000);
      expect(r.total_line).toBe(2380);
      expect(r.effective_include).toBe(false);
    });

    it('IVA incluido: 1190 × 2 al 19% ⇒ neto 1000, IVA 380, total 2380', () => {
      // El precio ya trae el IVA dentro: se extrae. 1190 / 1.19 = 1000.
      // El total es el MISMO que en el caso anterior — es la misma operación
      // económica expresada de dos maneras, y por eso los dos modos tienen que
      // aterrizar en la misma cifra o el operador ve un total distinto según
      // cómo el proveedor imprimió su factura.
      const r = deriveLineTax(
        { unit_price: 1190, quantity: 2, tax_rate: 19 },
        INCLUDED,
      );

      expect(r.unit_price_net).toBe(1000);
      expect(r.tax_amount).toBe(380);
      expect(r.net_line).toBe(2000);
      expect(r.total_line).toBe(2380);
      expect(r.effective_include).toBe(true);
    });
  });

  describe('deriveLineTax — precedencia del descuento', () => {
    it('el MONTO gana sobre el porcentaje (400 vence a 99%)', () => {
      // Ésta es la invariante del hotfix. `discount_amount` es la cifra que la
      // factura imprimió; el porcentaje es sólo procedencia. Un 99% aplicado a
      // 2000 daría 1980 de descuento: si el porcentaje ganara, la línea se
      // desplomaría a 20 y la capa de costo FIFO nacería envenenada.
      //
      // desc = 400 · desc/u = 400/2 = 200 · bruto/u tras desc = 800
      // neto = 1600 · IVA = 1600 × 0.19 = 304 · total = 1904.
      const r = deriveLineTax(
        {
          unit_price: 1000,
          quantity: 2,
          tax_rate: 19,
          discount_amount: 400,
          discount_percentage: 99,
        },
        ADDED,
      );

      expect(r.discount_total).toBe(400);
      expect(r.unit_price_net).toBe(800);
      expect(r.net_line).toBe(1600);
      expect(r.tax_amount).toBe(304);
      expect(r.total_line).toBe(1904);
    });

    it('el porcentaje sigue vigente cuando NO hay monto', () => {
      // desc = 2000 × 10% = 200 · desc/u = 50 · neto/u = 450
      // neto = 1800 · IVA = 342 · total = 2142.
      const r = deriveLineTax(
        {
          unit_price: 500,
          quantity: 4,
          tax_rate: 19,
          discount_percentage: 10,
        },
        ADDED,
      );

      expect(r.discount_total).toBe(200);
      expect(r.net_line).toBe(1800);
      expect(r.tax_amount).toBe(342);
      expect(r.total_line).toBe(2142);
    });

    it('un monto que el porcentaje entero NO puede representar sobrevive intacto', () => {
      // Regresión directa del bug: 1234 sobre un bruto de 10 000 es 12,34 %.
      // El frontend lo convertía con `Math.round` ⇒ 12 % ⇒ 1200, y los 34 pesos
      // perdidos se inyectaban al descuento de CABECERA, que el backend
      // prorratea entre TODAS las líneas por peso bruto: el dinero cambiaba de
      // línea y el costeo por capas quedaba mal.
      const conMonto = deriveLineTax(
        { unit_price: 1000, quantity: 10, tax_rate: 19, discount_amount: 1234 },
        ADDED,
      );
      const conPorcentajeRedondeado = deriveLineTax(
        { unit_price: 1000, quantity: 10, tax_rate: 19, discount_percentage: 12 },
        ADDED,
      );

      expect(conMonto.discount_total).toBe(1234);
      expect(conMonto.net_line).toBe(8766);
      // La degradación que este hotfix elimina, fijada explícitamente para que
      // nadie la reintroduzca "por simplicidad".
      expect(conPorcentajeRedondeado.discount_total).toBe(1200);
      expect(conMonto.net_line).not.toBe(conPorcentajeRedondeado.net_line);
    });

    it('un descuento mayor que la línea se clampa y el neto nunca queda negativo', () => {
      // 5000 de descuento sobre una línea de 2000. El clamp vive en
      // `discountPerUnit = min(discount/qty, gross)`: un costo unitario
      // negativo envenena la capa FIFO que esta línea va a crear al recibirse.
      const r = deriveLineTax(
        { unit_price: 1000, quantity: 2, tax_rate: 19, discount_amount: 5000 },
        ADDED,
      );

      expect(r.unit_price_net).toBe(0);
      expect(r.unit_price_net).toBeGreaterThanOrEqual(0);
      expect(r.net_line).toBe(0);
      expect(r.tax_amount).toBe(0);
      expect(r.total_line).toBe(0);
      // El descuento reportado se topa al bruto de la línea (2000), no a los
      // 5000 pedidos: reportar más sería inventar dinero en el resumen.
      expect(r.discount_total).toBe(2000);
      expect(r.discount_total).toBe(r.gross_line);
    });

    it('cantidad 0: el descuento no tiene línea de la que agarrarse', () => {
      // Línea bonificada. `deriveLineTax` devuelve 0 de descuento — por eso
      // `pop.component.ts` acumula esos montos al descuento de cabecera en vez
      // de mandarlos a la línea, donde se evaporarían en silencio.
      const r = deriveLineTax(
        { unit_price: 0, quantity: 0, tax_rate: 19, discount_amount: 500 },
        ADDED,
      );

      expect(r.discount_total).toBe(0);
      expect(r.net_line).toBe(0);
      expect(r.total_line).toBe(0);
    });
  });

  describe('prorateHeaderDiscount', () => {
    it('reparte por peso bruto y deja el residuo de redondeo en la ÚLTIMA línea', () => {
      // Brutos 300 / 400 / 900 (total 1600) con 10 de descuento de cabecera.
      //   línea 0 → 10 × 300/1600 = 1,875   → round2 = 1,88
      //   línea 1 → 10 × 400/1600 = 2,5     → round2 = 2,50
      //   línea 2 → 10 − (1,88 + 2,50)      = 5,62
      // La proporción exacta de la última sería 5,625 (round2 ⇒ 5,63). Se le
      // asigna 5,62 A PROPÓSITO: el residuo cae ahí para que la suma cierre
      // EXACTO contra lo que facturó el proveedor. Con 5,63 la orden derivaría
      // un centavo y el pago no cuadraría contra el papel.
      const shares = prorateHeaderDiscount(
        [
          { unit_price: 300, quantity: 1 },
          { unit_price: 400, quantity: 1 },
          { unit_price: 900, quantity: 1 },
        ],
        10,
      );

      expect(shares).toEqual([1.88, 2.5, 5.62]);
      expect(shares.reduce((s, v) => s + v, 0)).toBe(10);
      // La última NO es su proporción exacta redondeada — lleva el residuo.
      expect(shares[2]).not.toBe(5.63);
    });

    it('sin descuento, sin líneas o con orden de valor cero ⇒ todo en 0', () => {
      // Una orden de valor cero no tiene a qué agarrar el descuento; dividir
      // por cero emitiría NaN al motor de costo.
      expect(prorateHeaderDiscount([{ unit_price: 100, quantity: 1 }], 0)).toEqual([0]);
      expect(prorateHeaderDiscount([], 100)).toEqual([]);
      expect(
        prorateHeaderDiscount([{ unit_price: 0, quantity: 5 }], 100),
      ).toEqual([0]);
    });

    it('nunca descuenta más de lo que vale la orden', () => {
      const shares = prorateHeaderDiscount(
        [
          { unit_price: 100, quantity: 1 },
          { unit_price: 100, quantity: 1 },
        ],
        9999,
      );

      expect(shares.reduce((s, v) => s + v, 0)).toBe(200);
    });
  });

  describe('derivePurchaseTotals', () => {
    // Dos líneas de bruto 2000 cada una: la primera con descuento en DINERO
    // (400), la segunda en PORCENTAJE (10 % = 200). Cabecera 100, flete 50.
    //
    // Prorrateo: pesos iguales ⇒ 50 y 50.
    //   línea A: desc 400 + 50 = 450 · desc/u 225 · neto/u 775
    //            neto 1550 · IVA 294,50
    //   línea B: desc 200 + 50 = 250 · desc/u 62,50 · neto/u 437,50
    //            neto 1750 · IVA 332,50
    //   subtotal 3300 · IVA 627 · descuentos 700 (600 línea + 100 cabecera)
    //   total = 3300 + 627 + 50 = 3977
    const items = [
      { unit_price: 1000, quantity: 2, tax_rate: 19, discount_amount: 400 },
      { unit_price: 500, quantity: 4, tax_rate: 19, discount_percentage: 10 },
    ];

    it('suma las líneas y prorratea la cabecera como lo hará el backend', () => {
      const t = derivePurchaseTotals(items, ADDED, 100, 50);

      expect(t.gross_subtotal).toBe(4000);
      expect(t.subtotal).toBe(3300);
      expect(t.tax_amount).toBe(627);
      expect(t.line_discount).toBe(600);
      expect(t.header_discount).toBe(100);
      expect(t.shipping_cost).toBe(50);
      expect(t.total).toBe(3977);
    });

    it('total === subtotal + IVA + flete', () => {
      const t = derivePurchaseTotals(items, ADDED, 100, 50);

      expect(t.total).toBe(t.subtotal + t.tax_amount + t.shipping_cost);
    });

    it('discount_amount === descuento de línea + descuento de cabecera', () => {
      const t = derivePurchaseTotals(items, ADDED, 100, 50);

      expect(t.discount_amount).toBe(700);
      expect(t.discount_amount).toBe(t.line_discount + t.header_discount);
    });

    it('sin descuento de cabecera el prorrateo no toca las líneas', () => {
      const t = derivePurchaseTotals(items, ADDED, 0, 0);

      expect(t.header_discount).toBe(0);
      // Sólo los descuentos propios: 400 (dinero) + 200 (10 % de 2000).
      expect(t.discount_amount).toBe(600);
      expect(t.line_discount).toBe(600);
      expect(t.subtotal).toBe(3400);
      expect(t.total).toBe(t.subtotal + t.tax_amount);
    });
  });
});
