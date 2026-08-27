/**
 * [print-editor-dsk P2.2] — Unit tests for PrintDocumentRendererService.
 *
 * The contract this file pins:
 *   - Roll paper: width=80mm → width_px ≈ 302.4 (rendered in style block)
 *   - Roll paper: thermal_58 → width_px ≈ 219.2 (NOT clamped to 300)
 *   - Sheet paper: width=210mm (A4) → width_px within cap, aspect preserved
 *   - Sheet paper: width=58mm → still sheet logic (capped at 800 but aspect from height)
 *   - Single copy: html returned once
 *   - Multi-copy roll: html repeated N times with page-break separators
 */
import { PrintDocumentRendererService } from '../print-document-renderer.service';

describe('PrintDocumentRendererService — single render path (P2.2)', () => {
  let service: PrintDocumentRendererService;

  beforeEach(() => {
    service = new PrintDocumentRendererService();
  });

  it('roll paper width=80mm renders with width_px ≈ 302.4 in the style block', () => {
    const html = service.render({
      html: '<div>hello world</div>',
      paper: { width_mm: 80, is_roll: true },
    });
    // The exact CSS px value for 80mm × (96/25.4)
    const expectedPx = 80 * (96 / 25.4);
    expect(html).toContain(`width: ${expectedPx.toString()}px`);
    expect(html).toContain('<div>hello world</div>');
    expect(html).toContain('vendix-print-page');
    expect(html).toContain('height: auto');
  });

  it('roll paper thermal_58 → width_px ≈ 219.2 (NO clamp to 300)', () => {
    const html = service.render({
      html: '<p>tiny roll</p>',
      paper: { width_mm: 58, is_roll: true },
    });
    const expectedPx = 58 * (96 / 25.4);
    expect(html).toContain(`width: ${expectedPx.toString()}px`);
    // Regression guard: never produce a 300px width for thermal_58.
    expect(html).not.toContain('width: 300px');
    expect(html).not.toContain('width: 300');
  });

  it('sheet paper A4 (210×297) → width_px within 800px cap, aspect preserved', () => {
    const html = service.render({
      html: '<section>A4 sheet</section>',
      paper: { width_mm: 210, is_roll: false, height_mm: 297 },
    });
    const expectedWidth = 210 * (96 / 25.4);  // ~793.7 — under 800
    const expectedHeight = 297 * (96 / 25.4); // ~1122.5
    expect(html).toContain(`width: ${expectedWidth.toString()}px`);
    expect(html).toContain(`height: ${expectedHeight.toString()}px`);
    // A4 height < 1131 cap → no clamp
    expect(expectedHeight).toBeLessThan(1132);
    // Sanity: roll branch was NOT taken
    expect(html).not.toContain('height: auto\n');
    expect(html).not.toContain('height: auto\n    margin');
    // The CSS rule on `.vendix-print-page` is `height: 1122.5px`, not auto.
    expect(html).toMatch(/\.vendix-print-page \{[\s\S]*?height: \d+(\.\d+)?px/);
  });

  it('sheet paper small width 58mm → still sheet logic with cap (no 300 magic)', () => {
    const html = service.render({
      html: '<div>narrow sheet</div>',
      paper: { width_mm: 58, is_roll: false, height_mm: 200 },
    });
    const expectedWidth = 58 * (96 / 25.4); // ~219 — under 800 cap
    const expectedHeight = 200 * (96 / 25.4); // ~755
    expect(html).toContain(`width: ${expectedWidth.toString()}px`);
    expect(html).toContain(`height: ${expectedHeight.toString()}px`);
    // Defensive: should NOT roll out the roll branch (no 'height: auto\n    margin').
    expect(html).not.toMatch(/height: auto\n\s*margin/);
    // Width must NOT be the legacy 300 magic for narrow widths.
    expect(html).not.toContain('width: 300px');
  });

  it('single copy: html returned once, no page-break separators', () => {
    const html = service.render({
      html: '<article>only one</article>',
      paper: { width_mm: 80, is_roll: true, height_mm: null },
      copies: 1,
    });
    expect(html.match(/<article>only one<\/article>/g)).toHaveLength(1);
    expect(html).not.toContain('break-after: page');
  });

  it('multi-copy roll: html repeated N times with page-break separators', () => {
    const html = service.render({
      html: '<article>copy me</article>',
      paper: { width_mm: 80, is_roll: true, height_mm: null },
      copies: 3,
    });
    // Three copies of the body
    expect(html.match(/<article>copy me<\/article>/g)).toHaveLength(3);
    // Two page-break separators between them
    const separators = html.match(/page-break-after: always/g);
    expect(separators).not.toBeNull();
    expect(separators!.length).toBe(2);
  });

  it('multi-copy SHEET (not roll) → does NOT split with page breaks (CSS pagination handles it)', () => {
    const html = service.render({
      html: '<section>one sheet</section>',
      paper: { width_mm: 210, is_roll: false, height_mm: 297 },
      copies: 4,
    });
    // Sheet copies are emitted once (the print engine paginates); the
    // renderer must NOT inject page-break divs into a sheet flow.
    expect(html.match(/<section>one sheet<\/section>/g)).toHaveLength(1);
    expect(html).not.toContain('page-break-after: always');
  });
});
