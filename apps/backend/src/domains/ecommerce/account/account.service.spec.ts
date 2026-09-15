import { AccountService } from './account.service';

/**
 * C.8 (R-1 / ADR-06) — regresión permanente para `deriveLineGross`.
 *
 * F-008 (major): `GET /ecommerce/account` (el panel de cuenta del
 * checkout-shell) nunca importó `resolveOrderLineFinals` ni escribió
 * `final_unit_price` — a diferencia de `orders.service.ts#findOne`, que
 * recalcula el bruto en memoria contra las tasas del catálogo en CADA
 * lectura. Para este endpoint, el fallback de ADR-06
 * (`final_unit_price ?? (unit_price + COALESCE(tax_amount_item,0) /
 * line_units)`) es el camino COMÚN, no la excepción: `checkout.service.ts`
 * (F-005) nunca puebla `final_unit_price` al crear la orden.
 *
 * `deriveLineGross` es un método privado y puro (no toca `this.prisma` ni
 * el contexto de request), así que se ejercita instanciando el servicio sin
 * levantar el módulo de Nest — sólo hacen falta stubs para
 * `EcommercePrismaService`/`S3Service`, que este método nunca usa.
 */
describe('AccountService#deriveLineGross — fallback ADR-06', () => {
  const service = new AccountService({} as any, {} as any);
  const deriveLineGross = (item: Record<string, unknown>) =>
    (service as any).deriveLineGross(item);

  it('deriva el bruto desde unit_price + tax_amount_item cuando final_unit_price es null (fila histórica/nunca escrita)', () => {
    // Fila típica de una orden de checkout post-P1: unit_price y
    // total_price ambos NETOS (`total_price = unit_price × quantity`,
    // DB-01), `tax_amount_item` persistido como total DE LA LÍNEA (2
    // unidades), `final_unit_price` NUNCA escrito por este carril (F-005).
    const result = deriveLineGross({
      unit_price: 100,
      total_price: 200, // 100 × 2 (neto, DB-01)
      tax_amount_item: 38, // IVA de LA LÍNEA completa (2 unidades al 19%)
      final_unit_price: null,
      quantity: 2,
    });

    // ADR-06: final_unit_price ausente ⇒ unit_price + tax_amount_item/line_units.
    // line_units cae a `quantity` (no hay price_unit_quantity): 100 + 38/2 = 119.
    expect(result.unit_price_gross).toBe(119);
    // multiplier = netTotal/netUnit = 200/100 = 2 (misma relación que ya
    // vincula total_price con unit_price en la fila, DB-01): 119 × 2 = 238.
    expect(result.line_total_gross).toBe(238);
  });

  it('usa final_unit_price directo cuando SÍ está poblado (no recalcula por encima del valor ya persistido)', () => {
    const result = deriveLineGross({
      unit_price: 100,
      total_price: 200,
      tax_amount_item: 999, // no debe usarse: final_unit_price manda
      final_unit_price: 119,
      quantity: 2,
    });

    expect(result.unit_price_gross).toBe(119);
    expect(result.line_total_gross).toBe(238); // 119 × (200/100)
  });

  it('R-1: el campo aditivo no altera unit_price/total_price — sólo se le añaden al objeto original en el llamador', () => {
    const item = {
      unit_price: 50,
      total_price: 50,
      tax_amount_item: 0,
      final_unit_price: null,
      quantity: 1,
    };
    const result = deriveLineGross(item);

    // deriveLineGross es puro: no muta el item de entrada.
    expect(item.unit_price).toBe(50);
    expect(item.total_price).toBe(50);
    expect(result.unit_price_gross).toBe(50);
    expect(result.line_total_gross).toBe(50);
  });
});
