import type { CheckBulkPurchaseLineResult } from '../../services/purchase-orders.service';

/**
 * QUI-1004 — reglas de fila de la carga masiva de compras.
 *
 * Una fila es error solo cuando es inválida: sin SKU ni código de barras,
 * cantidad inválida, costo negativo, o un producto nuevo sin nombre (no se
 * puede crear). Un producto que no existe NO es error: se crea al crear la
 * orden (decisión de Rafael, 13-nov) y se cuenta como «creado».
 */

export const BULK_ROW_ERRORS = {
  missingCode: 'falta el SKU o el código de barras del producto',
  invalidQuantity: 'cantidad inválida',
  invalidCost: 'costo inválido',
  newProductWithoutName: 'producto nuevo sin nombre: no se puede crear',
  notChecked: 'no se pudo validar el producto',
} as const;

export interface BulkRowBasics {
  sku: string;
  barcode?: string;
  quantity: number;
  unit_cost: number;
}

/** Errores que no dependen del catálogo. */
export function bulkRowBasicErrors(row: BulkRowBasics): string[] {
  const errors: string[] = [];
  if (!row.sku && !row.barcode) errors.push(BULK_ROW_ERRORS.missingCode);
  if (!Number.isFinite(row.quantity) || row.quantity <= 0) {
    errors.push(BULK_ROW_ERRORS.invalidQuantity);
  }
  // Costo vacío = 0 (aviso, no error); negativo es inválido.
  if (Number.isFinite(row.unit_cost) && row.unit_cost < 0) {
    errors.push(BULK_ROW_ERRORS.invalidCost);
  }
  return errors;
}

export interface BulkMatchableRow {
  name: string;
  sku: string;
  errors: string[];
  product_id?: number | null;
  product_variant_id?: number | null;
  /** No existe en el catálogo: se creará con la orden. */
  will_create?: boolean;
}

/**
 * Aplica el resultado de `bulk/check-lines` a la fila: existente → toma su id
 * y completa nombre/SKU desde el catálogo; inexistente → se marca para crear
 * (si trae nombre); error del backend → error de la fila.
 */
export function applyBulkLineMatch(
  row: BulkMatchableRow,
  match: CheckBulkPurchaseLineResult | undefined,
): void {
  if (!match) {
    row.errors.push(BULK_ROW_ERRORS.notChecked);
    return;
  }
  if (match.error) {
    row.errors.push(match.error.message);
    return;
  }
  if (match.product_id) {
    row.product_id = match.product_id;
    row.product_variant_id = match.product_variant_id;
    row.will_create = false;
    if (!row.name && match.product_name) row.name = match.product_name;
    if (!row.sku && match.sku) row.sku = match.sku;
    return;
  }
  if (!row.name) {
    row.errors.push(BULK_ROW_ERRORS.newProductWithoutName);
    return;
  }
  row.product_id = null;
  row.product_variant_id = null;
  row.will_create = true;
}

/**
 * QUI-1004 — runs `worker` over `inputs` with at most `limit` calls in flight,
 * keeping results in input order. Each input gets `retries` extra attempts;
 * the first input that still fails rejects the whole run and no further
 * input is started (the caller aborts the review, as before).
 */
export async function mapWithConcurrency<T, R>(
  inputs: readonly T[],
  limit: number,
  worker: (input: T, index: number) => Promise<R>,
  retries = 1,
): Promise<R[]> {
  const results = new Array<R>(inputs.length);
  let next = 0;
  let failed = false;
  const attempt = async (index: number): Promise<R> => {
    for (let tries = 0; ; tries++) {
      try {
        return await worker(inputs[index], index);
      } catch (error) {
        if (tries >= retries) throw error;
      }
    }
  };
  const runners = Array.from(
    { length: Math.min(Math.max(1, limit), inputs.length) },
    async () => {
      while (!failed && next < inputs.length) {
        const index = next++;
        try {
          results[index] = await attempt(index);
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    },
  );
  await Promise.all(runners);
  return results;
}
