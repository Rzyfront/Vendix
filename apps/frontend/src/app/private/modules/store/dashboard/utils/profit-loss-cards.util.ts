/** Formateador de moneda inyectado (CurrencyFormatService.formatCompact). */
export type MoneyFormatter = (value: number) => string;

/**
 * Forma mínima que leen las sub-etiquetas de las tarjetas P&L. Es estructural:
 * tanto `ProfitLossSummary` (tienda) como `OrganizationProfitLossSummary`
 * (organización) son asignables, así ambas vistas comparten una sola fuente.
 */
export interface ProfitLossCardsData {
  cash: {
    income_without_tax: number;
    refunds: number;
    refunds_pending: number;
    net_profit_after_expenses: number;
    net_margin: number;
    balance_accumulated: number;
    expenses_paid: number;
    cost_coverage: {
      units_total: number;
      units_without_cost: number;
      coverage_ratio: number;
    };
  };
  operating_expenses: number;
  comparison: { expenses_growth: number | null };
}

type Summary = ProfitLossCardsData | null | undefined;

/**
 * `null` growth means the previous period had no base; saying "0 %" there
 * asserts "no change" about a period that had nothing.
 * `comparisonLabel` es el nombre del periodo previo (p. ej. 'ayer', 'mes ant.').
 */
export function getGrowthText(
  growth: number | null | undefined,
  comparisonLabel: string,
): string {
  if (growth === undefined || growth === null) return 'sin base de comparación';
  const sign = growth >= 0 ? '+' : '';
  return `${sign}${growth.toFixed(1)}% vs ${comparisonLabel}`;
}

export function getMarginText(margin?: number | null): string {
  if (margin === undefined || margin === null) return '';
  return `${margin.toFixed(1)}% margen`;
}

/**
 * Sub-etiqueta de INGRESOS. El número grande es `cash.income`: toda la plata
 * que entró en el día, BRUTA. Abajo van las dos cifras que el comerciante
 * necesita para leerlo bien:
 *  - "Sin IVA": el ingreso menos el impuesto trasladado (IVA + INC) que viene
 *    dentro, prorrateado por la fracción efectivamente cobrada de cada orden.
 *  - "Reembolsos": lo que salió de vuelta ESE día, bucketeado por la fecha del
 *    reembolso y nunca por la de la venta original.
 * Si además hay reembolsos solicitados sin desembolsar, se avisan: no están
 * restados en ninguna cifra porque la plata todavía no se movió.
 *
 * Las partes se unen con ' · ' y no con '\n': `.stat-small` del componente
 * compartido no declara `white-space: pre-line` y clampa a 2 líneas, así que
 * un salto de línea se colapsaba a espacio y las cifras quedaban pegadas.
 */
export function buildIngresosSubText(data: Summary, fmt: MoneyFormatter): string {
  const cash = data?.cash;
  const parts = [`Sin IVA: ${fmt(cash?.income_without_tax || 0)}`];
  const refunds = cash?.refunds || 0;
  if (refunds > 0) parts.push(`Reembolsos: ${fmt(refunds)}`);
  const pending = cash?.refunds_pending || 0;
  if (pending > 0) parts.push(`Por reembolsar: ${fmt(pending)}`);
  return parts.join(' · ');
}

/**
 * Sub-etiqueta de GANANCIAS. El número grande ya está neto de IVA, de costo y
 * de reembolsos; abajo va la misma ganancia después de los gastos que salieron
 * de la caja — lo que de verdad quedó en el bolsillo.
 */
export function buildGananciasSubText(data: Summary, fmt: MoneyFormatter): string {
  const cash = data?.cash;
  if (!cash) return '';
  const parts = [`Tras gastos: ${fmt(cash.net_profit_after_expenses || 0)}`];
  if (cash.net_margin) parts.push(getMarginText(cash.net_margin));
  return parts.join(' · ');
}

/**
 * Sub-etiqueta de BALANCE. El número grande es la posición de caja del día
 * (entró − devuelto − pagado); abajo va la caja acumulada, que es LA MISMA
 * serie sin límite inferior: por construcción no puede contradecir a la diaria.
 */
export function buildBalanceSubText(data: Summary, fmt: MoneyFormatter): string {
  const cash = data?.cash;
  if (!cash) return '';
  return `Caja acumulada: ${fmt(cash.balance_accumulated || 0)}`;
}

/**
 * Sub-etiqueta de GASTOS. El número grande sigue siendo el gasto RECONOCIDO
 * del periodo (aprobado + pagado), igual que siempre. Cuando lo pagado no
 * coincide con lo reconocido se muestra la parte pagada, que es la que el
 * Balance resta — sin eso la resta del panel no cuadraría a la vista.
 */
export function buildGastosSubText(
  data: Summary,
  fmt: MoneyFormatter,
  comparisonLabel: string,
): string {
  const parts = [getGrowthText(data?.comparison?.expenses_growth, comparisonLabel)];
  const recognized = data?.operating_expenses || 0;
  const paid = data?.cash?.expenses_paid || 0;
  if (data && paid !== recognized) parts.push(`Pagado: ${fmt(paid)}`);
  return parts.join(' · ');
}

/**
 * True when some sold units have no cost snapshot, so profit is overstated.
 * Lee la cobertura de la BASE CAJA porque es la que alimenta la tarjeta de
 * Ganancias; leer la contable avisaría sobre un COGS que el panel no muestra.
 */
export function hasIncompleteCost(data: Summary): boolean {
  const coverage = data?.cash?.cost_coverage;
  return !!coverage && coverage.units_without_cost > 0;
}

/** Human sentence for the incomplete-cost warning. */
export function buildIncompleteCostText(data: Summary): string {
  const coverage = data?.cash?.cost_coverage;
  if (!coverage || coverage.units_without_cost === 0) return '';
  const pct = (coverage.coverage_ratio * 100).toFixed(0);
  const units = Math.round(coverage.units_without_cost);
  const total = Math.round(coverage.units_total);
  return `${units} de ${total} unidades vendidas no tienen costo registrado (cobertura ${pct} %). La ganancia mostrada está sobreestimada hasta que se registre ese costo.`;
}
