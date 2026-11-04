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
  /** Qué balanza y tipo de código representa la plantilla. */
  scale_hint: string;
  /** Qué hay que elegir en el menú de la balanza para que imprima así. */
  scale_setting: string;
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
    scale_hint:
      'Balanza etiquetadora Rongta con código de barras tipo 7. Es el formato más común.',
    scale_setting:
      'En la balanza elige el código de barras tipo 7 (DD IIIII WW.WWW C) con prefijo 21.',
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
    scale_hint:
      'Balanza etiquetadora Rongta con código de barras tipo 9: mismo diseño que el tipo 7, el peso viene en gramos.',
    scale_setting:
      'En la balanza elige el código de barras tipo 9 con prefijo 21. Lee igual que el tipo 7 (00180 = 180 g = 0,180 kg): usa uno de los dos, no ambos.',
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
    scale_hint:
      'Balanza etiquetadora Rongta con código de barras tipo 17: la balanza siempre empieza la etiqueta con 27.',
    scale_setting:
      'En la balanza elige el código de barras tipo 17. El prefijo 27 lo pone la balanza; no se configura.',
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
    scale_hint:
      'Balanza etiquetadora Rongta con código de barras tipo 27: prefijo de un solo dígito (2) y código de producto de 6 dígitos.',
    scale_setting:
      'En la balanza elige el código de barras tipo 27 con prefijo 2. Úsalo si tus códigos de balanza pasan de 99999.',
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

/** Dígito de control EAN-13 de los 12 primeros dígitos. */
export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

/** Valida el dígito de control de un EAN-13. */
export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code) === Number(code[12]);
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

// ─── Ayudas de la pantalla de configuración ─────────────────────────────
// Las posiciones se guardan como índices base 0 (contrato con el backend);
// la UI siempre las muestra contando desde 1.

/** Dígitos de datos de un EAN-13: el 13.º es el dígito de control. */
export const VARIABLE_BARCODE_DATA_DIGITS = 12;

export type VariableBarcodeSegmentKind =
  | 'prefix'
  | 'product'
  | 'weight'
  | 'check'
  | 'unused';

export interface VariableBarcodeSegment {
  kind: VariableBarcodeSegmentKind;
  label: string;
  /** Índice base 0 del primer dígito. */
  start: number;
  length: number;
  /** Dígitos reales (si hay código) o marcadores. */
  digits: string;
  /** Rango en base 1 para mostrar, p. ej. "3–7" o "13". */
  positions: string;
}

export const VARIABLE_BARCODE_SEGMENT_LABELS: Record<
  VariableBarcodeSegmentKind,
  string
> = {
  prefix: 'Prefijo',
  product: 'Código de producto',
  weight: 'Peso',
  check: 'Dígito de control',
  unused: 'Sin uso',
};

const SEGMENT_PLACEHOLDER: Record<VariableBarcodeSegmentKind, string> = {
  prefix: 'P',
  product: 'C',
  weight: 'W',
  check: 'K',
  unused: '0',
};

/** Rango en base 1 de un tramo base 0: (2, 5) → "3–7". */
export function positionsLabel(start: number, length: number): string {
  if (length <= 1) return `${start + 1}`;
  return `${start + 1}–${start + length}`;
}

/**
 * Parte los 13 dígitos en tramos (prefijo, código, peso, control y huecos sin
 * uso). Con `code` de 13 dígitos pinta los dígitos reales; si no, marcadores.
 * Devuelve `[]` si el diseño no es válido (ver `validateVariableBarcodeLayout`).
 */
