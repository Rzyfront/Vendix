/**
 * [print-editor-dsk P2.1] — Unit tests for the mm→px shared module.
 *
 * The contract this file pins:
 *   - `PX_PER_MM` matches the CSS reference (96/25.4)
 *   - `mmToPx` is a pure mm×PX_PER_MM
 *   - `paperToContainerPx`:
 *       * rolls: width_px = mm × PX_PER_MM (NO Math.max clamp — that was the bug
 *         that over-scaled thermal_58 to 300px)
 *       * sheets: width_px capped at 800, aspect preserved
 *       * A4 (210×297) → 794×1122 (within caps)
 *       * Letter (216×279) → ~817 (clamped to 800) × 1058
 */
import { PX_PER_MM, mmToPx, paperToContainerPx } from './mm-to-px';

describe('mm-to-px — shared conversion module (P2.1)', () => {
  it('PX_PER_MM equals 96 / 25.4 (CSS reference pixel)', () => {
    expect(PX_PER_MM).toBe(96 / 25.4);
    // Sanity: 80mm thermal paper ≈ 302.36px at 96dpi
    expect(mmToPx(80)).toBeCloseTo(302.362, 2);
  });

  it('mmToPx(58) ≈ 219.2 — thermal_58 width', () => {
    expect(mmToPx(58)).toBeCloseTo(219.212, 2);
  });

  it('paperToContainerPx(thermal_80 roll) → width_px ≈ 302.4, no clamp', () => {
    const box = paperToContainerPx({
      width_mm: 80,
      is_roll: true,
    });
    expect(box.is_roll).toBe(true);
    expect(box.width_px).toBeCloseTo(302.362, 2);
    // The previous frontend bug used Math.max(width_px, 300) which still
    // passed here because 302 > 300, but thermal_58 (219) was clamped UP.
    // Either way the new contract is "no clamp for rolls".
    expect(box.width_px).toBeLessThan(800);
    expect(box.height_px).toBeNull();
    expect(box.css_width).toBe('80mm');
    expect(box.css_height).toBe('auto');
  });

  it('paperToContainerPx(thermal_58 roll) → width_px ≈ 219.2, NOT clamped to 300', () => {
    const box = paperToContainerPx({
      width_mm: 58,
      is_roll: true,
    });
    expect(box.is_roll).toBe(true);
    expect(box.width_px).toBeCloseTo(219.212, 2);
    // This is the regression guard: the legacy frontend did
    // `Math.max(w * 3.78, 300)` which produced 300 — NOT 219.2.
    expect(box.width_px).not.toBe(300);
    expect(box.width_px).not.toBeGreaterThanOrEqual(300);
  });

  it('paperToContainerPx(A4 sheet 210×297) → width_px ≈ 794, height_px ≈ 1122 (within caps)', () => {
    const box = paperToContainerPx({
      width_mm: 210,
      is_roll: false,
      height_mm: 297,
    });
    expect(box.is_roll).toBe(false);
    expect(box.width_px).toBeCloseTo(mmToPx(210), 2);
    expect(box.width_px).toBeLessThanOrEqual(800);
    expect(box.height_px).toBeCloseTo(mmToPx(297), 2);
    expect(box.css_width).toBe('210mm');
    expect(box.css_height).toBe('297mm');
  });

  it('paperToContainerPx(Letter 216×279) → width capped at 800, aspect preserved', () => {
    const box = paperToContainerPx({
      width_mm: 216,
      is_roll: false,
      height_mm: 279,
    });
    expect(box.is_roll).toBe(false);
    // 216mm × 3.7795 ≈ 816 — over the 800 cap
    expect(box.width_px).toBe(800);
    // height should be aspect-preserving, NOT clamped
    expect(box.height_px).toBeCloseTo(mmToPx(279), 2);
    expect(box.css_width).toBe('216mm');
    expect(box.css_height).toBe('279mm');
  });
});
