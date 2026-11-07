import { WorkflowFieldDef } from '../../../../../shared/workflows/contract/workflow-contract';
import {
  DocumentCheck,
  DocumentCheckLegibility,
} from '../services/document-checks-api.service';

/** Below this confidence a value is flagged for a human look (mirrors the backend). */
export const LOW_CONFIDENCE = 0.75;

/** Field types "Leer con IA" can fill (mirrors the backend list). */
const READABLE_TYPES = new Set([
  'text',
  'textarea',
  'number',
  'money',
  'date',
  'boolean',
  'select',
  'email',
  'phone',
]);

/** Provenance of a value the AI wrote into a form field. */
export interface AiFieldHint {
  /** 0..1 */
  confidence: number;
  page: number | null;
  low: boolean;
}

export type AiFieldHints = Record<string, AiFieldHint>;

export interface AiAppliedResult {
  values: Record<string, unknown>;
  hints: AiFieldHints;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  factura: 'Factura',
  rut: 'RUT',
  cedula: 'Cédula',
  certificado: 'Certificado',
  poliza: 'Póliza',
  contrato: 'Contrato',
  comprobante_pago: 'Comprobante de pago',
  otro: 'Otro documento',
};

const LEGIBILITY_LABELS: Record<DocumentCheckLegibility, string> = {
  good: 'buena',
  fair: 'regular',
  poor: 'mala',
};

export function readableFields(fields: WorkflowFieldDef[]): WorkflowFieldDef[] {
  return fields.filter((f) => READABLE_TYPES.has(f.type) && !f.compute);
}

export function docTypeLabel(docType: string | null): string {
  if (!docType) return 'No identificado';
  return DOC_TYPE_LABELS[docType] ?? docType.replace(/_/g, ' ');
}

export function legibilityLabel(legibility: DocumentCheckLegibility): string {
  return LEGIBILITY_LABELS[legibility];
}

export function percentText(confidence: number): string {
  return `${Math.round(confidence * 100)} %`;
}

export function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * Keys of the form that already hold something different from what the AI
 * read (those are never overwritten without asking). Booleans default to
 * `false` in the form, so an unticked toggle counts as empty.
 */
export function conflictingKeys(
  check: DocumentCheck,
  current: Record<string, unknown>,
): string[] {
  return Object.entries(check.result.fields)
    .filter(([key, read]) => {
      const typed = current[key];
      if (isEmptyValue(typed) || typed === false) return false;
      return String(typed) !== String(read.value);
    })
    .map(([key]) => key);
}

/** Values to write and the provenance hints. `replace` also overwrites the conflicts. */
export function applyCheck(
  check: DocumentCheck,
  current: Record<string, unknown>,
  replace: boolean,
): AiAppliedResult {
  const conflicts = new Set(conflictingKeys(check, current));
  const values: Record<string, unknown> = {};
  const hints: AiFieldHints = {};
  for (const [key, read] of Object.entries(check.result.fields)) {
    if (conflicts.has(key) && !replace) continue;
    values[key] = read.value;
    hints[key] = {
      confidence: read.confidence,
      page: read.page,
      low: read.confidence < LOW_CONFIDENCE,
    };
  }
  return { values, hints };
}

/** Text under a field the AI filled: "Confianza baja (62 %) · Página 2". */
export function hintText(hint: AiFieldHint): string {
  const page = hint.page ? ` · Página ${hint.page}` : '';
  return hint.low
    ? `Confianza baja (${percentText(hint.confidence)})${page}`
    : `Leído con IA (${percentText(hint.confidence)})${page}`;
}

/** Quota-style refusals of the AI engine (plan without AI, feature not included, quota spent). */
export function isAiQuotaCode(code: string | null): boolean {
  return code === 'SUBSCRIPTION_004' || code === 'SUBSCRIPTION_005' || code === 'SUBSCRIPTION_006';
}
