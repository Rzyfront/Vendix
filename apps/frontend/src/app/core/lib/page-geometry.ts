/**
 * [print-editor-dsk P1.6] Local shim that re-exports the canonical paper
 * geometry as `PRINT_PAGE_GEOMETRY` for the frontend web app.
 *
 * The canonical source of truth is
 * `libs/print-formats/schemas/page-geometry.json` (a STATIC JSON file, NOT a
 * workspace package). `scripts/sync-print-geometry.ts` copies it byte-for-byte
 * into `./page-geometry.json` next to this file at build time. We never
 * `@vendix/print-formats` import — this app reads its own LOCAL copy.
 *
 * Why the alias `PRINT_PAGE_GEOMETRY`: the rest of the frontend
 * (`document-print.service.ts`, `print-formats-settings-form.component.ts`,
 * `print-format-chip.component.ts`) already imports the constant under that
 * name. We re-export the same shape (with `page_size` instead of the canonical
 * `css_page_size`) so nothing else in the app has to change.
 */

import pageGeometryJson from './geometry-data';

const raw: Record<string, PaperGeometry> = pageGeometryJson as Record<string, PaperGeometry>;

/** Wire shape of the canonical JSON. */
export interface PaperGeometry {
  width_mm: number;
  is_roll: boolean;
  css_page_size: string;
  /** Mobile-only: page height in millimetres. `null` means continuous roll. */
  height_mm: number | null;
}

/** Closed set of paper formats — matches PRINT_FORMATS in store-settings. */
export type PaperFormat =
  | 'thermal_80'
  | 'thermal_58'
  | 'a4'
  | 'letter'
  | 'half_letter';

const CANONICAL: Readonly<Record<PaperFormat, PaperGeometry>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(raw)
        .filter(([k]) => k !== '_about')
        .map(([k, v]) => [k, v as PaperGeometry]),
    ) as Record<PaperFormat, PaperGeometry>,
  );

/** Canonical shape — exported as `PAPER_GEOMETRY` for new code paths. */
export const PAPER_GEOMETRY: Readonly<Record<PaperFormat, PaperGeometry>> =
  CANONICAL;

/**
 * Legacy shape — `page_size` (CSS `@page` rule) instead of `css_page_size`.
 * Re-exported under both names so the rest of the codebase keeps working
 * without renaming imports.
 */
export interface PrintPageGeometry {
  page_size: string;
  width_mm: number;
  is_roll: boolean;
}

export const PRINT_PAGE_GEOMETRY: Readonly<
  Record<PaperFormat, PrintPageGeometry>
> = Object.freeze(
  Object.fromEntries(
    Object.entries(CANONICAL).map(([k, v]) => [
      k,
      { page_size: v.css_page_size, width_mm: v.width_mm, is_roll: v.is_roll },
    ]),
  ) as Record<PaperFormat, PrintPageGeometry>,
);

/** Lookup with a clear error message instead of an undefined catch-all. */
export function getPaperGeometry(format: PaperFormat): PaperGeometry {
  const g = CANONICAL[format];
  if (!g) {
    throw new Error(`[page-geometry] Unknown paper format: ${format}`);
  }
  return g;
}
