import { PrintFormatTypeEnum } from '../enums/print-format.enum';
export * from '../enums/print-format.enum';

export type PrintFormatType = keyof typeof PrintFormatTypeEnum;

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
   * `format === 'custom'` (validado por schema). Opcional para rollos
   * (alto continuo) y para hojas (se resuelve por `format`).
   */
  height_mm?: number;
  is_roll: boolean;
  /**
   * [print-editor-dsk P1.2] — DEPRECATED en v2 pero conservado como REQUERIDO
   * para no romper el composer actual (`print-layout-composer.service.ts`),
   * que asume `margin_mm` siempre presente. El runtime prefiere los márgenes
   * por lado (`margin_top_mm`, etc.) cuando están presentes; si faltan los
   * per-side, el composer aplica `margin_mm` uniformemente.
   */
  margin_mm: number;
  /** [print-editor-dsk P1.2] — v2 NEW. Margen superior en mm. */
  margin_top_mm?: number;
  /** [print-editor-dsk P1.2] — v2 NEW. Margen derecho en mm. */
  margin_right_mm?: number;
  /** [print-editor-dsk P1.2] — v2 NEW. Margen inferior en mm. */
  margin_bottom_mm?: number;
  /** [print-editor-dsk P1.2] — v2 NEW. Margen izquierdo en mm. */
  margin_left_mm?: number;
  copies: number;
  /** [print-editor-dsk P1.2] — v2 NEW. Orientación de hoja. */
  orientation?: 'portrait' | 'landscape';
}

/**
 * [print-editor-dsk P1.2] — v2 NEW. Logo opcional del header.
 *
 * `url` se firma on-read (controller) — la BD guarda el S3 key, el
 * renderer recibe la URL firmada de corta duración.
 */
export interface PrintLogoBlock {
  url?: string;
  position?: 'left' | 'center' | 'right' | 'full';
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
 *
 * El renderer emite una línea por cada `field` en `PrintCompanyBlock.fields`
 * en el orden declarado. `custom_label` sobreescribe la etiqueta por
 * defecto (`NIT:` → custom).
 */
export interface PrintCompanyField {
  key: PrintCompanyFieldKey;
  enabled: boolean;
  custom_label?: string;
  format?: 'text' | 'number' | 'currency' | 'date' | 'percent';
}

/**
 * [print-editor-dsk P1.2] — v2 NEW. Bloque de información de la empresa
 * (NIT, dirección, etc.) que aparece debajo del logo. Tipado para evitar
 * strings libres: el compositor dispatcha según `PrintCompanyField.key`.
 */
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
 * [print-editor-dsk P1.2] — Shape v2 de `PrintFormatDefinition`.
 *
 * Migración no breaking: los campos v1 (`paper` con `margin_mm`/`orientation?`,
 * `sections`, `columns`, `styles`, `tokens`, `custom_template`) conservan su
 * forma y orden. Los campos v2 (`v`, `paper.height_mm`, `paper.margin_*_mm`,
 * `logo`, `company_block`) son ADITIVOS.
 *
 * Stores con overrides v1 (sin `v`) siguen funcionando: el servicio las
 * detecta con `if (!('v' in overrides))` y las enruta a la ruta legacy
 * (fiscal validator sin AJV). Las stores que envían `v: 2` pasan por
 * `validatePrintFormatDefinition` (AJV).
 *
 * NO renombrar interfaces existentes — el composer (`print-layout-composer.service.ts`)
 * y los providers importan los nombres v1.
 */
export interface PrintFormatDefinition {
  /** [print-editor-dsk P1.2] — v2 NEW. Discriminador (1 = legacy, 2 = schema enforced). */
  v?: PrintFormatVersion;
  paper: PrintPaperConfig;
  /** [print-editor-dsk P1.2] — v2 NEW. Bloque de logo opcional. */
  logo?: PrintLogoBlock;
  /** [print-editor-dsk P1.2] — v2 NEW. Bloque de empresa opcional. */
  company_block?: PrintCompanyBlock;
  sections: PrintSectionDefinition[];
  columns?: PrintColumnDefinition[];
  styles?: PrintStylesDefinition;
  tokens?: PrintTokenDefinition[];
  custom_template?: string;
}