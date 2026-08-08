/**
 * Comparison label derived from the selected date preset.
 *
 * Lifted out of `dashboard.component.ts#comparisonLabel` so the analytics
 * module (and any future caller) can render the SAME short label the
 * dashboard uses, instead of the hardcoded "vs período anterior" several
 * pages used to print regardless of preset.
 *
 * Why this matters (QUI-609, defect C9): for "Hoy" and "Este Año" the previous
 * equivalent period is NOT a month, so saying "vs mes ant." on a "Hoy" growth
 * badge mis-described the comparison and made the badge actively misleading.
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

export function comparisonLabelFor(preset: DatePresetLike | null | undefined): string {
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
