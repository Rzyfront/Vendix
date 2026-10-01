/** Official DIAN 2026 tax calendar. Values are due-day indexes by final NIT base digit. */
export const DIAN_TAX_CALENDAR_2026_SOURCE_URL =
  'https://www.dian.gov.co/Calendarios/Calendario_Tributario_2026.pdf';
export const DIAN_TAX_CALENDAR_2026_VERSION = '2026';

export type NitBaseLastDigit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
type DueDaysByNitDigit = Readonly<Record<NitBaseLastDigit, number>>;

/**
 * `period_month` is the period's closing month, not its due month.
 * For example, February (VAT bimonthly Jan-Feb) is due during March.
 */
export const DIAN_2026_VAT_BIMONTHLY_DUE_DAYS: Readonly<
  Partial<Record<number, DueDaysByNitDigit>>
> = {
  2: { 1: 10, 2: 11, 3: 12, 4: 13, 5: 16, 6: 17, 7: 18, 8: 19, 9: 20, 0: 24 },
  4: { 1: 12, 2: 13, 3: 14, 4: 15, 5: 19, 6: 20, 7: 21, 8: 22, 9: 25, 0: 26 },
  6: { 1: 9, 2: 10, 3: 14, 4: 15, 5: 16, 6: 17, 7: 21, 8: 22, 9: 23, 0: 24 },
  8: { 1: 9, 2: 10, 3: 11, 4: 14, 5: 15, 6: 16, 7: 17, 8: 18, 9: 21, 0: 22 },
  10: { 1: 11, 2: 12, 3: 13, 4: 17, 5: 18, 6: 19, 7: 20, 8: 23, 9: 24, 0: 25 },
  12: { 1: 13, 2: 14, 3: 15, 4: 18, 5: 19, 6: 20, 7: 21, 8: 22, 9: 25, 0: 26 },
};

/** IVA cuatrimestral and bimonthly INC reuse the matching official IVA dates. */
export const DIAN_2026_VAT_FOUR_MONTHLY_DUE_DAYS: Readonly<
  Partial<Record<number, DueDaysByNitDigit>>
> = {
  4: DIAN_2026_VAT_BIMONTHLY_DUE_DAYS[4],
  8: DIAN_2026_VAT_BIMONTHLY_DUE_DAYS[8],
  12: DIAN_2026_VAT_BIMONTHLY_DUE_DAYS[12],
};

/** Closing month 12 (Sep-Dec) is due in January 2027. */
export const DIAN_2026_RETENTION_MONTHLY_DUE_DAYS: Readonly<
  Partial<Record<number, DueDaysByNitDigit>>
> = {
  1: { 1: 10, 2: 11, 3: 12, 4: 13, 5: 16, 6: 17, 7: 18, 8: 19, 9: 20, 0: 23 },
  2: { 1: 10, 2: 11, 3: 12, 4: 13, 5: 16, 6: 17, 7: 18, 8: 19, 9: 20, 0: 24 },
  3: { 1: 13, 2: 14, 3: 15, 4: 16, 5: 20, 6: 21, 7: 22, 8: 23, 9: 24, 0: 27 },
  4: DIAN_2026_VAT_BIMONTHLY_DUE_DAYS[4],
  5: { 1: 10, 2: 11, 3: 12, 4: 16, 5: 17, 6: 18, 7: 19, 8: 22, 9: 23, 0: 24 },
  6: DIAN_2026_VAT_BIMONTHLY_DUE_DAYS[6],
  7: { 1: 12, 2: 13, 3: 14, 4: 18, 5: 19, 6: 20, 7: 21, 8: 24, 9: 25, 0: 26 },
  8: DIAN_2026_VAT_BIMONTHLY_DUE_DAYS[8],
  9: { 1: 9, 2: 13, 3: 14, 4: 15, 5: 16, 6: 19, 7: 20, 8: 21, 9: 22, 0: 23 },
  10: DIAN_2026_VAT_BIMONTHLY_DUE_DAYS[10],
  11: { 1: 10, 2: 11, 3: 14, 4: 15, 5: 16, 6: 17, 7: 18, 8: 21, 9: 22, 0: 23 },
  12: DIAN_2026_VAT_BIMONTHLY_DUE_DAYS[12],
};
