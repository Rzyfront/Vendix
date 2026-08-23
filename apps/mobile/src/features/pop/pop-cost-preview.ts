import type {
  PopCartState,
  PopCostPreviewRequest,
  PopCostPreviewRequestItem,
} from './types';

/**
 * CP-PURCHASE-TRANSPARENCY B.5 — cómo se traduce el carrito del POP a la
 * petición de la vista previa de costeo.
 *
 * Vive en su propio módulo, separado de `pop-purchase-orders.service.ts`, para
 * que sea PURO: el servicio arrastra el cliente HTTP (axios + almacenamiento de
 * token), y una regla de negocio que sólo transforma datos no debería necesitar
 * un entorno de red para probarse. La spec vecina fija las dos reglas que, al
 * relajarse, rompen en silencio.
 */

/**
 * Arma la petición de vista previa desde el carrito, o devuelve `null` cuando
 * no hay nada que simular.
 *
 * Reglas que NO se pueden relajar sin volver a romper el contrato:
 *
 *  - **Sólo líneas con producto real.** `CostPreviewItemDto.product_id` exige
 *    `@IsInt() @Min(1)`, y el POP siembra ids NEGATIVOS para los productos que
 *    todavía no existen (prebulk, importador masivo, escáner de factura). Una
 *    sola de esas líneas devuelve 400 y la pantalla se queda sin explicación
 *    fiscal por un motivo que nada tiene que ver con el IVA.
 *  - **El modo del flete sólo viaja con monto.** El validador cruzado del
 *    backend rechaza `prorate` sin flete tanto como un flete sin modo.
 *  - **No se envían `tax_rate` ni descuentos.** El POP móvil todavía no los
 *    captura por línea: `PopCartItem.tax_rate` se usa internamente como
 *    FRACCIÓN (`subtotal * tax_rate` en `constants.ts`) mientras el DTO espera
 *    un PORCENTAJE (0-100). Mandarlo tal cual declararía un IVA del 0,19 % y la
 *    simulación mentiría. Cuando el móvil capture impuestos por línea, esto se
 *    llena — no antes.
 */
export function buildCostPreviewRequest(
  cart: PopCartState,
): PopCostPreviewRequest | null {
  if (!cart.locationId) return null;

  const items: PopCostPreviewRequestItem[] = cart.items
    .filter((item) => !item.is_prebulk && Number(item.product?.id) > 0)
    .map((item) => ({
      product_id: item.product.id,
      ...(item.variant?.id ? { product_variant_id: item.variant.id } : {}),
      quantity: item.quantity,
      unit_cost: item.unit_cost,
    }));

  if (items.length === 0) return null;

  const rawShipping = Number(cart.shippingCost);
  const shippingCost =
    Number.isFinite(rawShipping) && rawShipping > 0
      ? Math.round(rawShipping * 100) / 100
      : 0;

  return {
    location_id: cart.locationId,
    shipping_cost: shippingCost,
    ...(shippingCost > 0
      ? { shipping_cost_allocation: cart.shippingCostAllocation ?? 'prorate' }
      : {}),
    items,
  };
}
