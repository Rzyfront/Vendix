import type { ErrorCodeEntry } from '@common/errors/error-codes';
import { VendixHttpException } from '@common/errors/vendix-http.exception';

/**
 * Reglas de combinación de impuestos de VENTA asignados a un producto
 * (P1-4, auditoría impuestos por producto).
 *
 * `calculateProductTaxes` SUMA todas las tasas de todas las categorías
 * asignadas (ver CAVEAT QUI-772 en `taxes.service.ts`). Sin estas reglas un
 * producto con dos categorías IVA, con IVA + INC o con una categoría de dos
 * tarifas cobra dos veces el mismo impuesto en POS/checkout/factura.
 *
 * Reglas (una sola definición para create, update, bulk-edit y bulk-upload):
 * 1. Retenciones (`withholding` / `reteiva` / `reteica`) NO se asignan al
 *    producto: son de la venta y dependen de la contraparte (agente
 *    retenedor); las resuelve `WithholdingResolverService` en su propia
 *    cadena (skill vendix-tax-typing, "Withholding Chain"). Asignarlas al
 *    producto las convertiría en un recargo de venta.
 * 2. Máximo UNA categoría por `tax_type`. `tax_type` null cuenta como IVA
 *    (misma lectura que `calculateProductTaxes` y la skill).
 * 3. IVA e INC son mutuamente excluyentes (un bien/servicio grava con uno
 *    u otro). Cualquier otro tipo de venta existente (hoy solo ICA) convive
 *    con IVA o INC, respetando la regla 2.
 * 4. Una categoría asignada debe tener como máximo UNA tarifa aplicable a la
 *    tienda del producto (tarifas de la tienda + globales): con dos, el
 *    resolver sumaría ambas.
 *
 * ICA: `tax_type_enum` lo modela como impuesto con esquema DIAN 03 y cuenta
 * 2412 en el asiento de factura (skill vendix-tax-typing, pasos 6-7), así que
 * se mantiene asignable (máximo una categoría) para no romper tiendas que ya
 * lo usan. Hoy no existen IBUA/ICUI/impuesto a bolsas en el enum; cuando se
 * agreguen, conviven con IVA/INC por la regla 3 sin cambiar este archivo.
 */

/**
 * Entrada local de error, mismo patrón que `PROD_TAXMAP_001`
 * (`dto/bulk-edit-products.dto.ts`): el registro central
 * (`common/errors/error-codes.ts`) lo mantiene otro agente del run paralelo.
 */
export const PROD_TAX_COMBO_001: ErrorCodeEntry = {
  code: 'PROD_TAX_COMBO_001',
  httpStatus: 400,
  devMessage: 'La combinación de impuestos del producto no es válida',
};

export const WITHHOLDING_TAX_TYPES = ['withholding', 'reteiva', 'reteica'];

export type ProductTaxComboReason =
  | 'withholding_not_assignable'
  | 'duplicate_tax_type'
  | 'iva_inc_exclusive'
  | 'multiple_rates';

export interface ProductTaxComboCategory {
  id: number;
  name?: string | null;
  tax_type?: string | null;
  tax_rates?: Array<{ store_id?: number | null }>;
}

export interface ProductTaxComboViolation {
  reason: ProductTaxComboReason;
  message: string;
  tax_category_ids: number[];
}

const TYPE_LABEL: Record<string, string> = {
  iva: 'IVA',
  inc: 'INC',
  ica: 'ICA',
  withholding: 'retención en la fuente',
  reteiva: 'reteIVA',
  reteica: 'reteICA',
};

export function effectiveTaxType(tax_type?: string | null): string {
  const t = (tax_type ?? '').trim().toLowerCase();
  return t === '' ? 'iva' : t;
}

function label(cat: ProductTaxComboCategory): string {
  return `"${cat.name ?? `Categoría ${cat.id}`}"`;
}

/**
 * Tarifas de la categoría que aplican a la tienda del producto. Sin
 * `storeId` (super admin sin tienda resuelta) se cuentan todas.
 */
function applicableRateCount(
  cat: ProductTaxComboCategory,
  storeId?: number | null,
): number {
  const rates = cat.tax_rates ?? [];
  if (storeId == null) return rates.length;
  return rates.filter((r) => r.store_id == null || r.store_id === storeId)
    .length;
}

/** Puro: primera violación encontrada o `null`. */
export function findProductTaxComboViolation(
  categories: ProductTaxComboCategory[],
  options?: { storeId?: number | null; checkRates?: boolean },
): ProductTaxComboViolation | null {
  for (const cat of categories) {
    const type = effectiveTaxType(cat.tax_type);
    if (WITHHOLDING_TAX_TYPES.includes(type)) {
      return {
        reason: 'withholding_not_assignable',
        message: `La categoría ${label(cat)} es una ${TYPE_LABEL[type]}: las retenciones se calculan en la venta según el cliente o proveedor agente retenedor y no se asignan al producto. Quítala de los impuestos del producto.`,
        tax_category_ids: [cat.id],
      };
    }
  }

  const byType = new Map<string, ProductTaxComboCategory[]>();
  for (const cat of categories) {
    const type = effectiveTaxType(cat.tax_type);
    const list = byType.get(type) ?? [];
    list.push(cat);
    byType.set(type, list);
  }

  for (const [type, list] of byType) {
    if (list.length > 1) {
      const typeLabel = TYPE_LABEL[type] ?? type.toUpperCase();
      return {
        reason: 'duplicate_tax_type',
        message: `El producto tiene ${list.length} categorías de ${typeLabel} (${list.map(label).join(', ')}): solo se permite una categoría por tipo de impuesto, de lo contrario el ${typeLabel} se cobraría dos veces.`,
        tax_category_ids: list.map((c) => c.id),
      };
    }
  }

  const iva = byType.get('iva');
  const inc = byType.get('inc');
  if (iva && inc) {
    return {
      reason: 'iva_inc_exclusive',
      message: `IVA e INC son excluyentes: el producto no puede llevar ${label(iva[0])} (IVA) y ${label(inc[0])} (INC) a la vez. Deja solo uno de los dos.`,
      tax_category_ids: [iva[0].id, inc[0].id],
    };
  }

  if (options?.checkRates !== false) {
    for (const cat of categories) {
      const count = applicableRateCount(cat, options?.storeId);
      if (count > 1) {
        return {
          reason: 'multiple_rates',
          message: `La categoría de impuesto ${label(cat)} tiene ${count} tarifas y el producto las sumaría todas. Deja una sola tarifa en esa categoría antes de asignarla.`,
          tax_category_ids: [cat.id],
        };
      }
    }
  }

  return null;
}

/** Lanza 400 PROD_TAX_COMBO_001 con el motivo en español. */
export function assertProductTaxComboValid(
  categories: ProductTaxComboCategory[],
  options?: { storeId?: number | null; checkRates?: boolean },
): void {
  const violation = findProductTaxComboViolation(categories, options);
  if (!violation) return;
  throw new VendixHttpException(PROD_TAX_COMBO_001, violation.message, {
    reason: violation.reason,
    tax_category_ids: violation.tax_category_ids,
  });
}
