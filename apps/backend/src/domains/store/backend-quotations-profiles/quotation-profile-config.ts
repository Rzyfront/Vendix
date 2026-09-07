import { ErrorCodes, VendixHttpException } from '@common/errors';

/**
 * Contrato del snapshot de configuración de un perfil de cotización.
 *
 * Es lo que C.1 congela en el contrato y D.1 en la factura AIU (ADR-03):
 * con qué números se citó — porcentajes de administración, imprevistos y
 * utilidad de obra, vigencia de la oferta y términos. Todo opcional: un
 * perfil puede ser solo plantilla de términos y quien no usa perfiles
 * cotiza desde cero.
 */
export interface QuotationProfileConfig {
  admin_percent?: number;
  contingency_percent?: number;
  profit_percent?: number;
  validity_days?: number;
  payment_terms?: string;
  notes?: string;
}

const PERCENT_FIELDS = [
  'admin_percent',
  'contingency_percent',
  'profit_percent',
] as const;

const KNOWN_KEYS: ReadonlySet<string> = new Set([
  ...PERCENT_FIELDS,
  'validity_days',
  'payment_terms',
  'notes',
]);

export interface QuotationConfigIssue {
  field: string;
  code: string;
  message: string;
}

/**
 * ÚNICA puerta hacia `quotation_profile_versions.config`: proyecta la
 * entrada sobre la forma conocida, reporta cada clave desconocida por su
 * ruta y aplica rangos. Ningún camino del servicio persiste `dto.config`
 * directamente.
 *
 * Los porcentajes son 0..100 (no se exige que sumen nada: A/I/U no son
 * participación de un total sino recargos independientes sobre el costo
 * directo; la aritmética fiscal vive en C.1/D.1).
 */
export function normalizeAndAssertQuotationProfileConfig(
  input: unknown,
  profile_id?: number,
): QuotationProfileConfig {
  const issues: QuotationConfigIssue[] = [];

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new VendixHttpException(
      ErrorCodes.QPROFILE_CONFIG_001,
      'config debe ser el objeto de configuración del perfil.',
      { profile_id, issues: [{ field: 'config', code: 'NOT_AN_OBJECT' }] },
    );
  }

  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) {
      issues.push({
        field: `config.${key}`,
        code: 'UNKNOWN_KEY',
        message: `Clave desconocida: ${key}.`,
      });
    }
  }

  const config: QuotationProfileConfig = {};

  for (const field of PERCENT_FIELDS) {
    const value = raw[field];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push({
        field: `config.${field}`,
        code: 'NOT_A_NUMBER',
        message: `${field} debe ser un número entre 0 y 100.`,
      });
      continue;
    }
    if (value < 0 || value > 100) {
      issues.push({
        field: `config.${field}`,
        code: 'OUT_OF_RANGE',
        message: `${field} debe estar entre 0 y 100.`,
      });
      continue;
    }
    config[field] = value;
  }

  if (raw.validity_days !== undefined) {
    const value = raw.validity_days;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      issues.push({
        field: 'config.validity_days',
        code: 'NOT_A_NON_NEGATIVE_INTEGER',
        message: 'validity_days debe ser un entero mayor o igual a 0.',
      });
    } else {
      config.validity_days = value;
    }
  }

  for (const field of ['payment_terms', 'notes'] as const) {
    const value = raw[field];
    if (value === undefined) continue;
    if (typeof value !== 'string') {
      issues.push({
        field: `config.${field}`,
        code: 'NOT_A_STRING',
        message: `${field} debe ser texto.`,
      });
      continue;
    }
    const trimmed = value.trim();
    const max = field === 'payment_terms' ? 500 : 2000;
    if (trimmed.length > max) {
      issues.push({
        field: `config.${field}`,
        code: 'TOO_LONG',
        message: `${field} admite hasta ${max} caracteres.`,
      });
      continue;
    }
    config[field] = trimmed;
  }

  if (issues.length > 0) {
    throw new VendixHttpException(
      ErrorCodes.QPROFILE_CONFIG_001,
      'La configuración del perfil de cotización no es válida.',
      { profile_id, issues },
    );
  }

  return config;
}
