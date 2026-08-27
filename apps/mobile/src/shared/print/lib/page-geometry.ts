/**
 * [print-editor-dsk P1.6] Local shim that re-exports the canonical paper
 * geometry as `PRINT_PAGE_GEOMETRY` for the mobile app (Expo / React Native).
 *
 * The canonical source of truth is
 * `libs/print-formats/schemas/page-geometry.json` (a STATIC JSON file, NOT a
 * workspace package). `scripts/sync-print-geometry.ts` copies it byte-for-byte
 * into `./page-geometry.json` next to this file at build time. We never
 * `@vendix/print-formats` import — this app reads its own LOCAL copy.
 *
 * Why the alias `PRINT_PAGE_GEOMETRY`: the rest of the mobile app
 * (`document-print.service.ts`, the layout composer) already imports the
 * constant under that name. We re-export the same shape so nothing else in
 * the app has to change.
 *
 * Mobile is the only app that consumes `height_mm` (expo-print takes the
 * page box in POINTS rather than reading `@page`, so the millimetres have to
 * be handed over explicitly). The canonical JSON carries `height_mm: null`
 * for rolls and the right integer for sheet formats.
 */

import pageGeometryJson from './geometry-data';

const raw: Record<string, PaperGeometry> = pageGeometryJson as Record<string, PaperGeometry>;

/** Wire shape of the canonical JSON. */
export interface PaperGeometry {
  width_mm: number;
  is_roll: boolean;
  css_page_size: string;
  /** Page height in millimetres. `null` means continuous roll. */
  height_mm: number | null;
}

/** Closed set of paper formats — matches PRINT_FORMATS in print-formats.ts. */
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
 * Mobile additionally exposes `height_mm` which is required by expo-print.
 * Re-exported under both names so the rest of the codebase keeps working
 * without renaming imports.
 */
export interface PrintPageGeometry {
  page_size: string;
  width_mm: number;
  height_mm: number | null;
  is_roll: boolean;
}

export const PRINT_PAGE_GEOMETRY: Readonly<
  Record<PaperFormat, PrintPageGeometry>
> = Object.freeze(
  Object.fromEntries(
    Object.entries(CANONICAL).map(([k, v]) => [
      k,
      {
        page_size: v.css_page_size,
        width_mm: v.width_mm,
        height_mm: v.height_mm,
        is_roll: v.is_roll,
      },
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
