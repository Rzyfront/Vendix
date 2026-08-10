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
//
// SE MUDARON A `shared/utils/dian-validators.ts`.
//
// Vivían solo acá, y este es el riel de MENOR riesgo: un operador interno de
// Vendix, una sola configuración. Las tres superficies que usan los comerciantes
// —asistente de tienda, host de tenant y el formulario del asistente de activación
// fiscal— no tenían ninguno, así que la validación estaba invertida respecto al
// riesgo. Se re-exportan desde acá para no romper a quien ya importaba de este
// archivo; los consumidores nuevos deben importar de `shared/utils`.
export {
  confirmProductionValidator,
  nitFormatValidator,
  numericIdValidator,
  optionalNumericIdValidator,
  rangoFinalGreaterValidator,
  // Renombrado en la mudanza: `uuidValidator` a secas no decía de quién era el
  // UUID ni por qué acepta cualquier versión.
  dianUuidValidator as uuidValidator,
} from '../../../../../shared/utils/dian-validators';

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
