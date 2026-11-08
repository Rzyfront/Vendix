import { ErrorCodes, VendixHttpException } from '@common/errors';
import { WORKFLOW_LIMIT_KEYS, WorkflowLimitKey } from './workflow-limits.constants';

export type WorkflowLimitsInput = Partial<Record<WorkflowLimitKey, number | null>>;

/**
 * The monthly counters are `INTEGER` columns: they never pass this, so a
 * bigger cap could never be reached and only reads as a number. "Sin límite"
 * (`null`) is the way to not limit them.
 */
export const MAX_MONTHLY_CAP = 2_147_483_647;

function invalid(detail: string, field: string): VendixHttpException {
  return new VendixHttpException(ErrorCodes.WORKFLOW_LIMITS_INVALID, detail, { field });
}

/**
 * Validates the `workflow_limits` a superadmin sends for a plan.
 * `undefined` leaves the stored value untouched, `null` clears it (platform
 * defaults), an object sets it: only the three known keys, each a
 * non-negative integer or `null` (unlimited). A missing key keeps its default.
 */
export function parseWorkflowLimits(raw: unknown): WorkflowLimitsInput | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalid('Los límites de Flujos deben ser un objeto.', 'workflow_limits');
  }
  const input = raw as Record<string, unknown>;
  const known = new Set<string>(WORKFLOW_LIMIT_KEYS);
  const unknown = Object.keys(input).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    throw invalid(`Límites de Flujos desconocidos: ${unknown.join(', ')}.`, 'workflow_limits');
  }
  const out: WorkflowLimitsInput = {};
  for (const key of WORKFLOW_LIMIT_KEYS) {
    const value = input[key];
    if (value === undefined) continue;
    if (value !== null && !(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) {
      throw invalid(
        `El límite "${key}" debe ser un entero mayor o igual a 0, o null para ilimitado.`,
        `workflow_limits.${key}`,
      );
    }
    if (value !== null && key !== 'storage_bytes' && value > MAX_MONTHLY_CAP) {
      throw invalid(
        `El límite "${key}" puede ser como máximo ${MAX_MONTHLY_CAP.toLocaleString('es-CO')}; para no limitarlo usa «Sin límite».`,
        `workflow_limits.${key}`,
      );
    }
    out[key] = value as number | null;
  }
  return out;
}
