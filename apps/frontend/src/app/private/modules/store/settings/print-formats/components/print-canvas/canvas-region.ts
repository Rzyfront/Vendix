import {
  CanvasRegion,
  PrintColumnDefinition,
  PrintFormatDefinition,
  PrintSectionDefinition,
} from '../../../../../../../core/models/print-formats.model';

/**
 * [print-editor-dsk P4.2] Region model for the WYSIWYG canvas.
 *
 * A CanvasRegion is a positioned, sized entity on the printed page
 * that the user can drag, resize, or delete. Sections, columns, logos,
 * and company-block fields all map to regions. Coordinates are in mm,
 * origin top-left.
 */
export type { CanvasRegion, CanvasRegionKind } from '../../../../../../../core/models/print-formats.model';

const SECTION_HEIGHT_MM = 30; // placeholder for default section height

/**
 * Translate a PrintFormatDefinition into CanvasRegions for the canvas.
 * Layout strategy: simple top-to-bottom stacking of sections.
 * Column regions are children of their parent `items_table` section.
 *
 * This is intentionally simple for the foundation phase. The canvas
 * itself will let the user drag regions anywhere; this function just
 * provides the initial layout.
 */
export function definitionToRegions(
  definition: PrintFormatDefinition,
): CanvasRegion[] {
  const regions: CanvasRegion[] = [];
  let cursorY = 0;

  if (definition.logo) {
    regions.push({
      id: 'logo',
      kind: 'logo',
      anchorId: 'logo',
      label: 'Logo de la Tienda',
      x_mm: 0,
      y_mm: 0,
      width_mm: definition.logo.size_mm ?? 15,
      height_mm: definition.logo.size_mm ?? 15,
      zIndex: 3,
    });
  }

  if (definition.company_block?.fields) {
    for (const f of definition.company_block.fields) {
      if (!f.enabled) continue;
      regions.push({
        id: `comp-${f.key}`,
        kind: 'company-field',
        anchorId: f.key,
        label: f.custom_label || f.key,
        x_mm: 0,
        y_mm: cursorY,
        width_mm: 0,
        height_mm: 8,
        zIndex: 2,
      });
    }
  }

  const sections: PrintSectionDefinition[] = definition.sections ?? [];
  for (const sec of sections) {
    const secRegion: CanvasRegion = {
      id: `sec-${sec.id}`,
      kind: 'section',
      anchorId: sec.id,
      label: sec.title,
      x_mm: 0,
      y_mm: cursorY,
      width_mm: 0, // computed at render time
      height_mm: SECTION_HEIGHT_MM,
      zIndex: 1,
    };
    regions.push(secRegion);

    if (sec.fields && sec.fields.length > 0) {
      for (const f of sec.fields) {
        if (!f.enabled) continue;
        regions.push({
          id: `field-${f.id || f.key}`,
          kind: 'field',
          anchorId: f.id || f.key,
          label: f.custom_label || f.label || f.key,
          x_mm: 0,
          y_mm: cursorY,
          width_mm: 0,
          height_mm: 6,
          zIndex: 2,
          parentId: `sec-${sec.id}`,
        });
      }
    }

    if (sec.type === 'items_table' && definition.columns) {
      let colCursorX = 0;
      const totalWidthPct = definition.columns.reduce(
        (sum, c) => sum + (c.enabled === false ? 0 : c.width_percent ?? 0),
        0,
      );
      for (const col of definition.columns) {
        if (col.enabled === false) continue;
        const colWidthMm =
          totalWidthPct > 0
            ? ((col.width_percent ?? 0) / totalWidthPct) * 100
            : 100 / definition.columns.length;
        regions.push({
          id: `col-${col.id}`,
          kind: 'column',
          anchorId: col.id,
          label: col.label ?? col.key ?? '',
          x_mm: colCursorX,
          y_mm: cursorY,
          width_mm: colWidthMm,
          height_mm: SECTION_HEIGHT_MM,
          zIndex: 2,
          parentId: `sec-${sec.id}`,
        });
        colCursorX += colWidthMm;
      }
    }
    cursorY += SECTION_HEIGHT_MM;
  }
  return regions;
}

/**
 * Compute the delta to apply to PrintFormatDefinition from changed regions.
 * For Phase 4.2 foundation, only column `width_percent` is updated from
 * column-region resize. Section position is NOT persisted in this phase
 * (section positions on the canvas are visual only — section.order stays
 * the source of truth for layout in the composer).
 */
export function regionsToDelta(
  regions: CanvasRegion[],
  before: PrintFormatDefinition,
): Partial<PrintFormatDefinition> {
  const columnRegions = regions.filter((r) => r.kind === 'column');
  if (columnRegions.length === 0 || !before.columns) return {};

  // Sum total width_mm across column regions (from parent sec's width_mm proxy).
  // Use the first column's x_mm and width_mm as the reference.
  const totalColWidthMm = columnRegions.reduce((sum, r) => sum + r.width_mm, 0);
  if (totalColWidthMm === 0) return {};

  const newColumns: PrintColumnDefinition[] = before.columns.map((col) => {
    const region = columnRegions.find((r) => r.anchorId === col.id);
    if (!region) return col;
    return {
      ...col,
      width_percent: Math.round((region.width_mm / totalColWidthMm) * 100),
    };
  });

  // sum must equal 100; round-off drift: clamp last column.
  const sum = newColumns.reduce(
    (s, c) => s + (c.enabled === false ? 0 : c.width_percent ?? 0),
    0,
  );
  if (sum !== 100 && newColumns.length > 0) {
    const last = newColumns[newColumns.length - 1];
    newColumns[newColumns.length - 1] = {
      ...last,
      width_percent: (last.width_percent ?? 0) + (100 - sum),
    };
  }

  return { columns: newColumns };
}