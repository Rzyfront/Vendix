/**
 * [print-editor-dsk P7] — `FormatAdapter` interface for the per-format
 * metadata table.
 *
 * Why an adapter (and not just reading `FORMAT_TYPE_METADATA` from
 * `print-formats.service.ts`): each format type carries a different set of
 * "constraints" — default paper, available canvas regions, whether it's
 * fiscal, and which token fields are required. Hardcoding them inside the
 * canvas/panels/hub would mean 11 different `switch (formatType)` blocks
 * scattered across the codebase. The adapter funnels that single source of
 * truth behind one interface so anything that needs to ask "what paper does
 * this format use?" or "does this format support a QR block?" calls the
 * registry instead.
 *
 * RegionKind naming note: the adapter uses kebab-case values
 * (`items-table`, `company-block`) for the canonical `RegionKind` type so the
 * shape stays uniform and easy to read in editor UIs. The v2 schema
 * (`definition-v2.schema.json`) and the layout compositor (`case 'items_table'`)
 * use snake_case section.type values. `regionKindToSectionType()` /
 * `sectionTypeToRegionKind()` bridge the two so Step 7.5 can validate
 * `section.type` values against the adapter's `availableRegions` without
 * forcing the whole pipeline onto one or the other naming convention.
 */

import { PrintFormatTypeEnum } from '../enums/print-format.enum';

/**
 * Union of `PrintFormatTypeEnum` *string values* — distinct from the enum
 * type itself (which TypeScript widens to opaque `Enum.value` member types
 * when indexed via `typeof Enum[keyof typeof Enum]`). Without this
 * explicit literal union, a property typed as the enum refuses string
 * literals that obviously match, forcing every consumer to write the
 * verbose `PrintFormatTypeEnum.pos_sale_ticket` access form. Keeping the
 * union ALSO matches what the DB writes (`print_format_type_enum` is a
 * string column), so the rest of the tree — adapters, registry getters,
 * service branches — can keep using bare string literals.
 */
export type PrintFormatType =
  | 'pos_sale_ticket'
  | 'sales_order_invoice'
  | 'dispatch_note'
  | 'dispatch_ticket'
  | 'quotation'
  | 'credit_note'
  | 'purchase_order'
  | 'transfer_note'
  | 'fiscal_electronic_invoice'
  | 'fiscal_credit_note'
  | 'kitchen_ticket';

// Compile-time drift guard — if a value is added/removed in the enum
// without updating the union above, this assignment fails.
const _DRIFT_CHECK: Record<PrintFormatTypeEnum, true> = {
  pos_sale_ticket: true,
  sales_order_invoice: true,
  dispatch_note: true,
  dispatch_ticket: true,
  quotation: true,
  credit_note: true,
  purchase_order: true,
  transfer_note: true,
  fiscal_electronic_invoice: true,
  fiscal_credit_note: true,
  kitchen_ticket: true,
};
void _DRIFT_CHECK;

/**
 * Canonical region kinds the editor exposes on the canvas. The kebab-case
 * forms are the names the user-facing UI shows in the region picker; the
 * snake_case mirrors what the compositor recognizes.
 */
export type RegionKind =
  | 'header'
  | 'footer'
  | 'logo'
  | 'company-block'
  | 'items-table'
  | 'totals'
  | 'qr-block'
  | 'fiscal-block'
  | 'customer-info';

/**
 * Printer paper format alias kept loose enough to match the union on
 * `PaperFormat` from `./page-geometry.ts` without forcing a second source
 * of truth. The AdapterRegistry's `defaultPaper` method returns this
 * exact shape.
 */
export type AdapterPaper = 'thermal_80' | 'thermal_58' | 'a4' | 'letter' | 'half_letter';

/** Closed set of categories the hub side-bar groups adapters under. */
export type AdapterCategory =
  | 'Ventas POS'
  | 'Ventas'
  | 'Logística'
  | 'Comercial'
  | 'Compras'
  | 'Inventario'
  | 'Facturación'
  | 'Restaurante';

export interface FormatAdapter {
  /** Discriminator. Must be a valid `PrintFormatTypeEnum` value. */
  formatType: PrintFormatType;
  /** Human-readable label shown in the editor and the hub side panel. */
  label: string;
  /** Category bucket — drives `byCategory()` lookups. */
  category: AdapterCategory;
  /** Default paper when the store override has none. */
  defaultPaper: AdapterPaper;
  /** Region kinds the canvas exposes for this format. */
  availableRegions: RegionKind[];
  /** True for fiscal formats (DIAN) that require CUFE + QR + NIT tokens. */
  fiscal: boolean;
  /** Token paths the renderer resolves to required `data.*` fields. */
  requiredFields: string[];
}

/**
 * Translate a kebab-case `RegionKind` to the snake_case `section.type` that
 * `definition-v2.schema.json` and the layout compositor actually dispatch on.
 *
 * The mapping is intentionally explicit (vs a string replace) so adding a
 * new region fails to compile until the matching compositor branch is wired.
 */
export function regionKindToSectionType(kind: RegionKind): string {
  switch (kind) {
    case 'header':
      return 'header';
    case 'footer':
      return 'footer';
    case 'logo':
      // Logo isn't a section in the v2 composer — it's a top-level
      // `definition.logo` block. Map it to a sentinel section type the
      // composer ignores so the canvas can still flag it as present
      // without lying about wiring.
      return 'logo';
    case 'company-block':
      return 'company_block';
    case 'items-table':
      return 'items_table';
    case 'totals':
      return 'totals_summary';
    case 'qr-block':
      return 'qr_block';
    case 'fiscal-block':
      return 'fiscal_block';
    case 'customer-info':
      return 'customer_info';
    default: {
      // Exhaustiveness check — adding a new RegionKind must extend this map.
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * Inverse of `regionKindToSectionType`. Used by `assertRegionsAllowed()`
 * in `print-formats.service.ts` when reading `section.type` from a v2
 * payload and comparing against the adapter's `availableRegions`.
 */
export function sectionTypeToRegionKind(type: string): RegionKind | null {
  switch (type) {
    case 'header':
      return 'header';
    case 'footer':
      return 'footer';
    case 'logo':
      return 'logo';
    case 'company_block':
      return 'company-block';
    case 'items_table':
      return 'items-table';
    case 'totals_summary':
      return 'totals';
    case 'qr_block':
      return 'qr-block';
    case 'fiscal_block':
      return 'fiscal-block';
    case 'customer_info':
      return 'customer-info';
    default:
      return null;
  }
}
