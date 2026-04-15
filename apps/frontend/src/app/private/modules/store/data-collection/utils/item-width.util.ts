/**
 * Returns CSS width for a data collection item based on its configured width value.
 * @param width - Width percentage as string: '25' | '33' | '50' | '75' | '100' (null/undefined = 100%)
 */
export function getItemWidth(width?: string): string {
  switch (width) {
    case '25':
      return 'calc(25% - 0.75rem)';
    case '33':
      return 'calc(33.33% - 0.75rem)';
    case '50':
      return 'calc(50% - 0.75rem)';
    case '75':
      return 'calc(75% - 0.75rem)';
    default:
      return '100%';
  }
}

/** Default icon for template when none is configured */
export const DEFAULT_TEMPLATE_ICON = 'clipboard-list';

/** Default icon for tabs when none is configured */
export const DEFAULT_TAB_ICON = 'layers';

/** Default icon for sections when none is configured */
export const DEFAULT_SECTION_ICON = 'list';

/**
 * Returns a responsive CSS class for field width.
 * Mobile-first: all fields 100% on phones, configured widths on tablet+.
 * - Mobile (< 640px): everything 100%
 * - Tablet (640-1023px): 25/33% → 50%, rest → 100%
 * - Desktop (≥ 1024px): configured width
 */
export function getItemWidthClass(width?: string): string {
  switch (width) {
    case '25':
      return 'field-width-25';
    case '33':
      return 'field-width-33';
    case '50':
      return 'field-width-50';
    case '75':
      return 'field-width-75';
    default:
      return 'field-width-100';
  }
}
