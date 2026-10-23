import { Prisma } from '@prisma/client';
import { TaxFiscalType } from '../dto';
import type { TypedTaxRate } from './final-price.util';

/**
 * QUI-INC — fila de impuesto COMPLETA de una línea de cuenta abierta (mesa o
 * estación de servicio): lo que `resolveFullTaxRowsByProductId` entrega y los
 * escritores de `order_item_taxes` persisten tal cual.
 *
 * `tax_type` e `is_inclusive` son OBLIGATORIOS a propósito: si el tipo los
 * dejaba sueltos, el punto de escritura los «completaba» (`?? 'iva'`) y el
 * resultado era una clasificación fiscal inventada (el «IVA del 8 %» que la
 * tienda 105 declaró ante la DIAN sobre un INC). Un resolver que no los traiga
 * no compila.
 */
export type FullTaxRow = TypedTaxRate & {
  tax_rate_id: number;
  name: string;
  tax_type: TaxFiscalType;
};

interface ProductTaxAssignmentsReader {
  product_tax_assignments: {
    findMany(args: {
      where: { product_id: { in: number[] } };
      include: { tax_categories: { include: { tax_rates: true } } };
    }): Promise<unknown[]>;
  };
}

/**
 * Filas de impuesto por producto con la misma agrupación y la misma precedencia
 * de `is_inclusive` (asignación → tasa → false) que
 * `TaxesService.calculateProductTaxes`. Cada producto trae SU configuración:
 * IVA incluido en el precio o sumado encima, o ninguno si no tiene asignación.
 */
export async function resolveFullTaxRowsByProductId(
  client: ProductTaxAssignmentsReader,
  productIds: number[],
): Promise<Map<number, FullTaxRow[]>> {
  const out = new Map<number, FullTaxRow[]>();
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return out;
  const assignments = await client.product_tax_assignments.findMany({
    where: { product_id: { in: ids } },
    include: { tax_categories: { include: { tax_rates: true } } },
  });
  for (const assignment of assignments as Array<{
    product_id: number;
    is_inclusive?: boolean | null;
    tax_categories?: {
      tax_type?: string | null;
      tax_rates?: Array<{
        id: number;
        name: string;
        rate: Prisma.Decimal | number;
        is_inclusive?: boolean | null;
      } | null> | null;
    } | null;
  }>) {
    const rates = assignment.tax_categories?.tax_rates ?? [];
    if (rates.length === 0) continue;
    // `tax_categories` es la dueña única de `tax_type`: acá «sin tipar» sí
    // significa IVA, igual que en `TaxesService.calculateProductTaxes`.
    const taxType =
      (assignment.tax_categories?.tax_type as TaxFiscalType | null) ??
      TaxFiscalType.IVA;
    const assignmentInclusive = assignment.is_inclusive ?? undefined;
    const list = out.get(assignment.product_id) ?? [];
    for (const rate of rates) {
      if (rate == null) continue;
      list.push({
        tax_rate_id: rate.id,
        name: rate.name,
        rate: Number(rate.rate),
        tax_type: taxType,
        is_inclusive: assignmentInclusive ?? rate.is_inclusive ?? false,
      });
    }
    out.set(assignment.product_id, list);
  }
  return out;
}
