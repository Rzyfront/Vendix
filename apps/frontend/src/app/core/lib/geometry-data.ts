/**
 * [print-editor-dsk P1.6] Canonical source of truth for paper geometry
 * across backend, frontend and mobile. NOT a workspace package — a plain
 * TypeScript module that `scripts/sync-print-geometry.ts` copies byte-for-byte
 * into each app's local `lib/` directory. NO `@vendix/*` import is used
 * anywhere — each app imports its LOCAL copy of this file.
 *
 * Why TS instead of JSON: the backend's build pipeline uses SWC, which
 * compiles .ts → .js but does NOT copy .json files to dist. A `require('./x.json')`
 * or `import x from './x.json'` therefore fails at runtime when Node can't
 * resolve the missing JSON file. Inlining the object as a TS export makes
 * the data survive any build pipeline.
 */

export default {
  thermal_80: {
    width_mm: 80,
    is_roll: true,
    css_page_size: '80mm auto',
    height_mm: null,
  },
  thermal_58: {
    width_mm: 58,
    is_roll: true,
    css_page_size: '58mm auto',
    height_mm: null,
  },
  a4: {
    width_mm: 210,
    is_roll: false,
    css_page_size: 'A4 portrait',
    height_mm: 297,
  },
  letter: {
    width_mm: 216,
    is_roll: false,
    css_page_size: 'letter portrait',
    height_mm: 279,
  },
  half_letter: {
    width_mm: 216,
    is_roll: false,
    css_page_size: '216mm 140mm',
    height_mm: 140,
  },
} as const;
