/**
 * Retención en la fuente laboral — art. 383 ET, PROCEDIMIENTO 1.
 *
 * Funciones puras, sin dependencias de NestJS ni Prisma, para que el cálculo
 * sea unit-testeable y reutilizable (cálculo de nómina, previews, auditoría).
 *
 * Alcance y supuestos (documentados a propósito):
 * - Procedimiento 1 (mensual) se modela completo. El procedimiento 2 (porcentaje
 *   fijo semestral, art. 386 ET) se implementa como una rama que reutiliza la
 *   misma base depurada.
 * - Depuración completa, ORDEN FIJO (regla de pirámide art. 383/387 ET):
 *     1) INCRNGO: salud + pensión obligatorias (arts. 55-56 ET).
 *     2) Deducciones art. 387 ET con topes individuales:
 *        - Dependientes económicos: 72 UVT/año (prorrateo mensual, máx 4
 *          dependientes; o 10% del INCRNGO si este fuere menor — se aplica el
 *          menor para beneficio del trabajador).
 *        - Intereses de vivienda: tope 100 UVT/mes.
 *        - Medicina prepagada: tope 16 UVT/mes.
 *     3) Renta exenta 25% (art. 206 num. 10 ET) con tope mensual 790/12 UVT
 *        (Decreto 2231/2023).
 *     4) Tope global art. 336 ET: el total deducido (pasos 2+3) NO puede
 *        exceder el 40% del INCRNGO depurado NI 1.340 UVT/mes; se aplica el
 *        menor.
 * - Redondeo del valor final al múltiplo de 100 más cercano (aproximación
 *   art. 802 ET).
 */

export interface Art383Bracket {
  /** Límite inferior del rango en UVT (exclusivo, salvo el primer rango). */
  from_uvt: number;
  /** Límite superior del rango en UVT (inclusivo); null = sin tope. */
  to_uvt: number | null;
  /** Tarifa marginal aplicable al exceso sobre from_uvt. */
  marginal_rate: number;
  /** UVT adicionales fijas del rango (columna "+ X UVT" de la tabla). */
  add_uvt: number;
}

/**
 * Tabla del art. 383 ET vigente desde la Ley 2010/2019 (sin cambios
 * posteriores a la fecha): la base gravable en UVT determina el rango.
 *
 * | Desde | Hasta | Tarifa | UVT adicionales |
 * |   0   |   95  |   0%   |        0        |
 * |  >95  |  150  |  19%   |        0        |
 * | >150  |  360  |  28%   |       10        |
 * | >360  |  640  |  33%   |       69        |
 * | >640  |  945  |  35%   |      162        |
 * | >945  | 2300  |  37%   |      268        |
 * | >2300 |   —   |  39%   |      770        |
 */
export const ART_383_TABLE_2020: Art383Bracket[] = [
  { from_uvt: 0, to_uvt: 95, marginal_rate: 0, add_uvt: 0 },
  { from_uvt: 95, to_uvt: 150, marginal_rate: 0.19, add_uvt: 0 },
  { from_uvt: 150, to_uvt: 360, marginal_rate: 0.28, add_uvt: 10 },
  { from_uvt: 360, to_uvt: 640, marginal_rate: 0.33, add_uvt: 69 },
  { from_uvt: 640, to_uvt: 945, marginal_rate: 0.35, add_uvt: 162 },
  { from_uvt: 945, to_uvt: 2300, marginal_rate: 0.37, add_uvt: 268 },
  { from_uvt: 2300, to_uvt: null, marginal_rate: 0.39, add_uvt: 770 },
];

/**
 * Devuelve la tabla del art. 383 vigente para el año dado.
 * Hoy la tabla de la Ley 2010/2019 aplica a todos los años soportados;
 * el parámetro existe para versionar futuras reformas sin cambiar firmas.
 */
export function getArt383Table(year: number): Art383Bracket[] {
  void year; // versionable por año; única versión vigente: Ley 2010/2019
  return ART_383_TABLE_2020;
}

/** Renta exenta laboral del 25% (art. 206 num. 10 ET). */
export const EXEMPT_RATE_ART_206 = 0.25;

/**
 * Tope MENSUAL de la renta exenta del 25%: 790 UVT anuales / 12
 * (Decreto 2231/2023, que reglamenta el art. 206 num. 10 ET).
 */
