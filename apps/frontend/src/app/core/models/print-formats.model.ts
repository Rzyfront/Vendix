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
  | 'kitchen_ticket'
  | 'dispatch_route'
  | 'withholding_practiced'
  | 'withholding_suffered'
  | 'withholding_employee_certificate';

export type PrintPaperFormat =
  | 'thermal_80'
  | 'thermal_58'
  | 'a4'
  | 'letter'
  | 'half_letter'
  | 'custom';

export interface PrintPaperConfig {
  format: PrintPaperFormat;
  width_mm: number;
  /**
   * [print-editor-dsk P1.2] — v2 NEW. Alto físico en mm. Requerido cuando
   * `format === 'custom'` (validado por el AJV del backend).
   */
  height_mm?: number;
  is_roll: boolean;
  /**
   * Margen uniforme. El composer v2 prefiere los márgenes por lado
   * (`margin_top_mm`, etc.) cuando están presentes; si faltan, aplica
   * `margin_mm` uniformemente. Sigue siendo un campo real y requerido por
   * las plantillas de sistema — no es un alias legacy de los márgenes por
   * lado.
   */
  margin_mm?: number;
  /** [print-editor-dsk P1.2] — v2 NEW. Margen superior en mm. */
  margin_top_mm?: number;
  /** [print-editor-dsk P1.2] — v2 NEW. Margen derecho en mm. */
  margin_right_mm?: number;
  /** [print-editor-dsk P1.2] — v2 NEW. Margen inferior en mm. */
  margin_bottom_mm?: number;
  /** [print-editor-dsk P1.2] — v2 NEW. Margen izquierdo en mm. */
  margin_left_mm?: number;
  copies: number;
  /** [print-editor-dsk P1.2] — v2 NEW. */
  orientation?: 'portrait' | 'landscape';
}

/**
 * [print-editor-dsk P1.2] — v2 NEW. Logo opcional del header.
 * `url` viene firmado on-read por el backend (S3 key firmado por el controller).
 */
export interface PrintLogoBlock {
  url?: string;
  position?: 'left' | 'center' | 'right' | 'full';
  /** [print-editor-dsk P1.2] — v2 NEW. */
  size_mm?: number;
  opacity?: number;
}

/** [print-editor-dsk P1.2] — v2 NEW. Tipos permitidos de campos del bloque de empresa. */
export type PrintCompanyFieldKey =
  | 'NIT'
  | 'DV'
  | 'regimen'
  | 'address'
  | 'phone'
  | 'email'
  | 'website';

/**
 * [print-editor-dsk P1.2] — v2 NEW. Campo individual del bloque de empresa.
 * El renderer emite una línea por cada `field` en `PrintCompanyBlock.fields`
 * en el orden declarado.
 */
export interface PrintCompanyField {
  key: PrintCompanyFieldKey;
  enabled: boolean;
  /** [print-editor-dsk P1.2] — v2 NEW. */
  custom_label?: string;
  format?: 'text' | 'number' | 'currency' | 'date' | 'percent';
}

/** [print-editor-dsk P1.2] — v2 NEW. Bloque de información de la empresa. */
export interface PrintCompanyBlock {
  fields: PrintCompanyField[];
}

/** [print-editor-dsk P1.2] — v2 NEW. Discriminador de versión de schema. */
export type PrintFormatVersion = 1 | 2;

export interface PrintFieldDefinition {
  id: string;
  key: string;
  label: string;
  enabled: boolean;
  position?: 'left' | 'center' | 'right' | 'full';
  custom_label?: string;
  format?: 'text' | 'number' | 'currency' | 'date' | 'percent';
}

export interface PrintSectionDefinition {
  id: string;
  type: string;
  title: string;
  enabled: boolean;
  order: number;
  fields?: PrintFieldDefinition[];
  custom_content?: string;
  /**
   * Detalles por linea de `items_table` / `kitchen_items`. Los consume
   * `PrintLayoutComposerService.renderItemsTableSection` con la semantica
   * `!== false`: ausente = visible. Por eso son opcionales y solo se
   * persisten cuando el usuario apaga el detalle desde el editor de columnas.
   */
  show_sku?: boolean;
  show_variant_attributes?: boolean;
  show_notes?: boolean;
  show_item_discounts?: boolean;
  show_item_taxes?: boolean;
}

export interface PrintColumnDefinition {
  id: string;
  key: string;
  label: string;
  enabled: boolean;
  width_percent: number;
  align: 'left' | 'center' | 'right';
  format?: 'text' | 'number' | 'currency' | 'percent' | 'date';
}

export interface PrintStylesDefinition {
  font_family?: string;
  font_size_base_pt?: number;
  primary_color?: string;
  header_alignment?: 'left' | 'center' | 'right';
  show_borders?: boolean;
  compact_mode?: boolean;
  theme_tokens?: Record<string, string>;
}

export interface PrintTokenDefinition {
  token: string;
  path: string;
  description: string;
  example: string;
}

