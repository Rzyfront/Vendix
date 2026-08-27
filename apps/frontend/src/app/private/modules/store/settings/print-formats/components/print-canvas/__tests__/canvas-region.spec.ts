import { PrintFormatDefinition } from '../../../../../../../../core/models/print-formats.model';
import { definitionToRegions, regionsToDelta } from '../canvas-region';

/**
 * [print-editor-dsk P4.2] — CanvasRegion model contract.
 *
 * Locks the foundation behavior the WYSIWYG canvas relies on:
 *  - empty inputs yield empty outputs
 *  - sections stack top-to-bottom
 *  - column regions are sized proportionally to `width_percent`
 *  - regionsToDelta only writes columns, sum stays 100
 *  - regionsToDelta is a no-op when no column region moved
 */
describe('canvas-region — definitionToRegions / regionsToDelta (P4.2)', () => {
  it('definitionToRegions: empty definition ⇒ empty array', () => {
    const def: PrintFormatDefinition = {
      paper: { format: 'a4', width_mm: 210, is_roll: false, copies: 1 },
      sections: [],
    };

    const regions = definitionToRegions(def);

    expect(regions).toEqual([]);
  });

  it('definitionToRegions: 3 sections, no columns ⇒ 3 regions stacked, x_mm=0', () => {
    const def: PrintFormatDefinition = {
      paper: { format: 'a4', width_mm: 210, is_roll: false, copies: 1 },
      sections: [
        { id: 's1', type: 'header', title: 'Cabecera', enabled: true, order: 0 },
        { id: 's2', type: 'body', title: 'Cuerpo', enabled: true, order: 1 },
        { id: 's3', type: 'footer', title: 'Pie', enabled: true, order: 2 },
      ],
    };

    const regions = definitionToRegions(def);

    expect(regions.length).toBe(3);
    expect(regions[0].id).toBe('sec-s1');
    expect(regions[0].y_mm).toBe(0);
    expect(regions[1].y_mm).toBe(30);
    expect(regions[2].y_mm).toBe(60);
    regions.forEach((r) => {
      expect(r.kind).toBe('section');
      expect(r.x_mm).toBe(0);
    });
  });

  it('definitionToRegions: items_table section + 3 enabled columns ⇒ 3 column children with widths proportional to width_percent', () => {
    const def: PrintFormatDefinition = {
      paper: { format: 'thermal_80', width_mm: 80, is_roll: true, copies: 1 },
      sections: [
        { id: 'tbl', type: 'items_table', title: 'Items', enabled: true, order: 0 },
      ],
      columns: [
        { id: 'c1', key: 'name', label: 'Producto', enabled: true, width_percent: 50, align: 'left' },
        { id: 'c2', key: 'qty', label: 'Cant', enabled: true, width_percent: 25, align: 'right' },
        { id: 'c3', key: 'price', label: 'Precio', enabled: true, width_percent: 25, align: 'right' },
      ],
    };

    const regions = definitionToRegions(def);

    // 1 section + 3 column regions
    expect(regions.length).toBe(4);
    const cols = regions.filter((r) => r.kind === 'column');
    expect(cols.length).toBe(3);
    // column widths sum to 100 (the function scales width_percent to mm units)
    const totalWidth = cols.reduce((s, c) => s + c.width_mm, 0);
    expect(Math.round(totalWidth)).toBe(100);
    // proportional: c1 should be ~50, c2 and c3 each ~25 (within rounding)
    const c1 = cols.find((c) => c.anchorId === 'c1')!;
    const c2 = cols.find((c) => c.anchorId === 'c2')!;
    const c3 = cols.find((c) => c.anchorId === 'c3')!;
    expect(c1.width_mm).toBeGreaterThan(c2.width_mm);
    expect(c1.width_mm).toBeGreaterThan(c3.width_mm);
    // children point at their parent
    cols.forEach((c) => expect(c.parentId).toBe('sec-tbl'));
  });

  it('regionsToDelta: resized columns ⇒ new width_percent summing to 100', () => {
    const before: PrintFormatDefinition = {
      paper: { format: 'a4', width_mm: 210, is_roll: false, copies: 1 },
      sections: [
        { id: 'tbl', type: 'items_table', title: 'Items', enabled: true, order: 0 },
      ],
      columns: [
        { id: 'c1', key: 'name', label: 'Producto', enabled: true, width_percent: 40, align: 'left' },
        { id: 'c2', key: 'qty', label: 'Cant', enabled: true, width_percent: 30, align: 'right' },
        { id: 'c3', key: 'price', label: 'Precio', enabled: true, width_percent: 30, align: 'right' },
      ],
    };

    // user resized c1 to 60mm, c2 to 25mm, c3 to 15mm (total = 100mm)
    const resizedRegions = [
      { id: 'col-c1', kind: 'column' as const, anchorId: 'c1', label: 'Producto', x_mm: 0, y_mm: 0, width_mm: 60, height_mm: 30, zIndex: 2 },
      { id: 'col-c2', kind: 'column' as const, anchorId: 'c2', label: 'Cant', x_mm: 60, y_mm: 0, width_mm: 25, height_mm: 30, zIndex: 2 },
      { id: 'col-c3', kind: 'column' as const, anchorId: 'c3', label: 'Precio', x_mm: 85, y_mm: 0, width_mm: 15, height_mm: 30, zIndex: 2 },
    ];

    const delta = regionsToDelta(resizedRegions, before);

    expect(delta.columns).toBeDefined();
    const sum = delta.columns!.reduce(
      (s, c) => s + (c.enabled === false ? 0 : c.width_percent ?? 0),
      0,
    );
    expect(sum).toBe(100);
    // proportional mapping: c1 = 60, c2 = 25, c3 = 15
    expect(delta.columns!.find((c) => c.id === 'c1')!.width_percent).toBe(60);
    expect(delta.columns!.find((c) => c.id === 'c2')!.width_percent).toBe(25);
    expect(delta.columns!.find((c) => c.id === 'c3')!.width_percent).toBe(15);
  });

  it('regionsToDelta: no column regions in input ⇒ returns {}', () => {
    const before: PrintFormatDefinition = {
      paper: { format: 'a4', width_mm: 210, is_roll: false, copies: 1 },
      sections: [
        { id: 's1', type: 'header', title: 'Cabecera', enabled: true, order: 0 },
      ],
      columns: [
        { id: 'c1', key: 'name', label: 'Producto', enabled: true, width_percent: 100, align: 'left' },
      ],
    };

    const onlySectionRegions = [
      { id: 'sec-s1', kind: 'section' as const, anchorId: 's1', label: 'Cabecera', x_mm: 0, y_mm: 0, width_mm: 100, height_mm: 30, zIndex: 1 },
    ];

    const delta = regionsToDelta(onlySectionRegions, before);

    expect(delta).toEqual({});
  });
});