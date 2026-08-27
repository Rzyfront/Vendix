import { Injectable } from '@angular/core';

/**
 * [print-editor-dsk P2.3] Frontend mirror of backend
 * `apps/backend/src/domains/store/print-formats/lib/mm-to-px.ts`.
 *
 * Pure conversion. Zero DI deps. Stays in sync with backend by reading
 * the same constants (96 DPI / 25.4 mm per inch).
 */
@Injectable({ providedIn: 'root' })
export class MmToPxService {
  readonly PX_PER_MM = 96 / 25.4;
  readonly MM_PER_INCH = 25.4;
  readonly PX_PER_INCH = 96;

  mmToPx(mm: number): number {
    return mm * this.PX_PER_MM;
  }
  mmToCss(mm: number): string {
    return `${mm}mm`;
  }

  /**
   * Compute the pixel container box for a paper format. Replaces the
   * previous Math.max(w * 3.78, 300) clamp (which over-scaled thermal_58)
   * and the flat 600px for sheets.
   */
  paperToContainerPx(opts: {
    width_mm: number;
    is_roll: boolean;
    height_mm?: number | null;
  }): {
    width_px: number;
    height_px: number | null;
    css_width: string;
    css_height: string;
  } {
    const widthPx = this.mmToPx(opts.width_mm);
    if (opts.is_roll) {
      return {
        width_px: widthPx,
        height_px: null,
        css_width: this.mmToCss(opts.width_mm),
        css_height: 'auto',
      };
    }
    const heightMm = opts.height_mm ?? 297;
    return {
      width_px: Math.min(widthPx, 800),
      height_px: Math.min(this.mmToPx(heightMm), 1131),
      css_width: this.mmToCss(opts.width_mm),
      css_height: this.mmToCss(heightMm),
    };
  }
}