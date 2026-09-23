import { computeOrderInvoiceSubtotal } from './invoicing.service';
import { resolveShippingInc } from './utils/shipping-inc.util';

/**
 * F-056 (CP-pos-exclusive-tax-double-charge) — el subtotal de la factura
 * generada desde una orden (`createFromOrder`) puede perder el flete o
 * duplicar el impuesto si se implementa literalmente lo que decía ADR-04
 * (":2293 usa Σ total_price"). Esa instrucción tiene tres lecturas y las
 * tres fallan:
 *
 *   1. Sobre `items` (el arreglo local que arma `createFromOrder` con
 *      `product_id`, `total_amount`, etc.) NO COMPILA: ese arreglo no tiene
 *      campo `total_price`, sólo `total_amount`.
 *   2. Sobre `total_amount` DUPLICA EL IMPUESTO: ese campo ya es
 *      `total_price + tax` (ver `productItems` en `invoicing.service.ts`),
 *      así que sumarlo mete el impuesto dos veces en el subtotal.
 *   3. Sobre `order.order_items[].total_price` A SECAS PIERDE EL FLETE: la
 *      línea "Envio" es sintética, inyectada por `createFromOrder` en el
 *      arreglo local `items`, y NUNCA es un `order_item` real — no aparece
 *      en `order.order_items`.
 *
 * La lectura correcta — y la que fija `computeOrderInvoiceSubtotal` — es
 * `Σ order.order_items[].total_price + shipping_cost`. Este spec fija esa
 * fórmula llamando a la función REAL exportada por `invoicing.service.ts`
 * (no una copia/espejo de la expresión), para que una reversión al cálculo
 * viejo (`Σ quantity × unit_price`, que ignora `price_unit_quantity`/peso)
 * o una pérdida del flete la tumben de inmediato.
 */
describe('InvoicingService · computeOrderInvoiceSubtotal (F-056)', () => {
  it('suma total_price de las líneas más el flete, sin perderlo', () => {
    // Dos líneas de producto + envío. `total_price` se fija explícito y
    // DISTINTO de `quantity × unit_price` en la segunda línea (simula una
    // línea por peso o con tarifa por empaque, donde `total_price` sale de
    // `unit_price × line_units` vía `resolveLineUnits`, no de la cantidad
    // cruda): si el cálculo recayera en recomputar `quantity × unit_price`
    // en vez de leer `total_price`, este test lo detecta.
    const order_items = [
      {
        // Línea normal: total_price == quantity × unit_price (100 × 2).
        quantity: 2,
        unit_price: 100,
        total_price: 200,
        // Impuesto de línea: NUNCA debe colarse en el subtotal — la función
        // ni siquiera lee este campo.
        tax_amount_item: 38,
      },
      {
        // Línea por peso/tarifa: quantity=1 pero total_price refleja
        // unit_price × line_units (peso 1.25 kg), NO quantity × unit_price
        // (que daría 5000, no 6250).
        quantity: 1,
        unit_price: 5000,
        total_price: 6250,
        tax_amount_item: 0,
      },
    ];
    const shipping_cost = 15000;

    const subtotal = computeOrderInvoiceSubtotal(order_items, shipping_cost);

    // Σ total_price (200 + 6250) + flete (15000) = 21450.
    expect(subtotal).toBe(21450);
    // Ningún impuesto de línea (38) entró al subtotal.
    expect(subtotal).not.toBe(21450 + 38);
    // Recomputar quantity × unit_price (200 + 5000 = 5200) + flete daría
    // 20200 — distinto del resultado correcto: la línea por peso se
    // hubiera descuadrado con la fórmula vieja.
    expect(subtotal).not.toBe(20200);
  });

  it('sin envío, el subtotal es sólo Σ total_price de las líneas', () => {
    const order_items = [
      { quantity: 3, unit_price: 1000, total_price: 3000 },
      { quantity: 1, unit_price: 2500, total_price: 2500 },
    ];

    const subtotal = computeOrderInvoiceSubtotal(order_items, 0);

    expect(subtotal).toBe(5500);
  });

  it('sin líneas, el subtotal es sólo el flete (nunca se pierde)', () => {
    const subtotal = computeOrderInvoiceSubtotal([], 8000);

    expect(subtotal).toBe(8000);
  });

  it('domicilio con INC incluido (restaurante O-33): suma la BASE del envío, no el bruto', () => {
    // Plato base 50.000 + INC 4.000; domicilio 15.000 = 13.888,89 + 1.111,11.
    const order_items = [
      {
        quantity: 1,
        unit_price: 50000,
        total_price: 50000,
        order_item_taxes: [
          { tax_rate_id: 68, tax_name: 'INC', tax_rate: 0.08, tax_amount: 4000, tax_type: 'inc', is_inclusive: true },
        ],
      },
    ];
    const shipping = resolveShippingInc({
      shipping_cost: 15000,
      inc_responsible: true,
      is_restaurant: true,
      order_items,
    });
    expect(shipping.applies).toBe(true);
    const shippingBase = shipping.applies ? shipping.base : 15000;

    const subtotal = computeOrderInvoiceSubtotal(order_items, shippingBase);

    expect(subtotal).toBe(63888.89);
    // Con el bruto el INC del envío quedaría dentro del subtotal Y en el
    // impuesto: la factura sumaría 1.111,11 de más.
    expect(subtotal).not.toBe(65000);
  });

  it('order_items null/undefined no revienta y respeta el flete', () => {
    expect(computeOrderInvoiceSubtotal(null, 5000)).toBe(5000);
    expect(computeOrderInvoiceSubtotal(undefined, 5000)).toBe(5000);
  });
});
