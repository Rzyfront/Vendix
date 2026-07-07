/**
 * Helpers para el modelo de variantes basado en atributos.
 *
 * Mirror de `apps/frontend/src/app/private/modules/store/products/utils/product.utils.ts:77`
 * — la web es la fuente de verdad sobre la lógica de atributos. Si los helpers
 * de la web cambian, reflejar aquí para mantener paridad.
 */

export type VariantAttributesMap = Record<string, string>;

/**
 * Stable key for variant identification across attribute edits.
 *
 * Sortea las claves del objeto de atributos y serializa el resultado. Esto
 * garantiza que dos variantes con los mismos atributos en distinto orden
 * (`{Color: Rojo, Talla: S}` vs `{Talla: S, Color: Rojo}`) produzcan la
 * misma clave, permitiendo que la reconciliación no destructiva del form
 * preserva las ediciones del usuario al agregar/quitar valores.
 *
 * Web parity: `ProductUtils.getVariantKey` (apps/frontend/.../product.utils.ts).
 */
export function getVariantKey(attributes: VariantAttributesMap): string {
  return JSON.stringify(
    Object.keys(attributes)
      .sort()
      .reduce(
        (sorted, key) => {
          sorted[key] = attributes[key];
          return sorted;
        },
        {} as VariantAttributesMap,
      ),
  );
}

/**
 * Cartesian product of arrays.
 *
 *   cartesian([[1, 2], ['a', 'b']])
 *     → [[1, 'a'], [1, 'b'], [2, 'a'], [2, 'b']]
 *
 * Usado en `reconcileVariants` para generar todas las combinaciones
 * de valores de atributos (ej. `{Color: Rojo, Talla: S}` → 1 variante).
 *
 * Mirror de la implementación web en `reconcileVariants.cartesian()`.
 */
export function cartesian<T>(args: T[][]): T[][] {
  if (args.length === 0) return [];
  return args.reduce<T[][]>(
    (acc, curr) => acc.flatMap((a) => curr.map((b) => [...a, b])),
    [[]],
  );
}

/**
 * Parsea `variant.attributes` defensivamente.
 *
 * El backend persiste el campo como JSON y los endpoints lo devuelven
 * como objeto (`Record<string, any>`). Sin embargo, el type mobile
 * `ProductVariant.attributes` está declarado como `string | null`
 * (drift histórico). Este helper acepta ambos formatos para que el form
 * pueda reconstruir la matriz de atributos de forma segura.
 *
 * Devuelve un objeto plano con strings. Si algo falla, devuelve `{}`.
 */
export function parseVariantAttributes(raw: unknown): VariantAttributesMap {
  if (!raw) return {};
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const out: VariantAttributesMap = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') out[k] = v;
      else if (v != null) out[k] = String(v);
    }
    return out;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parseVariantAttributes(parsed);
      }
    } catch {
      // ignore
    }
  }
  return {};
}
