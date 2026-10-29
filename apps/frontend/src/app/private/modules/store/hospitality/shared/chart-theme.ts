/**
 * U16 (ui-ux-rules R-REP-03) — the theme colors a Hospitality chart uses,
 * read from the active theme's CSS variables: one accent (primary) plus
 * neutral tones, no hex fallbacks.
 */
export interface HospitalityChartColors {
  /** Solid accent for the main series. */
  primary: string;
  /** Accent at low opacity, for the bars behind the lines. */
  primarySoft: string;
  /** Neutral tone for a secondary series. */
  neutral: string;
  border: string;
  text: string;
}

export function hospitalityChartColors(): HospitalityChartColors {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    primary: read('--color-primary'),
    primarySoft: `rgba(${read('--color-primary-rgb')}, 0.3)`,
    neutral: read('--color-text-secondary'),
    border: read('--color-border'),
    text: read('--color-text-secondary'),
  };
}
