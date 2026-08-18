/**
 * Identidad de una línea de carrito.
 *
 * Dos presentaciones del MISMO producto (p.ej. "Bulto 50kg" y "Kilo suelto")
 * son líneas DISTINTAS: fusionarlas perdería la elección del comprador en
 * silencio y, peor aún, mezclaría dos escalas de precio incompatibles (el
 * precio es por PAQUETE, y cada presentación tiene su propio paquete). Por eso
 * la tarifa entra en la clave junto al producto y la variante.
 *
 * Mismo CRITERIO que la clave de fusión del POS (`pos-cart.service.ts`, ~:1675):
 * allí toda decisión del cajero que se perdería al fusionar (`skipKds`,
 * `isTakeaway`, seriales, pesada en balanza) entra en la identidad de la línea.
 * La presentación elegida por el comprador es una decisión de la misma
 * naturaleza. Ojo: el POS aún NO incluye `applied_price_tier_id` en su clave
 * — este util es el criterio ya extendido a la tarifa, no una copia literal.
 *
 * Se usa `?? 0` en vez de dejar `undefined`/`null` sueltos porque
 * `${undefined}` y `${null}` producen claves distintas ("undefined" vs "null")
 * para lo que semánticamente es el mismo caso: "sin variante" / "sin tarifa".
 * Normalizar a `0` evita líneas duplicadas por un simple matiz de tipo.
 */
export function cartLineKey(
  productId: number,
  variantId?: number | null,
  priceTierId?: number | null,
): string {
  return `${productId}:${variantId ?? 0}:${priceTierId ?? 0}`;
}