/**
 * [print-editor-dsk P1.2] — Shape v2 de `PrintFormatDefinition` (mirror TS del
 * `apps/backend/.../interfaces/print-format.interface.ts`).
 *
 * Dialecto único: TODOS los campos, v1 y v2, usan `snake_case` — el mismo
 * que el compositor del backend lee de forma incondicional
 * (`PrintLayoutComposerService`). No existe una variante camelCase válida
 * para persistir; el backend normaliza alias legacy solo en lectura, nunca
 * en escritura. Stores con overrides v1 (sin `v`) siguen funcionando: el
 * servicio las enruta a la ruta legacy sin AJV.
 */
export interface PrintFormatDefinition {
  /** [print-editor-dsk P1.2] — v2 NEW. Discriminador (1 = legacy, 2 = schema enforced). */
  v?: PrintFormatVersion;
  paper: PrintPaperConfig;
  /** [print-editor-dsk P1.2] — v2 NEW. */
  logo?: PrintLogoBlock;
  /** [print-editor-dsk P1.2] — v2 NEW. */
  company_block?: PrintCompanyBlock;
  sections: PrintSectionDefinition[];
  columns?: PrintColumnDefinition[];
  styles?: PrintStylesDefinition;
  tokens?: PrintTokenDefinition[];
  custom_template?: string;
}

export interface StorePrintFormatSummary {
  format_type: PrintFormatType;
  name: string;
  category: string;
  icon: string;
  engine: 'html' | 'pdf';
  is_configured: boolean;
  is_active: boolean;
  gateway_enabled: boolean;
  template_name: string;
  updated_at: string | null;
}

export interface StorePrintFormatDetail {
  format_type: PrintFormatType;
  name: string;
  category: string;
  is_active: boolean;
  gateway_enabled: boolean;
  is_customized: boolean;
  template_id: number | null;
  template_name: string | null;
  definition: PrintFormatDefinition;
  overrides: Record<string, any> | null;
  available_tokens: PrintTokenDefinition[];
}

export interface PrintTemplate {
  id: number;
  organization_id?: number | null;
  created_by?: number | null;
  format_type: PrintFormatType;
  name: string;
  description?: string | null;
  definition: PrintFormatDefinition;
  is_system: boolean;
  is_shared: boolean;
  created_at: string;
  updated_at: string;
  author?: {
    id: number;
    first_name?: string;
    last_name?: string;
    email: string;
  };
}

export interface PrintPreviewResponse {
  html: string;
  width_mm: number;
  is_roll: boolean;
  definition: PrintFormatDefinition;
}

export interface RenderPrintDocumentResponse {
  format_type: PrintFormatType;
  html?: string;
  copies: number;
  is_roll: boolean;
  width_mm: number;
}

/**
 * [print-editor-dsk P3.3] — Lightweight record returned by
 * `GET /store/print-formats/:formatType/documents` for the sample picker.
 * Intentionally minimal (id + a few human-readable fields) so the picker can
 * list up to 20 documents without dragging every line item into the editor.
 */
export interface PrintRecentDocument {
  id: number;
  number?: string | null;
  date?: string | null;
  total?: number | null;
  customer_name?: string | null;
  status?: string | null;
}

/**
 * [print-editor-dsk P4.1] — CanvasRegion contract for the WYSIWYG canvas
 * editor. Frontend-only — the backend never sees CanvasRegion: the editor
 * derives these from `PrintFormatDefinition` and writes back column width
 * deltas through `regionsToDelta`. Coordinates are in millimeters with
 * origin at top-left of the paper; the consumer maps mm→px at render time.
 */
export type CanvasRegionKind =
  | 'section'
  | 'column'
  | 'logo'
  | 'company-field'
  | 'field'
  | 'header'
  | 'footer';

export interface CanvasRegion {
  /** Unique within the editor session (e.g. `sec-${secId}`, `col-${colId}`). */
  id: string;
  kind: CanvasRegionKind;
  /** Stable identifier of the underlying entity in PrintFormatDefinition. */
  anchorId: string;
  label: string;
  /** Position in mm from top-left of the paper. */
  x_mm: number;
  y_mm: number;
  width_mm: number;
  height_mm: number;
  zIndex: number;
  /** Optional anchor for sorting (column regions point at their parent section). */
  parentId?: string;
}

export type PrintPreviewMode = 'dummy' | 'tokenized' | 'real';

export interface PrintSelectedElement {
  elementId?: string | null;
  sectionId?: string | null;
  token?: string | null;
  columnId?: string | null;
}

export type PrintAnnexCategory =
  | 'emisor'
  | 'documento'
  | 'adquirente'
  | 'lineas'
  | 'impuestos'
  | 'fiscal_dian';

export interface PrintAnnexValidationRule {
  id: string;
  category: PrintAnnexCategory;
  name: string;
  description: string;
  reference: string;
  severity: 'error' | 'warning' | 'info';
  passed: boolean;
  fixAction?: {
    label: string;
    sectionId?: string;
    fieldKey?: string;
    columnKey?: string;
    /**
     * Targets `definition.company_block.fields` directly instead of a
     * `section.fields` entry. Rules gated on emisor data that actually
     * lives in the company block (NIT, régimen, dirección) must set this
     * — `fieldKey` alone only reaches section fields.
     */
    companyFieldKey?: PrintCompanyFieldKey;
  };
}

export interface PrintAnnexValidationSummary {
  score: number;
  totalRules: number;
  passedCount: number;
  errorCount: number;
  warningCount: number;
  isCompliant: boolean;
  rules: PrintAnnexValidationRule[];
}