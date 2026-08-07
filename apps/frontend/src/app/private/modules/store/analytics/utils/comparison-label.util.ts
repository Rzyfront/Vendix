/**
 * Comparison label derived from the selected date preset.
 *
 * Used by every analytics page's `getGrowthText` so the badge label matches
 * the active preset (was the hardcoded "vs período anterior" — defect C9 in
 * the ticket catalog). On "Hoy" and "Este Año" the previous equivalent
 * period is NOT a month, so saying "vs mes ant." on a "Hoy" growth badge
 * mis-described the comparison and made the badge actively misleading.
 */
export type DatePresetLike =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | 'lastYear'
  | 'custom';

export function comparisonLabelFor(
  preset: DatePresetLike | null | undefined,
): string {
  switch (preset) {
    case 'today':
      return 'ayer';
    case 'yesterday':
      return 'día ant.';
    case 'thisWeek':
    case 'lastWeek':
      return 'semana ant.';
    case 'thisMonth':
    case 'lastMonth':
      return 'mes ant.';
    case 'thisYear':
    case 'lastYear':
      return 'año ant.';
    default:
      return 'período ant.';
  }
}
