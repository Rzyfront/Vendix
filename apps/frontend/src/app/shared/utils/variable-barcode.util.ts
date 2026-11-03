import {
  VariableBarcodeFormat,
  VariableBarcodePreset,
} from '../../core/models/store-settings.interface';

export type VariableBarcodeRejectReason =
  | 'length'
  | 'non_numeric'
  | 'check_digit'
  | 'prefix'
  | 'weight_range'
  | 'disabled'
  | 'ambiguous'
  | 'no_formats';

export type VariableBarcodeParseResult =
  | { ok: true; prefix: string; productCode: number; weightKg: number }
  | { ok: false; reason: Exclude<VariableBarcodeRejectReason, 'ambiguous' | 'no_formats'> };

export type VariableBarcodeResolveResult =
  | {
      ok: true;
      prefix: string;
      productCode: number;
      weightKg: number;
      format_id: string;
    }
  | { ok: false; reason: VariableBarcodeRejectReason };

export const VARIABLE_BARCODE_REASON_LABELS: Record<
  VariableBarcodeRejectReason,
  string
> = {
  length: 'El código debe tener 13 dígitos',
  non_numeric: 'El código solo puede contener números',
  check_digit: 'El dígito de control (EAN-13) no es válido',
  prefix: 'El prefijo del código no está configurado en ningún formato',
  weight_range: 'El peso es cero o supera el máximo configurado',
  disabled: 'El formato está desactivado',
  ambiguous: 'Más de un formato lo reconoce con resultados distintos',
  no_formats: 'No hay formatos activos configurados',
};

export interface VariableBarcodePresetDef {
  preset: Exclude<VariableBarcodePreset, 'custom'>;
  label: string;
  description: string;
  prefixes: string[];
  prefix_length: number;
  product_code_start: number;
  product_code_length: number;
  value_start: number;
  value_length: number;
  value_decimals: number;
  value_unit: 'kg' | 'g';
}

export const VARIABLE_BARCODE_PRESETS: VariableBarcodePresetDef[] = [
  {
    preset: 'rongta_07',
    label: 'Rongta tipo 7 (DD IIIII WW.WWW C)',
    description: 'Departamento 2 dígitos, código 5, peso en kg con 3 decimales',
    prefixes: ['21'],
    prefix_length: 2,
    product_code_start: 2,
    product_code_length: 5,
    value_start: 7,
    value_length: 5,
    value_decimals: 3,
    value_unit: 'kg',
  },
  {
    preset: 'rongta_09',
    label: 'Rongta tipo 9 (peso en gramos)',
    description: 'Igual al tipo 7, peso en gramos sin decimales',
    prefixes: ['21'],
    prefix_length: 2,
    product_code_start: 2,
    product_code_length: 5,
    value_start: 7,
    value_length: 5,
    value_decimals: 0,
    value_unit: 'g',
  },
  {
    preset: 'rongta_17',
    label: 'Rongta tipo 17 (prefijo fijo 27)',
    description: 'Prefijo fijo 27, código 5 dígitos, peso en kg con 3 decimales',
    prefixes: ['27'],
    prefix_length: 2,
    product_code_start: 2,
    product_code_length: 5,
    value_start: 7,
    value_length: 5,
    value_decimals: 3,
    value_unit: 'kg',
  },
  {
    preset: 'rongta_27',
    label: 'Rongta tipo 27 (prefijo 1 dígito)',
    description: 'Prefijo 1 dígito, código 6 dígitos, peso en kg con 3 decimales',
    prefixes: ['2'],
    prefix_length: 1,
    product_code_start: 1,
    product_code_length: 6,
    value_start: 7,
    value_length: 5,
    value_decimals: 3,
    value_unit: 'kg',
  },
];

/** Valida el dígito de control de un EAN-13. */
export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(code[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}

function newFormatId(): string {
  return `vbf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createFormatFromPreset(
  preset: Exclude<VariableBarcodePreset, 'custom'> | 'custom',
): VariableBarcodeFormat {
  const def =
    VARIABLE_BARCODE_PRESETS.find((p) => p.preset === preset) ??
    VARIABLE_BARCODE_PRESETS[0];
  return {
    id: newFormatId(),
    name: preset === 'custom' ? 'Formato personalizado' : def.label,
    enabled: true,
    preset,
    length: 13,
    prefixes: [...def.prefixes],
    prefix_length: def.prefix_length,
    product_code_start: def.product_code_start,
    product_code_length: def.product_code_length,
    value_start: def.value_start,
    value_length: def.value_length,
    value_decimals: def.value_decimals,
    value_unit: def.value_unit,
  };
}

/** Interpreta un código con un formato concreto (ignora si está desactivado). */
export function parseVariableBarcode(
  code: string,
  format: VariableBarcodeFormat,
): VariableBarcodeParseResult {
  if (!format.enabled) return { ok: false, reason: 'disabled' };
  if (typeof code !== 'string' || code.length !== format.length) {
    // Longitud distinta; si además no es numérico, se informa primero la longitud.
    return { ok: false, reason: 'length' };
  }
  if (!/^\d+$/.test(code)) return { ok: false, reason: 'non_numeric' };
  if (!isValidEan13(code)) return { ok: false, reason: 'check_digit' };

  const prefix = code.substring(0, format.prefix_length);
  if (!format.prefixes.includes(prefix)) return { ok: false, reason: 'prefix' };

  const productCode = Number(
    code.substr(format.product_code_start, format.product_code_length),
  );
  const rawValue = Number(code.substr(format.value_start, format.value_length));
  let weightKg = rawValue / Math.pow(10, format.value_decimals);
  if (format.value_unit === 'g') weightKg = weightKg / 1000;
  weightKg = Math.round(weightKg * 1e6) / 1e6;

  if (
    !(weightKg > 0) ||
    (format.max_weight_kg != null && weightKg > format.max_weight_kg)
  ) {
    return { ok: false, reason: 'weight_range' };
  }
  return { ok: true, prefix, productCode, weightKg };
}

/**
 * Prueba el código contra los formatos activos. Si varios lo aceptan con
 * resultados distintos se rechaza como ambiguo.
 */
export function resolveVariableBarcode(
  code: string,
  formats: VariableBarcodeFormat[],
): VariableBarcodeResolveResult {
  const active = (formats ?? []).filter((f) => f.enabled);
  if (!active.length) return { ok: false, reason: 'no_formats' };

  const hits: VariableBarcodeResolveResult[] = [];
  const failures: VariableBarcodeRejectReason[] = [];
  for (const f of active) {
    const r = parseVariableBarcode(code, f);
    if (r.ok) hits.push({ ...r, format_id: f.id });
    else failures.push(r.reason);
  }

  if (!hits.length) {
    // Motivo más informativo: el que más avanzó en la validación.
    const order: VariableBarcodeRejectReason[] = [
      'weight_range',
      'prefix',
      'check_digit',
      'non_numeric',
      'length',
    ];
    const reason = order.find((r) => failures.includes(r)) ?? failures[0];
    return { ok: false, reason };
  }
  const first = hits[0];
  if (first.ok) {
    const conflict = hits.some(
      (h) =>
        h.ok &&
        (h.productCode !== first.productCode || h.weightKg !== first.weightKg),
    );
    if (conflict) return { ok: false, reason: 'ambiguous' };
  }
  return first;
}
