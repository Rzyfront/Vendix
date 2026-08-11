/**
 * Multi-tarifa ⊕ variantes: exclusión mutua.
 *
 * Un producto se vende en varias PRESENTACIONES (bulto / kilo, rollo / metro) o
 * en varias VARIANTES (talla, color, diámetro), nunca en ambas a la vez. La
 * combinación no está prohibida por gusto: es un producto cartesiano que
 * ninguna superficie de venta sabe resolver.
 *
 * - El dato: `product_price_tier_overrides` tiene `variant_id` nullable, así
 *   que N presentaciones × M variantes son N×M filas de configuración. La
 *   decisión MVP vigente (`product-create-page.component.ts`) es que los
 *   overrides viven a nivel PRODUCTO y las variantes heredan — o sea que la
 *   combinación ya se estaba resolviendo por herencia silenciosa, no por
 *   configuración real. En producción: 0 de 95 overrides tienen `variant_id`.
 * - La venta: una línea de carrito lleva `product_variant_id` Y
 *   `applied_price_tier_id`. Con las dos poblados el precio depende de dos ejes
 *   y el descuento de stock de `stock_units_consumed` — que se calcula del
 *   packSize de la presentación, no de la variante.
 * - El síntoma que lo destapó: el detalle público mostraba el precio mínimo de
 *   variante ($1.000) en vez del precio de la presentación por defecto
 *   ($2.000), porque el mapper de variantes del catálogo usa la cascada legacy
 *   y el del producto la cascada tier-aware. Dos verdades para un producto.
 *
 * La regla se valida en los CUATRO caminos que pueden violarla, porque cada uno
 * es una puerta independiente: el editor de producto (create y update), el
 * upsert de override de tarifa, y la configuración de presentación embebida en
 * una orden de compra. Bloquear solo la UI dejaría el `curl` abierto.
 *
 * El `client` entra por parámetro para poder recibir el `tx` de una
 * transacción: tomar `this.prisma` dentro de un `$transaction` abriría una
 * segunda conexión del pool (y perdería el scoping de tenant).
 */
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

export type ExclusivityClient = {
  product_variants: { count: (args: any) => Promise<number> };
  products: { findFirst: (args: any) => Promise<any> };
  product_price_tier_assignments: { count: (args: any) => Promise<number> };
};

/** Cuántas variantes tiene hoy el producto (scoped por el client recibido). */
export async function countProductVariants(
  client: ExclusivityClient,
  productId: number,
): Promise<number> {
  return client.product_variants.count({ where: { product_id: productId } });
}

/**
 * Cuántas presentaciones de venta tiene habilitadas hoy el producto.
 *
 * Cuenta assignments a tarifas `kind='sale_unit'`, no el flag
 * `has_multiple_price_tiers`: el flag es el master switch y puede estar
 * encendido sin ninguna presentación asignada (estado que la venta rechazaría
 * después con `PRICE_TIER_NOT_ALLOWED`).
 */
export async function countSaleUnitAssignments(
  client: ExclusivityClient,
  productId: number,
): Promise<number> {
  return client.product_price_tier_assignments.count({
    where: {
      product_id: productId,
      price_tier: { kind: 'sale_unit', is_active: true },
    },
  });
}

/**
 * Llamar ANTES de habilitar multi-tarifa o de escribir una presentación.
 *
 * `incomingVariantCount` cubre el create, donde las variantes llegan en el
 * mismo payload y todavía no existen en la base.
 */
export async function assertTiersAllowed(
  client: ExclusivityClient,
  productId: number | null,
  options: { incomingVariantCount?: number; action?: string } = {},
): Promise<void> {
  const incoming = options.incomingVariantCount ?? 0;
  const existing =
    productId != null ? await countProductVariants(client, productId) : 0;
  const total = incoming + existing;
  if (total === 0) return;

  throw new VendixHttpException(
    ErrorCodes.PRODUCT_TIERS_VARIANTS_EXCLUSIVE,
    `Este producto tiene ${total} variante${total === 1 ? '' : 's'}. ` +
      'Multi-tarifa y variantes son excluyentes: elimina las variantes para ' +
      'poder venderlo en varias presentaciones.',
    {
      product_id: productId,
      variant_count: total,
      direction: 'tiers_over_variants',
      action: options.action ?? 'enable_price_tiers',
    },
  );
}

/**
 * Llamar ANTES de crear variantes.
 *
 * Mira las dos señales porque cualquiera de las dos ya rompe la venta: el flag
 * encendido (el POS ofrecerá selector de presentación) o presentaciones
 * asignadas (el precio ya no sale de `base_price`).
 */
export async function assertVariantsAllowed(
  client: ExclusivityClient,
  productId: number,
  options: { action?: string } = {},
): Promise<void> {
  const [product, saleUnits] = await Promise.all([
    client.products.findFirst({
      where: { id: productId },
      select: { has_multiple_price_tiers: true },
    }),
    countSaleUnitAssignments(client, productId),
  ]);

  const flagOn = product?.has_multiple_price_tiers === true;
  if (!flagOn && saleUnits === 0) return;

  throw new VendixHttpException(
    ErrorCodes.PRODUCT_TIERS_VARIANTS_EXCLUSIVE,
    saleUnits > 0
      ? `Este producto se vende en ${saleUnits} presentación${
          saleUnits === 1 ? '' : 'es'
        }. Multi-tarifa y variantes son excluyentes: desactiva multi-tarifa ` +
        'para poder usar variantes.'
      : 'Este producto tiene multi-tarifa activa. Multi-tarifa y variantes ' +
        'son excluyentes: desactívala para poder usar variantes.',
    {
      product_id: productId,
      sale_unit_count: saleUnits,
      has_multiple_price_tiers: flagOn,
      direction: 'variants_over_tiers',
      action: options.action ?? 'create_variants',
    },
  );
}
