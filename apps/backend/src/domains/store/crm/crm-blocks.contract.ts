/**
 * Contrato del documento de bloques de la CRM Landing (QUI-719).
 *
 * Único artefacto compartido entre el generador IA (produce), el editor
 * (muta) y el render público (pinta). Cualquier cambio aquí es un cambio
 * de contrato: subir `CRM_LANDING_SCHEMA_VERSION` y mantener retro-
 * compatibilidad en el render para versiones anteriores.
 */

export const CRM_LANDING_SCHEMA_VERSION = 1;

export const CRM_BLOCK_TYPES = [
  'hero',
  'features',
  'products_grid',
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
}

export interface CrmLandingTheme {
  primary_color?: string;
  secondary_color?: string;
}

export interface CrmLandingDocument {
  schema_version: typeof CRM_LANDING_SCHEMA_VERSION;
  theme?: CrmLandingTheme;
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
  }

  return { valid: errors.length === 0, errors };
}
