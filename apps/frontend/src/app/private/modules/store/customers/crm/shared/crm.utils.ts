import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { CrmConsent, CrmCustomerSource, CrmTimelineType } from './crm.interface';

/** Owner/admin (`store:crm_inbox:assign`) see and assign the whole store. */
export function crmCanSeeAll(auth: AuthFacade): boolean {
  return auth.isOwner() || auth.hasPermission('store:crm_inbox:assign');
}

export const CRM_SOURCE_LABELS: Record<CrmCustomerSource, string> = {
  pos: 'Punto de venta',
  ecommerce: 'Tienda en línea',
  whatsapp: 'WhatsApp',
  landing: 'Landing de captación',
  import: 'Importación',
  manual: 'Manual',
  referral: 'Referido',
};

export const CRM_CONSENT_LABELS: Record<CrmConsent, string> = {
  unknown: 'Sin definir',
  opted_in: 'Acepta',
  opted_out: 'No acepta',
};

export const CRM_TIMELINE_META: Record<
  CrmTimelineType,
  { label: string; icon: string }
> = {
  order: { label: 'Pedidos', icon: 'shopping-cart' },
  payment: { label: 'Pagos', icon: 'credit-card' },
  quotation: { label: 'Cotizaciones', icon: 'file-text' },
  booking: { label: 'Reservas', icon: 'calendar' },
  message: { label: 'Mensajes', icon: 'message-circle' },
  task: { label: 'Tareas', icon: 'check-square' },
  note: { label: 'Notas', icon: 'sticky-note' },
};

/** `datetime-local` value (browser local time) of an ISO instant. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** ISO instant of a `datetime-local` value, or null when empty. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-CO', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Date-only (`YYYY-MM-DD`) shown without a timezone shift. */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '';
  return new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString('es-CO', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