export const EXEMPT_MONTHLY_CAP_UVT = 790 / 12;

/**
 * Deducciones art. 387 ET — topes INDIVIDUALES en UVT.
 * Vigencia 2026 (Decreto 2231/2023 y normas concordantes). Se expresan en UVT
 * para evitar que cambios en la UVT anualicen la tabla.
 *
 * - Dependientes económicos: 72 UVT/AÑO → prorrateo mensual (÷12).
 *   Máximo legal: hasta 4 dependientes acreditados.
 *   Alternativa: el 10% del INCRNGO si es menor (siempre se aplica el menor).
 * - Intereses de vivienda: 100 UVT/MES.
 * - Medicina prepagada: 16 UVT/MES.
 */
export const ART_387_DEPENDENTS_UVT_YEAR = 72;
export const ART_387_DEPENDENTS_MAX_COUNT = 4;
export const ART_387_DEPENDENTS_RATE_OF_INCRNGO = 0.1;
export const ART_387_HOUSING_INTEREST_UVT_MONTH = 100;
export const ART_387_PREPAID_MEDICINE_UVT_MONTH = 16;

/** Pensión voluntaria y AFC — mismas reglas de tope, fuera del límite 40%. */
export const VOLUNTARY_PENSION_UVT_MONTH = 100;
export const AFC_UVT_MONTH = 100;

/** Tope global art. 336 ET: 40% del INCRNGO depurado, máx 1.340 UVT/mes. */
export const ART_336_GLOBAL_RATE = 0.4;
export const ART_336_GLOBAL_CAP_UVT = 1340;

/**
 * Perfil fiscal del empleado (art. 387 ET). Cada campo es el valor mensual
 * ACREDITADO por el empleado; los topes se aplican dentro del cálculo.
 *
 * El perfil es opcional: si llega `undefined` o todos los campos son 0, el
 * cálculo cae al comportamiento histórico (sin deducciones art. 387).
 */
export interface Art387Deductions {
  /** Número de dependientes económicos acreditados (0..10, máx legal 4). */
  dependents_count: number;
  /** Valor mensual declarado de intereses de vivienda. */
  housing_interest_monthly: number;
  /** Valor mensual declarado de medicina prepagada. */
  prepaid_medicine_monthly: number;
  /** Valor mensual de aportes voluntarios a pensión (no obligatorio). */
  voluntary_pension_monthly: number;
  /** Valor mensual de aportes a cuenta AFC. */
  afc_monthly: number;
}

export type RetentionProcedure = 'proc1' | 'proc2';

export interface LaborWithholdingInput {
  /** Devengos laborales gravables del período (salario; SIN auxilio de transporte). */
  taxable_earnings: number;
  /** Aporte obligatorio del trabajador a salud (INCRNGO, art. 56 ET). */
  health_deduction: number;
  /** Aporte obligatorio del trabajador a pensión (INCRNGO, art. 55 ET). */
  pension_deduction: number;
  /** Valor de la UVT del año fiscal del período. */
  uvt_value: number;
  /** Año fiscal del período (selecciona la versión de la tabla). */
  year: number;
  /** Deducciones art. 387 ET que el empleado acredita (opcional). */
  art_387_deductions?: Art387Deductions;
  /**
   * Procedimiento de retención. Por defecto 'proc1' (art. 383 ET) — Proc. 2
   * (art. 386 ET, porcentaje fijo semestral) requiere un `fixed_retention_rate`
   * precalculado para el semestre; si llega proc2 sin porcentaje se cae a
   * proc1 con warning semántico (no retener 0 silenciosamente).
   */
  procedure?: RetentionProcedure;
  /**
   * Porcentaje fijo semestral (art. 386 ET) — decimal 0..1, NO porcentaje.
   * Ej: 0.05 para 5%. Solo aplica si procedure='proc2'.
   */
  fixed_retention_rate?: number;
}

