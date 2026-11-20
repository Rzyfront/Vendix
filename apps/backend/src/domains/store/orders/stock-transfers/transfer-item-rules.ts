import { BadRequestException } from '@nestjs/common';

/**
 * Reglas de líneas de una transferencia compartidas por tienda
 * (`StockTransfersService`) y organización (`OrgTransfersService`).
 *
 * Una línea se identifica por el PAR producto + variante: dos variantes del
 * mismo producto son dos líneas legítimas, pero el mismo par repetido no. La
 * validación de stock lee cada línea por separado antes de mover nada, así que
 * un par repetido pasaba el control dos veces contra el mismo disponible y la
 * suma podía dejar el origen por debajo de lo que había.
 */
export interface TransferLineInput {
  product_id: number;
  product_variant_id?: number | null;
  quantity: number;
}

export function transferLineKey(line: {
  product_id: number;
  product_variant_id?: number | null;
}): string {
  return `${line.product_id}:${line.product_variant_id ?? 'base'}`;
}

/** Lista no vacía, cantidades enteras positivas y sin pares repetidos. */
export function assertTransferLines(lines: TransferLineInput[] | undefined): void {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new BadRequestException(
      'Agrega al menos un producto a la transferencia',
    );
  }

  const seen = new Set<string>();
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new BadRequestException(
        `La cantidad del producto #${line.product_id} debe ser un número entero mayor que cero`,
      );
    }
    const key = transferLineKey(line);
    if (seen.has(key)) {
      throw new BadRequestException(
        `El producto #${line.product_id}${
          line.product_variant_id ? ` (variante #${line.product_variant_id})` : ''
        } está repetido en la transferencia: junta las cantidades en una sola fila`,
      );
    }
    seen.add(key);
  }
}

/**
 * Valida, dentro de la transacción del llamador, que el origen tenga stock
 * disponible para cada línea, con un mensaje que el comerciante entienda.
 *
 * El caso que antes salía como "Insufficient stock for product N": un producto
 * CON variantes guarda su stock por variante (`stock_levels.product_variant_id`)
 * y no tiene fila base; una línea enviada sin variante no encontraba fila y el
 * movimiento se rechazaba aunque hubiera existencias.
 */
export async function assertStockAvailableAtOrigin(
  tx: any,
  lines: TransferLineInput[],
  fromLocationId: number,
): Promise<void> {
  for (const line of lines) {
    const stockLevel = await tx.stock_levels.findFirst({
      where: {
        product_id: line.product_id,
        product_variant_id: line.product_variant_id ?? null,
        location_id: fromLocationId,
      },
      select: {
        quantity_available: true,
        products: { select: { name: true } },
        product_variants: { select: { name: true, sku: true } },
      },
    });

    if (!stockLevel) {
      if (line.product_variant_id == null) {
        const variants = await tx.product_variants.count({
          where: { product_id: line.product_id },
        });
        if (variants > 0) {
          throw new BadRequestException(
            `El producto #${line.product_id} maneja variantes: elige la variante que vas a mover`,
          );
        }
      }
      throw new BadRequestException(
        `El producto #${line.product_id} no tiene existencias en la bodega de origen`,
      );
    }

    const available = Number(stockLevel.quantity_available ?? 0);
    if (available < line.quantity) {
      const name = stockLevel.products?.name ?? `Producto #${line.product_id}`;
      const variant = stockLevel.product_variants
        ? ` (${stockLevel.product_variants.name || stockLevel.product_variants.sku})`
        : '';
      throw new BadRequestException(
        `Stock insuficiente de ${name}${variant} en la bodega de origen: disponible ${available}, pedido ${line.quantity}`,
      );
    }
  }
}

/** Stock de una ubicación tal como lo muestra el picker. */
export interface TransferLocationStock {
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
}

/**
 * Fila del picker de transferencias: una por producto SIN variantes o una por
 * cada variante con stock registrado en el origen. `id` sigue siendo el id del
 * producto para no romper consumidores anteriores.
 */
export interface TransferablePickerRow {
  id: number;
  product_id: number;
  product_variant_id: number | null;
  name: string;
  variant_name: string | null;
  sku: string | null;
  stock_at_origin: TransferLocationStock;
  stock_at_destination: TransferLocationStock;
}

export interface TransferStockLevelLike {
  location_id: number;
  product_variant_id?: number | null;
  quantity_on_hand: unknown;
  quantity_reserved: unknown;
  quantity_available: unknown;
  product_variants?: { id: number; name: string | null; sku: string | null } | null;
}

const EMPTY_STOCK: TransferLocationStock = {
  quantity_on_hand: 0,
  quantity_reserved: 0,
  quantity_available: 0,
};

function toStock(sl: TransferStockLevelLike | undefined): TransferLocationStock {
  if (!sl) return { ...EMPTY_STOCK };
  return {
    quantity_on_hand: Number(sl.quantity_on_hand ?? 0),
    quantity_reserved: Number(sl.quantity_reserved ?? 0),
    quantity_available: Number(sl.quantity_available ?? 0),
  };
}

/**
 * Expande un producto con sus `stock_levels` (de origen y destino) en filas
 * del picker, una por variante. La fila base (sin variante) de un producto que
 * ya tiene filas por variante en el origen solo se conserva si tiene
 * existencias: es un residuo de antes de crear las variantes.
 */
export function expandTransferablePickerRows(
  product: { id: number; name: string; sku: string | null },
  stockLevels: TransferStockLevelLike[],
  fromLocationId: number,
  toLocationId: number,
): TransferablePickerRow[] {
  const origin = stockLevels.filter((sl) => sl.location_id === fromLocationId);
  const destination = stockLevels.filter((sl) => sl.location_id === toLocationId);
  const hasVariantRows = origin.some((sl) => sl.product_variant_id != null);

  const rows: TransferablePickerRow[] = [];
  for (const sl of origin) {
    const variantId = sl.product_variant_id ?? null;
    if (
      variantId == null &&
      hasVariantRows &&
      Number(sl.quantity_on_hand ?? 0) <= 0
    ) {
      continue;
    }
    const dest = destination.find(
      (d) => (d.product_variant_id ?? null) === variantId,
    );
    rows.push({
      id: product.id,
      product_id: product.id,
      product_variant_id: variantId,
      name: product.name,
      variant_name:
        variantId != null ? (sl.product_variants?.name ?? null) : null,
      sku:
        variantId != null
          ? (sl.product_variants?.sku ?? product.sku ?? null)
          : (product.sku ?? null),
      stock_at_origin: toStock(sl),
      stock_at_destination: toStock(dest),
    });
  }

  // Producto sin ninguna fila en el origen (no debería llegar por el filtro
  // `stock_levels.some@origen`, pero el contrato anterior devolvía la fila con
  // ceros): se conserva igual.
  if (origin.length === 0) {
    rows.push({
      id: product.id,
      product_id: product.id,
      product_variant_id: null,
      name: product.name,
      variant_name: null,
      sku: product.sku ?? null,
      stock_at_origin: { ...EMPTY_STOCK },
      stock_at_destination: toStock(
        destination.find((d) => d.product_variant_id == null),
      ),
    });
  }

  rows.sort((a, b) =>
    (a.variant_name ?? '').localeCompare(b.variant_name ?? ''),
  );
  return rows;
}
