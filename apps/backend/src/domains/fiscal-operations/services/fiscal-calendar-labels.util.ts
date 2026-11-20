/**
 * Textos legibles del calendario tributario en la bitácora: nombre de la
 * obligación + periodo («IVA bimestral sep-oct 2026») y fecha corta de
 * vencimiento («23 nov», «13 ene 2027»). Puro y sin DI: lo usan el servicio de
 * recordatorios fiscales y el catálogo de enlaces de la bitácora.
 */

const MONTHS_SHORT = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

const MONTHS_LONG = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

const TYPE_LABELS: Record<string, string> = {
  vat_return: 'IVA',
  inc_return: 'Impuesto al consumo',
  withholding_return: 'Retención en la fuente',
  reteiva_return: 'Retención de IVA',
  reteica_return: 'Retención de ICA',
  ica_return: 'ICA',
  exogenous_report: 'Información exógena',
  income_tax_precierre: 'Precierre de renta',
};

const PERIODICITY_LABELS: Record<string, string> = {
  monthly: 'mensual',
  bimonthly: 'bimestral',
  four_monthly: 'cuatrimestral',
  annual: 'anual',
};

export interface FiscalObligationLabelSource {
  type: string;
  periodicity?: string | null;
  period_start: Date;
  period_end: Date;
}

/** «IVA bimestral sep-oct 2026», «Retención en la fuente nov 2026». */
export function fiscalObligationLabel(
  obligation: FiscalObligationLabelSource,
): string {
  const name = TYPE_LABELS[obligation.type] ?? 'Obligación fiscal';
  // La retención es siempre mensual: nombrarla «mensual» es ruido.
  const periodicity =
    obligation.type === 'vat_return' && obligation.periodicity
      ? PERIODICITY_LABELS[obligation.periodicity]
      : null;
  const start = obligation.period_start;
  const end = obligation.period_end;
  const startMonth = MONTHS_SHORT[start.getUTCMonth()];
  const endMonth = MONTHS_SHORT[end.getUTCMonth()];
  const range =
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth()
      ? `${endMonth} ${end.getUTCFullYear()}`
      : start.getUTCFullYear() === end.getUTCFullYear()
        ? `${startMonth}-${endMonth} ${end.getUTCFullYear()}`
        : `${startMonth} ${start.getUTCFullYear()}-${endMonth} ${end.getUTCFullYear()}`;
  return [name, periodicity, range].filter(Boolean).join(' ');
}

/** «septiembre-octubre de 2026» para la nota del recordatorio. */
export function fiscalPeriodLongLabel(
  obligation: Pick<FiscalObligationLabelSource, 'period_start' | 'period_end'>,
): string {
  const start = obligation.period_start;
  const end = obligation.period_end;
  if (
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth()
  ) {
    return `${MONTHS_LONG[end.getUTCMonth()]} de ${end.getUTCFullYear()}`;
  }
  return `${MONTHS_LONG[start.getUTCMonth()]}-${MONTHS_LONG[end.getUTCMonth()]} de ${end.getUTCFullYear()}`;
}

/**
 * Fecha corta de vencimiento: «23 nov»; con año cuando cae en un año distinto
 * al del cierre del periodo («13 ene 2027»). `due_date` es @db.Date (medianoche
 * UTC), así que se lee en UTC.
 */
export function fiscalDueShortLabel(dueDate: Date, periodEnd: Date): string {
  const day = dueDate.getUTCDate();
  const month = MONTHS_SHORT[dueDate.getUTCMonth()];
  return dueDate.getUTCFullYear() === periodEnd.getUTCFullYear()
    ? `${day} ${month}`
    : `${day} ${month} ${dueDate.getUTCFullYear()}`;
}

/** «23 de noviembre de 2026». */
export function fiscalDueLongLabel(dueDate: Date): string {
  return `${dueDate.getUTCDate()} de ${MONTHS_LONG[dueDate.getUTCMonth()]} de ${dueDate.getUTCFullYear()}`;
}
