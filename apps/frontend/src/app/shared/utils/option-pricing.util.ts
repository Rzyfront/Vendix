/**
 * Vista previa del precio de las adiciones, espejo de
 * `apps/backend/src/domains/store/product-options/option-pricing.service.ts`:
 * `per_unit` se suma tal cual al unitario; `per_line` se reparte en el
 * unitario (÷ cantidad) redondeado al centavo hacia arriba. Así el total que
 * ve el cliente es el que cobra el servidor (5.000 por línea × 3 = +5.000,01).
 */
export interface OptionDeltaParts {
  /** Σ price_delta de las opciones `per_unit`. */
  per_unit: number;
  /** Σ price_delta de las opciones `per_line`. */
  per_line: number;
}

/** Delta por unidad de una línea con `quantity` unidades. */
export function optionUnitDelta(parts: OptionDeltaParts, quantity: number): number {
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  const unitCents = Math.round((Number(parts.per_unit) || 0) * 100);
  const lineCents = Math.round((Number(parts.per_line) || 0) * 100);
  return (unitCents + Math.ceil(lineCents / qty)) / 100;
}

/** Suma las partes de las opciones elegidas según el `scope` de su grupo. */
export function sumOptionDeltaParts(
  chosen: Array<{ scope: 'per_unit' | 'per_line'; price_delta: number | string | null | undefined }>,
): OptionDeltaParts {
  const parts: OptionDeltaParts = { per_unit: 0, per_line: 0 };
  for (const option of chosen) {
    const value = Number(option.price_delta ?? 0);
    if (!Number.isFinite(value)) continue;
    if (option.scope === 'per_line') parts.per_line += value;
    else parts.per_unit += value;
  }
  return parts;
}
