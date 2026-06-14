/**
 * Retención en la fuente laboral — art. 383 ET, PROCEDIMIENTO 1.
 *
 * Funciones puras, sin dependencias de NestJS ni Prisma, para que el cálculo
 * sea unit-testeable y reutilizable (cálculo de nómina, previews, auditoría).
 *
 * Alcance y supuestos (documentados a propósito):
 * - SOLO procedimiento 1 (retención mensual sobre el pago del período).
 *   El procedimiento 2 (porcentaje fijo semestral, art. 386 ET) está fuera
 *   de alcance.
 * - Depuración conservadora: únicamente se restan los aportes obligatorios a
 *   salud y pensión del trabajador (INCRNGO, arts. 55-56 ET) y la renta
 *   exenta del 25% (art. 206 num. 10 ET) con su tope mensual de 790/12 UVT
 *   (Decreto 2231/2023). NO se modelan deducciones por dependientes,
 *   intereses de vivienda ni medicina prepagada — extensión futura; omitirlas
 *   solo puede producir una retención MAYOR (conservador), nunca menor a la
 *   legal.
 * - El límite global del 40% / 1.340 UVT anuales (art. 336 ET) nunca aplica
 *   aquí: con solo el 25% exento (y su propio tope mensual) la depuración
 *   jamás alcanza el 40% de los ingresos.
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
}

export interface LaborWithholdingResult {
  /** Retención final en pesos, redondeada al múltiplo de 100 más cercano. */
  retention: number;
  /** Base gravable depurada en pesos (subtotal − renta exenta). */
  base_depurada: number;
  /** Base gravable depurada expresada en UVT. */
  base_uvt: number;
  /** Renta exenta del 25% aplicada (ya con tope mensual). */
  exempt_amount: number;
  /** Tarifa marginal del rango aplicado. */
  marginal_rate: number;
  /** UVT usada en el cálculo. */
  uvt_value: number;
  method: 'art383_proc1';
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Aproximación al múltiplo de 100 más cercano (art. 802 ET). */
const roundToHundred = (value: number): number => Math.round(value / 100) * 100;

/**
 * Calcula la retención en la fuente laboral por procedimiento 1 (art. 383 ET).
 *
 * Algoritmo:
 * 1. subtotal = taxable_earnings − salud − pensión (INCRNGO, arts. 55-56 ET).
 * 2. exenta   = min(subtotal × 25%, (790/12) × UVT) (art. 206-10 + D.2231/2023).
 * 3. base_depurada = subtotal − exenta; base_uvt = base_depurada / UVT.
 * 4. Rango de la tabla: retención_uvt = (base_uvt − from_uvt) × tarifa + add_uvt;
 *    retención = (retención_uvt × UVT) aproximada al múltiplo de 100 (art. 802 ET).
 *    Bases hasta 95 UVT ⇒ retención 0.
 */
export function calculateLaborWithholding(
  input: LaborWithholdingInput,
): LaborWithholdingResult {
  const { taxable_earnings, health_deduction, pension_deduction, uvt_value, year } =
    input;

  if (!(uvt_value > 0)) {
    throw new Error(
      `calculateLaborWithholding: uvt_value must be > 0 (received ${uvt_value})`,
    );
  }

  // (1) Subtotal tras INCRNGO obligatorios (arts. 55-56 ET)
  const subtotal = Math.max(
    taxable_earnings - health_deduction - pension_deduction,
    0,
  );

  // (2) Renta exenta del 25% con tope mensual de 790/12 UVT
  const exempt_amount = round2(
    Math.min(subtotal * EXEMPT_RATE_ART_206, EXEMPT_MONTHLY_CAP_UVT * uvt_value),
  );

  // (3) Base depurada en pesos y en UVT
  const base_depurada = round2(Math.max(subtotal - exempt_amount, 0));
  const base_uvt = base_depurada / uvt_value;

  // (4) Rango de la tabla: primer rango cuyo tope cubre la base
  const table = getArt383Table(year);
  const bracket =
    table.find(
      (candidate) => candidate.to_uvt === null || base_uvt <= candidate.to_uvt,
    ) ?? table[table.length - 1];

  // Retención en pesos: (exceso sobre from_uvt × tarifa + UVT adicionales) × UVT.
  // Calculado directamente en pesos para minimizar ruido de punto flotante.
  const retention_raw =
    (base_depurada - bracket.from_uvt * uvt_value) * bracket.marginal_rate +
    bracket.add_uvt * uvt_value;
  const retention = Math.max(roundToHundred(retention_raw), 0);

  return {
    retention,
    base_depurada,
    base_uvt: round2(base_uvt),
    exempt_amount,
    marginal_rate: bracket.marginal_rate,
    uvt_value,
    method: 'art383_proc1',
  };
}