export function describeVariableBarcode(
  format: VariableBarcodeFormat,
  code?: string | null,
): VariableBarcodeSegment[] {
  if (validateVariableBarcodeLayout(format)) return [];
  const real = typeof code === 'string' && /^\d{13}$/.test(code) ? code : null;
  const spans: Array<{ kind: VariableBarcodeSegmentKind; start: number; length: number }> = [];
  if (format.prefix_length > 0) {
    spans.push({ kind: 'prefix', start: 0, length: format.prefix_length });
  }
  spans.push({
    kind: 'product',
    start: format.product_code_start,
    length: format.product_code_length,
  });
  spans.push({ kind: 'weight', start: format.value_start, length: format.value_length });
  spans.sort((a, b) => a.start - b.start);

  // Rellena los huecos entre tramos con "sin uso" y cierra con el control.
  const filled: typeof spans = [];
  let cursor = 0;
  for (const s of spans) {
    if (s.start > cursor) filled.push({ kind: 'unused', start: cursor, length: s.start - cursor });
    filled.push(s);
    cursor = s.start + s.length;
  }
  if (cursor < VARIABLE_BARCODE_DATA_DIGITS) {
    filled.push({ kind: 'unused', start: cursor, length: VARIABLE_BARCODE_DATA_DIGITS - cursor });
  }
  filled.push({ kind: 'check', start: VARIABLE_BARCODE_DATA_DIGITS, length: 1 });

  return filled.map((s) => ({
    ...s,
    label: VARIABLE_BARCODE_SEGMENT_LABELS[s.kind],
    digits: real
      ? real.substr(s.start, s.length)
      : SEGMENT_PLACEHOLDER[s.kind].repeat(s.length),
    positions: positionsLabel(s.start, s.length),
  }));
}

/**
 * Misma regla que `VariableBarcodeLayoutConstraint` del backend: prefijo,
 * código y peso caben en los 12 dígitos de datos, sin solaparse, y código y
 * peso miden al menos 1. Devuelve el motivo en lenguaje de pantalla o `null`.
 */
export function validateVariableBarcodeLayout(
  format: Pick<
    VariableBarcodeFormat,
    | 'prefix_length'
    | 'product_code_start'
    | 'product_code_length'
    | 'value_start'
    | 'value_length'
    | 'value_decimals'
  >,
): string | null {
  const nums = [
    format.prefix_length,
    format.product_code_start,
    format.product_code_length,
    format.value_start,
    format.value_length,
    format.value_decimals,
  ];
  if (!nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 13)) {
    return 'Las posiciones, largos y decimales deben ser números enteros entre 0 y 13';
  }
  // Con 0 dígitos ningún prefijo es válido y el formato no reconoce nada.
  if (format.prefix_length < 1) return 'El prefijo necesita al menos 1 dígito';
  if (format.product_code_length < 1) return 'El código de producto debe tener al menos 1 dígito';
  if (format.value_length < 1) return 'El peso debe tener al menos 1 dígito';
  const spans: Array<{ name: string; start: number; end: number }> = [
    { name: 'el prefijo', start: 0, end: format.prefix_length },
    {
      name: 'el código de producto',
      start: format.product_code_start,
      end: format.product_code_start + format.product_code_length,
    },
    {
      name: 'el peso',
      start: format.value_start,
      end: format.value_start + format.value_length,
    },
  ];
  for (const s of spans) {
    if (s.end > VARIABLE_BARCODE_DATA_DIGITS) {
      const cap = s.name.charAt(0).toUpperCase() + s.name.slice(1);
      return `${cap} llega a la posición ${s.end} y solo hay 12 de datos (la 13 es el dígito de control)`;
    }
  }
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const a = spans[i];
      const b = spans[j];
      if (a.end > a.start && b.end > b.start && a.start < b.end && b.start < a.end) {
        const from = Math.max(a.start, b.start);
        const to = Math.min(a.end, b.end);
        return `${a.name.charAt(0).toUpperCase() + a.name.slice(1)} y ${b.name} se pisan en ${
          to - from > 1 ? 'las posiciones' : 'la posición'
        } ${positionsLabel(from, to - from)}`;
      }
    }
  }
  return null;
}

export interface ParsedPrefixList {
  prefixes: string[];
  /** Entradas que no son numéricas o no miden `prefix_length`. */
  invalid: string[];
  /** Se escribieron más de `max` prefijos válidos. */
  truncated: boolean;
}

/** Lee la lista de prefijos escrita a mano sin descartar nada en silencio. */
export function parsePrefixList(
  text: string | null | undefined,
  prefixLength: number,
  max = 20,
): ParsedPrefixList {
  const items = [
    ...new Set(
      (text ?? '')
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0),
    ),
  ];
  const re = new RegExp(`^\\d{${Math.max(prefixLength, 0)}}$`);
  const valid = items.filter((p) => prefixLength > 0 && re.test(p));
  const invalid = items.filter((p) => !(prefixLength > 0 && re.test(p)));
  return { prefixes: valid.slice(0, max), invalid, truncated: valid.length > max };
}

