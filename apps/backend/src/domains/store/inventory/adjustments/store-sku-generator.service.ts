import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';

const MAX_ATTEMPTS = 20;
const SUFFIX_DIGITS = 6;

/**
 * Genera SKUs automáticos `CI-{store_id}-{NNNNNN}` para productos creados por
 * una carga inicial sin SKU. Toma el mayor sufijo existente (productos no
 * archivados y variantes de la tienda) y suma 1, verificando que no exista.
 */
@Injectable()
export class StoreSkuGeneratorService {
  constructor(private readonly prisma: StorePrismaService) {}

  async next(
    store_id: number,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const db: any = tx ?? this.prisma;
    const prefix = `CI-${store_id}-`;

    const [topProduct, topVariant] = await Promise.all([
      db.products.findFirst({
        where: {
          store_id,
          state: { not: 'archived' },
          sku: { startsWith: prefix },
        },
        orderBy: { sku: 'desc' },
        select: { sku: true },
      }),
      db.product_variants.findFirst({
        where: {
          sku: { startsWith: prefix },
          products: { store_id },
        },
        orderBy: { sku: 'desc' },
        select: { sku: true },
      }),
    ]);

    let current = Math.max(
      this.suffixOf(topProduct?.sku, prefix),
      this.suffixOf(topVariant?.sku, prefix),
    );

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      current += 1;
      const candidate = `${prefix}${String(current).padStart(SUFFIX_DIGITS, '0')}`;
      const [p, v] = await Promise.all([
        db.products.findFirst({
          where: { store_id, sku: candidate },
          select: { id: true },
        }),
        db.product_variants.findFirst({
          where: { sku: candidate, products: { store_id } },
          select: { id: true },
        }),
      ]);
      if (!p && !v) return candidate;
    }
    throw new Error(
      `No fue posible generar un SKU libre para la tienda ${store_id}`,
    );
  }

  private suffixOf(sku: string | null | undefined, prefix: string): number {
    if (!sku || !sku.startsWith(prefix)) return 0;
    const n = parseInt(sku.slice(prefix.length), 10);
    return Number.isFinite(n) ? n : 0;
  }
}
