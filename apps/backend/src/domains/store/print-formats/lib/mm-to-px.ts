/**
 * [print-editor-dsk P2.1] mm → px conversion.
 *
 * CSS reference pixel is 96 DPI (1 in = 96 px = 25.4 mm). Therefore:
 *   PX_PER_MM = 96 / 25.4 = 3.7795275590551185
 *
 * This module replaces the previous `3.78` magic number duplicated at
 * `print-live-preview.component.ts:137` and
 * `invoice-create-page.component.ts:4088`. The constants live here so
 * backend and frontend can read the same numbers via shared logic.
 *
 * NOTE: this is the BACKEND mirror. Frontend uses its own service at
 * `apps/frontend/src/app/shared/services/print/mm-to-px.service.ts`
 * (Phase 2.3, dispatched separately). They MUST stay in sync.
 */

export const PX_PER_MM = 96 / 25.4;  // 3.7795275590551185

export function mmToPx(mm: number): number {
  return mm * PX_PER_MM;
}

export function mmToCss(mm: number): string {
  return `${mm}mm`;
}

export interface PageBoxMm {
  width_mm: number;
  is_roll: boolean;
  height_mm?: number | null;
}

export interface PageBoxPx {
  width_px: number;
  is_roll: boolean;
  /** null for continuous rolls; integer for sheets */
  height_px: number | null;
  /** mm string for @page CSS rule */
  css_width: string;
  /** mm string for @page CSS rule */
  css_height: string;
}

/**
 * Compute the pixel box for a paper format. Replaces the frontend's
 * `Math.max(w * 3.78, 300)` (which over-scaled thermal_58 to 300px)
 * and the flat `600px` for sheets.
 *
 *  - Rolls: `width_px = width_mm * PX_PER_MM` (no clamp).
 *  - Sheets: `width_px = min(width_mm * PX_PER_MM, 800)` with aspect-preserving
 *    `height_px = height_mm * PX_PER_MM`.
 */
export function paperToContainerPx(box: PageBoxMm): PageBoxPx {
  const widthPx = mmToPx(box.width_mm);
  if (box.is_roll) {
    return {
      width_px: widthPx,
      is_roll: true,
      height_px: null,
      css_width: mmToCss(box.width_mm),
      css_height: 'auto',
    };
  }
  const heightMm = box.height_mm ?? 297;  // safe default = A4 height
  const widthPxCapped = Math.min(widthPx, 800);
  const heightPxCapped = Math.min(mmToPx(heightMm), 1131);  // ~A3 @ 96dpi
  return {
    width_px: widthPxCapped,
    is_roll: false,
    height_px: heightPxCapped,
    css_width: mmToCss(box.width_mm),
    css_height: mmToCss(heightMm),
  };
}
