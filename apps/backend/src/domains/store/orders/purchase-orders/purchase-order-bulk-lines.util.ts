import {
  CheckBulkLineResult,
  CheckBulkPurchaseLineDto,
} from './dto/check-bulk-lines.dto';

export const BULK_LINE_WITHOUT_CODE = 'PO_BULK_LINE_WITHOUT_CODE';

type ProductRow = { id: number; name: string; sku: string | null; barcode: string | null };
type VariantRow = {
  id: number;
  product_id: number;
  sku: string;
  barcode: string | null;
  name: string | null;
  products: { name: string } | null;
};

/** Lo mínimo del cliente Prisma que necesita la búsqueda (solo lectura). */
export interface BulkLineLookupClient {
  products: { findMany(args: unknown): Promise<ProductRow[]> };
  product_variants: { findMany(args: unknown): Promise<VariantRow[]> };
}

/**
 * QUI-1004 — empareja cada fila de la carga masiva de compras con un producto
 * EXISTENTE de la tienda, con la misma precedencia que `resolve-lines`: SKU de
 * producto → código de barras de producto → SKU de variante → código de
 * barras de variante (productos no archivados; SKU crudo y recortado). Una
 * fila sin coincidencia NO es error: vuelve con `will_create: true` porque
 * `resolve-lines` / la creación de la OC crea el producto (decisión de Rafael,
 * 13-nov: la carga de compras también da de alta catálogo). Solo es error la
 * fila sin SKU ni código de barras. Esta función no escribe nada.
 *
 * Dos consultas para todo el lote (no N por fila). La tienda va explícita en
 * cada `where` además del scope del cliente.
 */
export async function matchBulkPurchaseLines(
  client: BulkLineLookupClient,
  storeId: number,
  items: CheckBulkPurchaseLineDto[],
): Promise<CheckBulkLineResult[]> {
  const codes = new Set<string>();
  const lines = items.map((item) => {
    const rawSku = typeof item.sku === 'string' ? item.sku : '';
    const sku = rawSku.trim();
    const barcode = typeof item.barcode === 'string' ? item.barcode.trim() : '';
    if (sku) {
      codes.add(sku);
      codes.add(rawSku);
    }
    if (barcode) codes.add(barcode);
    return { sku, rawSku, barcode };
  });

  const codeList = Array.from(codes);
  const productScope = { store_id: storeId, state: { not: 'archived' } };
  const [products, variants] = codeList.length
    ? await Promise.all([
        client.products.findMany({
          where: {
            ...productScope,
            OR: [{ sku: { in: codeList } }, { barcode: { in: codeList } }],
          },
          select: { id: true, name: true, sku: true, barcode: true },
        }),
        client.product_variants.findMany({
          where: {
            products: productScope,
            OR: [{ sku: { in: codeList } }, { barcode: { in: codeList } }],
          },
          select: {
            id: true,
            product_id: true,
            sku: true,
            barcode: true,
            name: true,
            products: { select: { name: true } },
          },
        }),
      ])
    : [[], []];

  const productBySku = new Map<string, ProductRow>();
  const productByBarcode = new Map<string, ProductRow>();
  for (const p of products) {
    if (p.sku) productBySku.set(p.sku.trim(), productBySku.get(p.sku.trim()) ?? p);
    if (p.barcode) productByBarcode.set(p.barcode.trim(), p);
  }
  const variantBySku = new Map<string, VariantRow>();
  const variantByBarcode = new Map<string, VariantRow>();
  for (const v of variants) {
    if (v.sku) variantBySku.set(v.sku.trim(), variantBySku.get(v.sku.trim()) ?? v);
    if (v.barcode) variantByBarcode.set(v.barcode.trim(), v);
  }

  return lines.map((line, index) => {
    if (!line.sku && !line.barcode) {
      return {
        index,
        product_id: null,
        product_variant_id: null,
        product_name: null,
        sku: null,
        will_create: false,
        error: {
          code: BULK_LINE_WITHOUT_CODE,
          message: 'falta el SKU o el código de barras del producto',
        },
      };
    }
    const product =
      (line.sku && productBySku.get(line.sku)) ||
      (line.barcode && productByBarcode.get(line.barcode)) ||
      null;
    if (product) {
      return {
        index,
        product_id: product.id,
        product_variant_id: null,
        product_name: product.name,
        sku: product.sku,
        will_create: false,
      };
    }
    const variant =
      (line.sku && variantBySku.get(line.sku)) ||
      (line.barcode && variantByBarcode.get(line.barcode)) ||
      null;
    if (variant) {
      const base = variant.products?.name ?? '';
      return {
        index,
        product_id: variant.product_id,
        product_variant_id: variant.id,
        product_name: [base, variant.name].filter(Boolean).join(' - ') || null,
        sku: variant.sku,
        will_create: false,
      };
    }
    return {
      index,
      product_id: null,
      product_variant_id: null,
      product_name: null,
      sku: line.sku || null,
      will_create: true,
    };
  });
}