export interface LaborWithholdingResult {
  /** Retención final en pesos, redondeada al múltiplo de 100 más cercano. */
  retention: number;
  /** Base gravable depurada en pesos (después de todos los pasos de depuración). */
  base_depurada: number;
  /** Base gravable depurada expresada en UVT. */
  base_uvt: number;
  /** Renta exenta del 25% aplicada (ya con tope mensual). */
  exempt_amount: number;
  /** Tarifa marginal del rango aplicado (art. 383 ET) — 0 si proc2. */
  marginal_rate: number;
  /** UVT usada en el cálculo. */
  uvt_value: number;
  /**
   * Método aplicado.
   * - 'art383_proc1' — art. 383 ET procedimiento 1 (tabla progresiva).
   * - 'art386_proc2' — art. 386 ET procedimiento 2 (porcentaje fijo semestral).
   */
  method: 'art383_proc1' | 'art386_proc2';
  /**
   * Desglose auditable de la depuración (snapshot para retención_details).
   * Cuando no hay deducciones art. 387 ni tope global, se omite para no
   * inflar el payload con ceros.
   */
  deductions_387?: {
    /** INCRNGO = salud + pensión obligatorias. */
    incrng_o: number;
    /** Deducción por dependientes acreditada y aplicada (con tope). */
    dependents: number;
    /** Deducción por intereses de vivienda aplicada (con tope). */
    housing_interest: number;
    /** Deducción por medicina prepagada aplicada (con tope). */
    prepaid_medicine: number;
    /** Total deducciones art. 387 (suma aplicada). */
    total_387: number;
    /** Renta exenta 25% aplicada (con tope mensual). */
    exempt_25_pct: number;
    /** Suma de los dos tramos depurables (art. 387 + exenta 25%). */
    subtotal_deductions: number;
    /** Tope global art. 336 ET aplicado como cap. */
    global_cap_applied: number;
    /** Porcentaje fijo aplicado (proc2) — undefined si proc1. */
    fixed_rate?: number;
  };
  /** Bandera que indica que proc2 cayó a proc1 por falta de porcentaje fijo. */
  proc2_fallback?: boolean;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Aproximación al múltiplo de 100 más cercano (art. 802 ET). */
const roundToHundred = (value: number): number => Math.round(value / 100) * 100;

/**
 * Aplica los topes INDIVIDUALES de las deducciones art. 387 ET.
 *
 * Reglas (Decreto 2231/2023 y normas concordantes):
 * - Dependientes: 72 UVT/AÑO ÷ 12 = prorrateo mensual; máx 4 dependientes
 *   contables; se aplica el MENOR entre (10% del INCRNGO) y el prorrateo UVT.
 * - Intereses vivienda: tope 100 UVT/mes.
 * - Medicina prepagada: tope 16 UVT/mes.
 * - Pensión voluntaria: tope 100 UVT/mes.
 * - AFC: tope 100 UVT/mes.
 *
 * Devuelve los valores YA topeados (los originales pueden ser superiores).
 */
export function applyArt387Caps(
  incrng_o: number,
  art_387: Art387Deductions,
  uvt_value: number,
): {
  dependents: number;
  housing_interest: number;
  prepaid_medicine: number;
  voluntary_pension: number;
  afc: number;
  total_387: number;
} {
  const dependents_count = Math.max(
    0,
    Math.min(
      Math.floor(art_387.dependents_count || 0),
      ART_387_DEPENDENTS_MAX_COUNT,
    ),
  );

  // Prorrateo mensual de 72 UVT/AÑO × dependientes acreditados (cap a 4).
  const dependents_cap_uvt_year =
    ART_387_DEPENDENTS_UVT_YEAR * dependents_count;
  const dependents_cap_monthly = round2(
    (dependents_cap_uvt_year / 12) * uvt_value,
  );
  // Alternativa: 10% del INCRNGO. El ET dice "el que fuere menor".
  const dependents_alt = round2(incrng_o * ART_387_DEPENDENTS_RATE_OF_INCRNGO);
  const dependents = round2(
    Math.min(
      Math.max(0, art_387.dependents_count > 0 ? dependents_cap_monthly : 0),
      dependents_alt,
    ),
  );

  const housing_interest = round2(
    Math.min(
      Math.max(0, art_387.housing_interest_monthly || 0),
      ART_387_HOUSING_INTEREST_UVT_MONTH * uvt_value,
    ),
  );
  const prepaid_medicine = round2(
    Math.min(
      Math.max(0, art_387.prepaid_medicine_monthly || 0),
      ART_387_PREPAID_MEDICINE_UVT_MONTH * uvt_value,
    ),
  );
  const voluntary_pension = round2(
    Math.min(
      Math.max(0, art_387.voluntary_pension_monthly || 0),
      VOLUNTARY_PENSION_UVT_MONTH * uvt_value,
    ),
  );
  const afc = round2(
    Math.min(
      Math.max(0, art_387.afc_monthly || 0),
      AFC_UVT_MONTH * uvt_value,
    ),
  );

  const total_387 = round2(
    dependents + housing_interest + prepaid_medicine + voluntary_pension + afc,
  );
  return {
    dependents,
    housing_interest,
    prepaid_medicine,
    voluntary_pension,
    afc,
    total_387,
  };
}

/**
 * Aplica el tope GLOBAL art. 336 ET: el total deducible (art. 387 + renta
 * exenta 25%) NO puede exceder el menor entre (40% del INCRNGO depurado,
 * i.e. del subtotal tras restar salud y pensión obligatorias) y
 * (1.340 UVT/mes). El cap absorbe la resta que supere el límite y se reporta
 * para auditoría.
 */
export function applyGlobalCapArt336(
  subtotal: number,
  total_387: number,
  exempt_25: number,
  uvt_value: number,
): {
  capped_deductions: number;
  global_cap_applied: number;
  cap_40_pct: number;
  cap_1340_uvt: number;
} {
  const cap_40_pct = round2(Math.max(subtotal, 0) * ART_336_GLOBAL_RATE);
  const cap_1340_uvt = round2(ART_336_GLOBAL_CAP_UVT * uvt_value);
  const cap = Math.min(cap_40_pct, cap_1340_uvt);
  const subtotal_deductions = total_387 + exempt_25;
  const capped_deductions = round2(Math.min(subtotal_deductions, cap));
  const global_cap_applied = round2(Math.max(0, subtotal_deductions - cap));
  return { capped_deductions, global_cap_applied, cap_40_pct, cap_1340_uvt };
}

/**
 * Resuelve la retención por art. 383 ET, procedimiento 1, sobre la base
 * depurada. Calculado en pesos para minimizar ruido de punto flotante.
 */
function applyArt383Procedure1(
  base_depurada: number,
  base_uvt: number,
  year: number,
  uvt_value: number,
): { retention_raw: number; marginal_rate: number } {
  const table = getArt383Table(year);
  const bracket =
    table.find(
      (candidate) => candidate.to_uvt === null || base_uvt <= candidate.to_uvt,
    ) ?? table[table.length - 1];
  const retention_raw =
    (base_depurada - bracket.from_uvt * uvt_value) * bracket.marginal_rate +
    bracket.add_uvt * uvt_value;
  return { retention_raw, marginal_rate: bracket.marginal_rate };
}

/**
 * Calcula la retención en la fuente laboral.
 *
 * Algoritmo (orden FIJO art. 383 + art. 387 + art. 336 ET):
 * 1) INCRNGO = salud + pensión obligatorias (arts. 55-56 ET).
 * 2) Deducciones art. 387 ET con topes individuales.
 * 3) Renta exenta 25% (art. 206 num. 10 ET) con tope mensual 790/12 UVT.
 * 4) Tope global art. 336 ET: el total deducible (pasos 2+3) NO puede
 *    exceder el menor entre 40% del INCRNGO y 1.340 UVT/mes.
 * 5) Base depurada = subtotal − total deducible; se aplica la tabla
 *    progresiva (proc1) o el porcentaje fijo (proc2).
 * 6) Retención ≈ round-to-100 (art. 802 ET).
 *
 * Si `procedure='proc2'` pero no llega `fixed_retention_rate` válido, se cae
 * a proc1 con `proc2_fallback=true` (no retener 0 silenciosamente).
 */
export function calculateLaborWithholding(
  input: LaborWithholdingInput,
): LaborWithholdingResult {
  const {
    taxable_earnings,
    health_deduction,
    pension_deduction,
    uvt_value,
    year,
    art_387_deductions,
    procedure = 'proc1',
    fixed_retention_rate,
  } = input;

  if (!(uvt_value > 0)) {
    throw new Error(
      `calculateLaborWithholding: uvt_value must be > 0 (received ${uvt_value})`,
    );
  }

  // (1) INCRNGO = salud + pensión obligatorias (arts. 55-56 ET)
  const incrng_o = Math.max(
    health_deduction + pension_deduction,
    0,
  );
  const subtotal = Math.max(taxable_earnings - incrng_o, 0);

  // (2) Deducciones art. 387 ET con topes individuales (opcional).
  const has_art_387 =
    !!art_387_deductions &&
    (art_387_deductions.dependents_count > 0 ||
      art_387_deductions.housing_interest_monthly > 0 ||
      art_387_deductions.prepaid_medicine_monthly > 0 ||
      art_387_deductions.voluntary_pension_monthly > 0 ||
      art_387_deductions.afc_monthly > 0);
  const caps_387 = has_art_387
    ? applyArt387Caps(incrng_o, art_387_deductions as Art387Deductions, uvt_value)
    : {
        dependents: 0,
        housing_interest: 0,
        prepaid_medicine: 0,
        voluntary_pension: 0,
        afc: 0,
        total_387: 0,
      };

  // (3) Renta exenta del 25% con tope mensual de 790/12 UVT
  const exempt_amount = round2(
    Math.min(subtotal * EXEMPT_RATE_ART_206, EXEMPT_MONTHLY_CAP_UVT * uvt_value),
  );

  // (4) Tope global art. 336 ET (40% del subtotal depurado, máx 1.340 UVT/mes)
  const {
    capped_deductions: total_deductible,
    global_cap_applied,
  } = applyGlobalCapArt336(
    subtotal,
    caps_387.total_387,
    exempt_amount,
    uvt_value,
  );

  // (5) Base depurada
  const base_depurada = round2(Math.max(subtotal - total_deductible, 0));
  const base_uvt = base_depurada / uvt_value;

  // (6) Aplicar procedimiento
  const has_deductions_detail =
    has_art_387 || global_cap_applied > 0 || procedure === 'proc2';
  const deductions_387_snapshot = has_deductions_detail
    ? {
        incrng_o: round2(incrng_o),
        dependents: caps_387.dependents,
        housing_interest: caps_387.housing_interest,
        prepaid_medicine: caps_387.prepaid_medicine,
        total_387: caps_387.total_387,
        exempt_25_pct: exempt_amount,
        subtotal_deductions: round2(caps_387.total_387 + exempt_amount),
        global_cap_applied,
        ...(procedure === 'proc2' && fixed_retention_rate != null
          ? { fixed_rate: fixed_retention_rate }
          : {}),
      }
    : undefined;

  // Proc. 2: porcentaje fijo semestral. Si no llega válido → fallback a proc1.
  if (procedure === 'proc2') {
    const rate =
      typeof fixed_retention_rate === 'number' && fixed_retention_rate > 0
        ? fixed_retention_rate
        : null;
    if (rate === null) {
      // Fallback documentado: nunca retener 0 silenciosamente.
      const proc1 = applyArt383Procedure1(
        base_depurada,
        base_uvt,
        year,
        uvt_value,
      );
      return {
        retention: Math.max(roundToHundred(proc1.retention_raw), 0),
        base_depurada,
        base_uvt: round2(base_uvt),
        exempt_amount,
        marginal_rate: proc1.marginal_rate,
        uvt_value,
        method: 'art383_proc1',
        deductions_387: deductions_387_snapshot,
        proc2_fallback: true,
      };
    }
    const retention_raw = base_depurada * rate;
    return {
      retention: Math.max(roundToHundred(retention_raw), 0),
      base_depurada,
      base_uvt: round2(base_uvt),
      exempt_amount,
      marginal_rate: 0,
      uvt_value,
      method: 'art386_proc2',
      deductions_387: deductions_387_snapshot,
    };
  }

  // Proc. 1: tabla progresiva del art. 383 ET
  const proc1 = applyArt383Procedure1(base_depurada, base_uvt, year, uvt_value);
  return {
    retention: Math.max(roundToHundred(proc1.retention_raw), 0),
    base_depurada,
    base_uvt: round2(base_uvt),
    exempt_amount,
    marginal_rate: proc1.marginal_rate,
    uvt_value,
    method: 'art383_proc1',
    deductions_387: deductions_387_snapshot,
  };
}
