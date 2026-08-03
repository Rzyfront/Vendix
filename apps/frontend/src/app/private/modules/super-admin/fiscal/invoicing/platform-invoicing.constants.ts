import {
  AbstractControl,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';

import type { SubscriptionFiscalEnvironment } from '../../subscriptions/interfaces/fiscal-billing.interface';

/**
 * Vocabulario compartido por las 4 pestañas de Facturación de plataforma.
 *
 * Vivían duplicadas dentro del componente monolítico; al partirlo en pestañas
 * cada una necesitaba las mismas etiquetas y validadores, y copiarlas habría
 * garantizado que se desincronizaran.
 */

export const ENVIRONMENT_OPTIONS = [
  { value: 'test', label: 'Sandbox DIAN' },
  { value: 'production', label: 'Producción DIAN' },
];

export const FILTER_ENVIRONMENT_OPTIONS = [
  { value: '', label: 'Todos los ambientes' },
  { value: 'test', label: 'Sandbox' },
  { value: 'production', label: 'Producción' },
];

export const TRANSMISSION_STATUS_OPTIONS = [
  { value: '', label: 'Todos los estados' },
  { value: 'queued', label: 'En cola' },
  { value: 'submitted', label: 'Enviada' },
  { value: 'accepted', label: 'Aceptada' },
  { value: 'rejected', label: 'Rechazada' },
  { value: 'error', label: 'Error' },
  { value: 'retrying', label: 'Reintentando' },
];

export const RESOLUTION_DOCUMENT_TYPE_OPTIONS = [
  { value: 'sales_invoice', label: 'Factura electrónica' },
  { value: 'support_document', label: 'Documento soporte' },
];

// ── Validadores ────────────────────────────────────────────────────────────

/** IDs de entidad: enteros positivos. Un `0` o un `-1` no referencian nada. */
export const numericIdValidator = Validators.pattern(/^[1-9]\d*$/);

export const optionalNumericIdValidator: ValidatorFn = (
  control: AbstractControl,
): ValidationErrors | null => {
  const value = control.value;
  if (value === null || value === undefined || value === '') return null;
  return /^[1-9]\d*$/.test(String(value)) ? null : { numeric_id: true };
};

/**
 * La DIAN emite `software_id` y `test_set_id` como UUID. Un valor pegado con un
 * espacio de más lo acepta el endpoint DIAN y luego nunca clasifica, lo que es
 * indistinguible de una cola atascada — el backend ya valida con `@IsUUID`, y
 * esto lo adelanta al formulario en vez de esperar un 400.
 */
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const uuidValidator: ValidatorFn = (
  control: AbstractControl,
): ValidationErrors | null => {
  const value = control.value;
  if (value === null || value === undefined || value === '') return null;
  return UUID_RE.test(String(value).trim()) ? null : { dian_uuid: true };
};

/** El NIT viaja a la DIAN sin separadores; se admite el DV pegado con guion. */
export const nitFormatValidator: ValidatorFn = (
  control: AbstractControl,
): ValidationErrors | null => {
  const value = control.value;
  if (value === null || value === undefined || value === '') return null;
  return /^\d{5,15}(-\d)?$/.test(String(value).trim())
    ? null
    : { nit_format: true };
};

export const rangoFinalGreaterValidator: ValidatorFn = (
  group: AbstractControl,
): ValidationErrors | null => {
  const inicio = Number(group.get('rango_inicial')?.value);
  const fin = Number(group.get('rango_final')?.value);
  if (!Number.isFinite(inicio) || !Number.isFinite(fin)) return null;
  if (fin <= inicio) return { rango_final_invalid: true };
  return null;
};

export const confirmProductionValidator: ValidatorFn = (
  group: AbstractControl,
): ValidationErrors | null => {
  const environment = group.get('environment')?.value;
  const enabled = group.get('is_enabled')?.value;
  const confirmed = group.get('confirm_production')?.value;
  if (environment === 'production' && enabled && !confirmed) {
    return { confirm_production_required: true };
  }
  return null;
};

// ── Etiquetas ──────────────────────────────────────────────────────────────

export function environmentLabel(
  environment?: SubscriptionFiscalEnvironment | null,
): string {
  if (environment === 'production') return 'Producción';
  if (environment === 'test') return 'Sandbox';
  return '—';
}

export function transmissionStatusLabel(status?: string | null): string {
  switch (status) {
    case 'accepted':
      return 'Aceptada';
    case 'rejected':
      return 'Rechazada';
    case 'error':
      return 'Error';
    case 'submitted':
      return 'Enviada';
    case 'retrying':
      return 'Reintentando';
    case 'queued':
      return 'En cola';
    default:
      return status ?? '—';
  }
}

export function transmissionStatusBadgeClasses(status?: string | null): string {
  if (status === 'accepted') {
    return 'bg-success-light text-success border-success';
  }
  if (status === 'rejected' || status === 'error') {
    return 'bg-error-light text-error border-error';
  }
  return 'bg-warning-light text-warning border-warning';
}

export function resolutionDocTypeLabel(type: string): string {
  if (type === 'sales_invoice') return 'Factura';
  if (type === 'support_document') return 'Doc. soporte';
  return type;
}

/**
 * Traduce el `reason` con que el backend rechaza una emisión. Sin esto el
 * usuario ve la constante cruda y no sabe qué interruptor tocar.
 */
export function skippedReasonLabel(reason: string): string {
  const REASONS: Record<string, string> = {
    subscription_fiscal_billing_disabled:
      'La facturación electrónica está desactivada',
    subscription_fiscal_auto_issue_disabled:
      'La emisión automática está desactivada',
    subscription_invoice_not_paid: 'La factura SaaS aún no está pagada',
    vendor_support_fiscal_disabled:
      'El documento soporte electrónico está desactivado',
    vendor_support_fiscal_auto_transmit_disabled:
      'La transmisión automática está desactivada',
    vendor_support_not_approved: 'El documento soporte aún no está aprobado',
  };
  return REASONS[reason] ?? reason;
}

// ── Coerción de IDs ────────────────────────────────────────────────────────

export function parseRequiredId(
  value: string | number | null | undefined,
): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseOptionalId(
  value: string | number | null | undefined,
): number | undefined {
  return parseRequiredId(value) ?? undefined;
}

export function toIdValue(value: number | null | undefined): string | null {
  return value ? String(value) : null;
}

export function asNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
