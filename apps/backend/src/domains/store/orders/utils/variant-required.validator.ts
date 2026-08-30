/**
 * ERR-07 / DB-14 — invariante "prepared + variantes exige declarar cuál".
 *
 * Una línea de orden cuyo `product.product_type === 'prepared'` y cuyo
 * producto expone variantes (`product_variants.length > 0`) NO puede
 * persistirse con `product_variant_id = null`: la comanda saldría con el
 * producto base, el descuento de inventario iría contra la fila sin
 * variante y el ticket de cocina perdería el `variant_attributes` /
 * `variant_sku` que necesita cocina para preparar.
 *
 * Por diseño este helper es la **única** definición del invariante: si
 * queda duplicado en dos sitios, vuelve a divergir (lo que ya pasó — el
 * editor y el POS payment flow lo duplicaban sin enforcement).
 *
 * Se llama ANTES del `order_items.createMany` / `order_items.create` en
 * cada write site. `prisma` puede ser un `PrismaClient` o el `tx` de
 * una `$transaction`; `tx.products.findUnique` está disponible en ambos.
 *
 * Sites que deben llamar:
 *  - orders.service.ts `create` (createOrder)
 *  - orders.service.ts `updateOrderItems`
 *  - orders.service.ts `updateOrderFromEditor`
 *  - payments.service.ts `buildPosOrderItem`
 *  - table-sessions.service.ts `addItems` (ya lo valida inline;
 *    mantenido por compatibilidad — refactor en un próximo pase)
 */
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';

/**
 * Items esperados (slice de DTO):
 *   { product_id?: number | null; product_variant_id?: number | null; product_name?: string }
 */
export interface VariantRequiredItem {
  product_id?: number | null;
  product_variant_id?: number | null;
  product_name?: string;
}

/**
 * PrismaClient mínimo (compatible con `tx` de una transacción).
 */
export interface VariantRequiredPrisma {
  products: {
    findUnique: (args: { where: { id: number }; select: any }) => Promise<any>;
  };
}

/**
 * Producto resuelto, suficiente para el invariant check y para los
 * snapshots que el caller necesite (item_type, name, product_variants length).
 */
export type ResolvedProduct = {
  id: number;
  name: string;
  product_type: string;
  product_variants: Array<{ id: number }>;
};

/**
 * Resuelve los `product_id` una sola vez (batch) y aplica el invariant
 * ERR-07 / DB-14. Devuelve el mapa de productos resueltos para que el
 * caller reuse `name` / `product_type` en lugar de volver a pedirlos.
 *
 *  - Lanza `PRODUCT_VARIANT_REQUIRED` si algún item cae en
 *    `prepared` + variantes + `product_variant_id` nulo.
 *  - NO lanza por productos inexistentes: eso lo cubre el path propio
 *    del caller (que probablemente ya tenía su propia validación).
 *
 * Si no hay productos a resolver (todos los items son custom), devuelve
 * un mapa vacío sin tocar la DB.
 */
export async function assertVariantRequiredForPrepared(
  prisma: VariantRequiredPrisma,
  items: ReadonlyArray<VariantRequiredItem>,
): Promise<Map<number, ResolvedProduct>> {
  const productIds = Array.from(
    new Set(
      items
        .map((i) => i.product_id)
        .filter((id): id is number => typeof id === 'number'),
    ),
  );

  const productById = new Map<number, ResolvedProduct>();

  if (productIds.length === 0) return productById;

  const products = await Promise.all(
    productIds.map((id) =>
      prisma.products.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          product_type: true,
          // ERR-07 — solo interesa SI tiene variantes.
          product_variants: { select: { id: true }, take: 1 },
        },
      }),
    ),
  );

  for (const product of products) {
    if (!product) continue;
    productById.set(product.id, product as ResolvedProduct);
  }

  for (const item of items) {
    // Items sin `product_id` son líneas custom (recargas, descuentos, fees).
    // El caller decide su persistencia por su cuenta; este helper solo
    // aplica el invariante de variante para líneas que referencian un
    // producto del catálogo.
    if (!item.product_id) continue;
    const product = productById.get(item.product_id);
    // `prisma` (sea `this.prisma` de orders.service o `tx` de
    // payments.service) está escopeado por tienda vía StorePrismaService:
    // `products.store_id` es NOT NULL en el schema y StorePrismaService
    // sobreescribe `$transaction` para que el `tx` herede el scoping
    // (store-prisma.service.ts:1806-1807). Si el `findUnique` retorna
    // null es porque el producto pertenece a OTRA tienda (o no existe);
    // en ambos casos no es vendible desde este comercio.
    if (!product) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        `El producto #${item.product_id} no existe en este comercio.`,
      );
    }
    if (
      product.product_type === 'prepared' &&
      product.product_variants.length > 0 &&
      item.product_variant_id == null
    ) {
      throw new VendixHttpException(
        ErrorCodes.PRODUCT_VARIANT_REQUIRED,
        `El producto "${product.name}" tiene variantes: selecciona una.`,
      );
    }
  }

  return productById;
}