/** Divisor que convierte el valor crudo del código en kilogramos. */
function kgDivisor(format: VariableBarcodeFormat): number {
  return Math.pow(10, format.value_decimals) * (format.value_unit === 'g' ? 1000 : 1);
}

/**
 * Arma un código de ejemplo válido (con dígito de control) para un formato.
 * Devuelve `null` si el código o el peso no caben en sus posiciones.
 */
export function buildExampleBarcode(
  format: VariableBarcodeFormat,
  productCode: number,
  weightKg: number,
): string | null {
  if (validateVariableBarcodeLayout(format)) return null;
  const digits = Array.from({ length: VARIABLE_BARCODE_DATA_DIGITS }, () => '0');
  const put = (start: number, length: number, value: string): boolean => {
    if (value.length > length) return false;
    const padded = value.padStart(length, '0');
    for (let i = 0; i < length; i++) digits[start + i] = padded[i];
    return true;
  };
  const prefix = format.prefixes[0] ?? '';
  if (format.prefix_length > 0 && !put(0, format.prefix_length, prefix)) return null;
  if (!put(format.product_code_start, format.product_code_length, String(productCode))) {
    return null;
  }
  const raw = Math.round(weightKg * kgDivisor(format));
  if (!put(format.value_start, format.value_length, String(raw))) return null;
  const first12 = digits.join('');
  return first12 + ean13CheckDigit(first12);
}

export interface VariableBarcodeFormatPair {
  a: string;
  b: string;
  /** Prefijos que se pisan entre ambos formatos. */
  prefixes: string[];
  /**
   * Los dos tienen el mismo peso máximo (o ninguno lo tiene). Si difieren,
   * solo dan el mismo resultado hasta el menor de los dos máximos.
   */
  sameMaxWeight: boolean;
}

export interface VariableBarcodeOverlaps {
  /** Mismo prefijo y mismo resultado: uno de los dos sobra. */
  equivalent: VariableBarcodeFormatPair[];
  /** Mismo prefijo y lectura distinta: el POS rechaza el código como ambiguo. */
  conflicts: VariableBarcodeFormatPair[];
}

/**
 * Compara los formatos activos de dos en dos. Dos prefijos se pisan cuando uno
 * empieza por el otro ("2" y "21"). Si además leen código y peso de la misma
 * forma (Rongta 7 y 9: 3 decimales en kg = gramos), son equivalentes. Un peso
 * máximo distinto no los vuelve ambiguos (por encima del menor solo lee uno),
 * así que siguen siendo equivalentes y `sameMaxWeight` avisa la diferencia.
 */
export function analyzeVariableBarcodeOverlaps(
  formats: VariableBarcodeFormat[],
): VariableBarcodeOverlaps {
  const active = (formats ?? []).filter((f) => f.enabled);
  const signature = (f: VariableBarcodeFormat) =>
    [
      f.prefix_length,
      f.product_code_start,
      f.product_code_length,
      f.value_start,
      f.value_length,
      kgDivisor(f),
    ].join('|');
  const result: VariableBarcodeOverlaps = { equivalent: [], conflicts: [] };
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const shared = new Set<string>();
      for (const p of a.prefixes) {
        for (const q of b.prefixes) {
          if (p.startsWith(q) || q.startsWith(p)) shared.add(p.length >= q.length ? p : q);
        }
      }
      if (!shared.size) continue;
      const pair = {
        a: a.id,
        b: b.id,
        prefixes: [...shared],
        sameMaxWeight: (a.max_weight_kg ?? null) === (b.max_weight_kg ?? null),
      };
      if (signature(a) === signature(b)) result.equivalent.push(pair);
      else result.conflicts.push(pair);
    }
  }
  return result;
}

/** Kilos que representa una unidad de venta por peso; `null` si no es de peso. */
export function weightUnitToKg(code: string | null | undefined): number | null {
  const c = (code ?? 'kg').trim().toLowerCase();
  if (c === 'kg' || c === 'kgm' || c === 'kilogramo') return 1;
  if (c === 'g' || c === 'grm' || c === 'gramo') return 0.001;
  if (c === 'lb' || c === 'lbr' || c === 'libra') return 0.45359237;
  return null;
}
