/**
 * CP-PURCHASE-TRANSPARENCY D.9 — el contrato del castigo, del lado del cliente.
 *
 * Espejo EXACTO de `ArchiveWriteOffPlan` / `ArchiveWriteOffLine` /
 * `ArchiveOutOfScopeStock`
 * (`apps/backend/src/domains/store/products/products.service.ts:100-152`).
 *
 * ## Por qué el mismo objeto llega por dos puertas
 *
 * El backend lo devuelve en `GET /store/products/:id/archive-preview` (dry-run,
 * estrictamente de solo lectura) y **también** dentro de
 * `details.archive_write_off` cuando `DELETE /store/products/:id` responde 409
 * `PROD_VARIANT_HAS_STOCK_001`. Son la misma forma a propósito: la interfaz
 * puede construir el diálogo de confirmación desde cualquiera de las dos, y no
 * existe una segunda redacción del plan que pueda desviarse de la primera.
 *
 * Eso importa cuando el preview se calculó hace minutos y las existencias
 * cambiaron: el rechazo trae el plan FRESCO, y la interfaz lo sustituye en vez
 * de enseñar cifras rancias.
 */

/** Una tripleta (ubicación, variante) con existencias que el archivado destruye. */
export interface ArchiveWriteOffLine {
  location_id: number;
  location_name: string;
  product_variant_id: number | null;
  variant_sku: string | null;
  quantity_on_hand: number;
  unit_cost: number;
  value: number;
  /**
   * `false` cuando el costo efectivo salió CERO tras agotar la cadena canónica.
   *
   * NO significa que la mercancía fuese gratis: significa que su costo es
   * DESCONOCIDO. La distinción es la razón de ser de este campo — sin él, la
   * interfaz enseñaría «valor a dar de baja: 0» y el operador confirmaría la
   * destrucción de existencias valiosas creyendo que no valían nada.
   */
  has_known_cost: boolean;
}

/** Una existencia que el archivado NO puede tocar, y por qué bloquea. */
export interface ArchiveOutOfScopeStock {
  location_id: number;
  location_name: string;
  store_id: number | null;
  quantity_on_hand: number;
}

/** Lo que el archivado va a destruir, calculado ANTES de destruirlo. */
export interface ArchiveWriteOffPlan {
  product_id: number;
  /**
   * `false` ⇒ no hay nada que castigar y el archivado va directo, sin modal ni
   * fricción añadida. Es el estado 1 de los TRES de esta pantalla.
   */
  requires_confirmation: boolean;
  total_units: number;
  total_value: number;
  /**
   * Unidades cuyo costo efectivo es cero. Medido en desarrollo: el 63,9 % de
   * las unidades fantasma. Se destruyen igual pero no generan asiento contable,
   * y su valor NO entra en `total_value`. Se enseñan aparte y con nombre propio.
   */
  zero_cost_units: number;
  lines: ArchiveWriteOffLine[];
  /**
   * Unidades en ubicaciones fuera del alcance de esta tienda (hoy, en la
   * práctica, la bodega central de la organización). `> 0` ⇒ estado 3: el
   * archivado está BLOQUEADO y no hay botón de confirmar que ofrecer.
   */
  out_of_scope_units: number;
  out_of_scope: ArchiveOutOfScopeStock[];
}

/**
 * Recupera el plan del cuerpo de un rechazo 409 `PROD_VARIANT_HAS_STOCK_001`.
 *
 * TOLERANTE A PROPÓSITO. Se llama mientras se está manejando un error: si el
 * cuerpo no trae plan, o lo trae con otra forma, devolver `null` deja que el
 * llamador caiga a su mensaje de error normal. Lanzar aquí dejaría al operador
 * sin ninguna explicación, que es exactamente el defecto que D.9 arregla.
 *
 * Acepta tanto el `HttpErrorResponse` crudo como el cuerpo ya desenvuelto, y
 * también el objeto normalizado que emite `handleArchiveError` en
 * `products.service.ts` (que expone `details` en la raíz).
 */
export function readArchiveWriteOffPlan(error: unknown): ArchiveWriteOffPlan | null {
  const candidates: unknown[] = [
    asRecord(error)?.['details'],
    asRecord(asRecord(error)?.['error'])?.['details'],
    asRecord(asRecord(asRecord(error)?.['error'])?.['error'])?.['details'],
  ];

  for (const candidate of candidates) {
    const plan = asRecord(asRecord(candidate)?.['archive_write_off']);
    if (!plan) {
      continue;
    }
    // `total_units` es el campo sin el cual el diálogo no puede decir nada:
    // si falta, el objeto no es un plan y se descarta.
    if (typeof plan['total_units'] !== 'number') {
      continue;
    }
    return normalizePlan(plan);
  }

  return null;
}

/**
 * Rellena lo que pueda faltar. El backend serializa `Decimal` a través de JSON
 * y los números pueden llegar como cadena; los arreglos ausentes se sustituyen
 * por vacíos para que la plantilla no tenga que defenderse de `undefined`.
 */
function normalizePlan(raw: Record<string, unknown>): ArchiveWriteOffPlan {
  const lines = Array.isArray(raw['lines']) ? raw['lines'] : [];
  const outOfScope = Array.isArray(raw['out_of_scope']) ? raw['out_of_scope'] : [];

  return {
    product_id: toNumber(raw['product_id']),
    requires_confirmation: raw['requires_confirmation'] === true,
    total_units: toNumber(raw['total_units']),
    total_value: toNumber(raw['total_value']),
    zero_cost_units: toNumber(raw['zero_cost_units']),
    lines: lines.map((entry) => {
      const line = asRecord(entry) ?? {};
      return {
        location_id: toNumber(line['location_id']),
        location_name: toText(line['location_name']) || 'Ubicación sin nombre',
        product_variant_id:
          line['product_variant_id'] === null ||
          line['product_variant_id'] === undefined
            ? null
            : toNumber(line['product_variant_id']),
        variant_sku: toText(line['variant_sku']) || null,
        quantity_on_hand: toNumber(line['quantity_on_hand']),
        unit_cost: toNumber(line['unit_cost']),
        value: toNumber(line['value']),
        // Ausente ⇒ `false`. Un costo que no se declara conocido se trata como
        // desconocido: equivocarse hacia «no sabemos» es inocuo, hacia «vale
        // cero» borra la advertencia que justifica este paso.
        has_known_cost: line['has_known_cost'] === true,
      };
    }),
    out_of_scope_units: toNumber(raw['out_of_scope_units']),
    out_of_scope: outOfScope.map((entry) => {
      const row = asRecord(entry) ?? {};
      return {
        location_id: toNumber(row['location_id']),
        location_name: toText(row['location_name']) || 'Ubicación sin nombre',
        store_id:
          row['store_id'] === null || row['store_id'] === undefined
            ? null
            : toNumber(row['store_id']),
        quantity_on_hand: toNumber(row['quantity_on_hand']),
      };
    }),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
