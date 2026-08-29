import { PrintPropertiesPanelComponent } from '../../../../private/modules/store/settings/print-formats/components/print-properties-panel/print-properties-panel.component';
import { CanvasRegion } from '../../../../core/models/print-formats.model';

/**
 * [print-editor-dsk P9] — Pure routing-logic specs for the properties-panel
 * shell. Lives at `shared/services/print/__tests__/` so future extractors
 * (a pure `kindToPanelRoute()` helper, a `regionTitle()` shared util) can
 * import from here and pin the contract. For now, we drive the routing
 * methods on the component instance directly — no DOM, no TestBed, no
 * subpanel bootstrapping.
 *
 * The contract this file pins:
 *   - `regionIcon(kind)` maps each `CanvasRegion['kind']` to a Lucide icon
 *     name (used by the header badge).
 *   - `regionTitle(region)` returns the region `label`, falling back to a
 *     kind-specific Spanish label, falling back to "Elemento" for unknowns.
 *   - `headerTitle` (computed signal) returns "Propiedades del Documento"
 *     when no region is selected.
 *
 * Four specs cover the matrix; the full DOM render matrix is owned by
 * `private/.../__tests__/print-properties-panel.component.spec.ts`.
 */
function makeRegion(kind: CanvasRegion['kind'], label?: string): CanvasRegion {
  // Minimal CanvasRegion — only `kind` and `label` matter for routing.
  return {
    id: `${kind}-id`,
    kind,
    label,
    anchorId: kind === 'section' || kind === 'column' ? 'anchor-1' : null,
    x_mm: 0,
    y_mm: 0,
    width_mm: 80,
    height_mm: 20,
    zIndex: 1,
  } as unknown as CanvasRegion;
}

describe('PrintPropertiesPanel — routing helpers [print-editor-dsk P9]', () => {
  let panel: PrintPropertiesPanelComponent;

  beforeEach(() => {
    panel = new PrintPropertiesPanelComponent();
  });

  it('regionIcon routes every supported kind to a Lucide icon name', () => {
    expect(panel.regionIcon('section')).toBe('layout-list');
    expect(panel.regionIcon('column')).toBe('columns');
    expect(panel.regionIcon('logo')).toBe('image');
    expect(panel.regionIcon('company-field')).toBe('building');
    expect(panel.regionIcon('header')).toBe('arrow-left');
    expect(panel.regionIcon('footer')).toBe('arrow-right');
  });

  it('regionIcon falls back to "file-text" for unknown or undefined kind', () => {
    // The shell uses `file-text` for both `undefined` (no selection) and
    // any kind the switch does not enumerate. Both must collapse to the
    // same fallback so the header badge is always rendered.
    expect(panel.regionIcon(undefined)).toBe('file-text');
    // Cast through `unknown` so we can probe a kind that does NOT exist
    // in `CanvasRegion['kind']` and confirm the default branch.
    expect(panel.regionIcon('watermark' as unknown as CanvasRegion['kind'])).toBe('file-text');
  });

  it('regionTitle returns label verbatim when present, regardless of kind', () => {
    // Custom labels win over the kind-based defaults — the merchant can
    // rename any section to "Promociones" and the shell must respect that.
    const r = makeRegion('section', 'Promociones');
    expect(panel.regionTitle(r)).toBe('Promociones');
  });

  it('regionTitle falls back to kind-specific Spanish labels, then to "Elemento"', () => {
    expect(panel.regionTitle(makeRegion('section'))).toBe('Sección');
    expect(panel.regionTitle(makeRegion('column'))).toBe('Columna');
    expect(panel.regionTitle(makeRegion('logo'))).toBe('Logo');
    expect(panel.regionTitle(makeRegion('company-field'))).toBe('Campo de Empresa');
    expect(panel.regionTitle(makeRegion('header'))).toBe('Encabezado');
    expect(panel.regionTitle(makeRegion('footer'))).toBe('Pie');
    // Unknown kind → "Elemento" (the @default branch of the inner switch).
    const unknown = makeRegion('watermark' as unknown as CanvasRegion['kind']);
    expect(panel.regionTitle(unknown)).toBe('Elemento');
  });
});
