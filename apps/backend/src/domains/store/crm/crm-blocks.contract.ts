/**
 * Contrato del documento de bloques de la CRM Landing (QUI-719).
 *
 * Único artefacto compartido entre el generador IA (produce), el editor
 * (muta) y el render público (pinta). Cualquier cambio aquí es un cambio
 * de contrato: subir `CRM_LANDING_SCHEMA_VERSION` y mantener retro-
 * compatibilidad en el render para versiones anteriores.
 */

import { APP_PAGE_FONTS } from '../apps/shared/app-page.contract';

export const CRM_LANDING_SCHEMA_VERSION = 1;

export const CRM_BLOCK_TYPES = [
  'hero',
  'features',
  'products_grid',
  'store_gallery',
  'testimonials',
  'faq',
  'location_hours',
  'promo_banner',
  'about',
  'contact',
  'footer_cta',
] as const;

export type CrmBlockType = (typeof CRM_BLOCK_TYPES)[number];

export interface CrmBlock {
  /** Identificador único dentro del documento (slug corto). */
  id: string;
  type: CrmBlockType;
  /** Props libres por tipo; el render/editor define el shape por bloque. */
  props: Record<string, unknown>;
  /**
   * F6-A: the owner hid the section. It stays in the draft (the editor shows
   * it dimmed) but the public page never renders it. Absent = visible.
   */
  hidden?: boolean;
}

/** F6-A: same closed font catalog as the app pages (`page.theme`). */
export const CRM_LANDING_FONTS = APP_PAGE_FONTS;
export type CrmLandingFont = (typeof CRM_LANDING_FONTS)[number];

export interface CrmLandingTheme {
  primary_color?: string;
  secondary_color?: string;
  whatsapp_number?: string;
  whatsapp_message?: string;
  border_radius?: string;
  enable_whatsapp_float?: boolean;
  /** F6-A: optional typography and logo. Absent = the page looks as before. */
  font_heading?: CrmLandingFont;
  font_body?: CrmLandingFont;
  logo_url?: string;
}

/** F6-A: limits of the landing SEO, the usual snippet lengths. */
export const MAX_SEO_TITLE = 70;
export const MAX_SEO_DESCRIPTION = 160;
const MAX_URL = 1000;

/** F6-A: the owner's search and share metadata. Every field is optional. */
export interface CrmLandingSeo {
  title?: string;
  description?: string;
  image_url?: string;
}

export interface CrmLandingDocument {
  schema_version: typeof CRM_LANDING_SCHEMA_VERSION;
  theme?: CrmLandingTheme;
  seo?: CrmLandingSeo;
  blocks: CrmBlock[];
}

export interface CrmLandingValidationResult {
  valid: boolean;
  errors: string[];
}

const MAX_BLOCKS = 20;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHttpsUrl(value: string): boolean {
  if (value.length > MAX_URL || !value.startsWith('https://')) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** Optional text: absent, or a string no longer than `max`. */
function checkText(
  errors: string[],
  path: string,
  value: unknown,
  max: number,
): void {
  if (value === undefined) return;
  if (typeof value !== 'string') errors.push(`${path} debe ser texto.`);
  else if (value.length > max)
    errors.push(`${path} admite máximo ${max} caracteres.`);
}

/** Optional URL: absent, empty, or an absolute https URL. */
function checkUrl(errors: string[], path: string, value: unknown): void {
  if (value === undefined || value === '') return;
  if (typeof value !== 'string' || !isHttpsUrl(value.trim()))
    errors.push(`${path} debe ser una URL https.`);
}

/**
 * Valida que `value` cumpla el contrato v1. No lanza: devuelve errores
 * acumulados para que tanto el PUT del editor como la salida de la IA
 * puedan reportar qué bloques fallan sin exponer stack traces.
 */
export function validateCrmLandingDocument(
  value: unknown,
): CrmLandingValidationResult {
  const errors: string[] = [];

  if (!isPlainObject(value)) {
    return { valid: false, errors: ['El contenido debe ser un objeto JSON.'] };
  }

  if (value.schema_version !== CRM_LANDING_SCHEMA_VERSION) {
    errors.push(
      `schema_version debe ser ${CRM_LANDING_SCHEMA_VERSION}.`,
    );
  }

  if (!Array.isArray(value.blocks)) {
    errors.push('blocks debe ser un arreglo de secciones.');
    return { valid: false, errors };
  }

  if (value.blocks.length > MAX_BLOCKS) {
    errors.push(`Máximo ${MAX_BLOCKS} secciones por landing.`);
  }

  const seenIds = new Set<string>();
  value.blocks.forEach((block, index) => {
    const label = `blocks[${index}]`;
    if (!isPlainObject(block)) {
      errors.push(`${label}: cada sección debe ser un objeto.`);
      return;
    }
    if (typeof block.id !== 'string' || block.id.trim().length === 0) {
      errors.push(`${label}.id es obligatorio.`);
    } else if (seenIds.has(block.id)) {
      errors.push(`${label}.id duplicado: "${block.id}".`);
    } else {
      seenIds.add(block.id);
    }
    if (
      typeof block.type !== 'string' ||
      !CRM_BLOCK_TYPES.includes(block.type as CrmBlockType)
    ) {
      errors.push(
        `${label}.type inválido (${String(block.type)}). Permitidos: ${CRM_BLOCK_TYPES.join(', ')}.`,
      );
    }
    if (!isPlainObject(block.props)) {
      errors.push(`${label}.props debe ser un objeto.`);
    }
    if (block.hidden !== undefined && typeof block.hidden !== 'boolean') {
      errors.push(`${label}.hidden debe ser verdadero o falso.`);
    }
  });

  if (value.theme !== undefined && !isPlainObject(value.theme)) {
    errors.push('theme debe ser un objeto.');
  } else if (isPlainObject(value.theme)) {
    for (const key of ['primary_color', 'secondary_color'] as const) {
      const color = (value.theme as CrmLandingTheme)[key];
      if (color !== undefined && !HEX_COLOR_RE.test(String(color))) {
        errors.push(`theme.${key} debe ser un color hexadecimal #RRGGBB.`);
      }
    }
    const theme = value.theme as Record<string, unknown>;
    for (const key of ['font_heading', 'font_body'] as const) {
      const font = theme[key];
      if (
        font !== undefined &&
        !(CRM_LANDING_FONTS as readonly unknown[]).includes(font)
      ) {
        errors.push(
          `theme.${key} inválida. Permitidas: ${CRM_LANDING_FONTS.join(', ')}.`,
        );
      }
    }
    checkUrl(errors, 'theme.logo_url', theme.logo_url);
  }

  if (value.seo !== undefined && !isPlainObject(value.seo)) {
    errors.push('seo debe ser un objeto.');
  } else if (isPlainObject(value.seo)) {
    checkText(errors, 'seo.title', value.seo.title, MAX_SEO_TITLE);
    checkText(errors, 'seo.description', value.seo.description, MAX_SEO_DESCRIPTION);
    checkUrl(errors, 'seo.image_url', value.seo.image_url);
  }

  return { valid: errors.length === 0, errors };
}
