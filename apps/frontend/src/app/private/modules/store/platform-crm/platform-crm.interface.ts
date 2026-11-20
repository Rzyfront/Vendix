/**
 * Vendix Platform · enlace prospecto CRM ↔ organización cliente.
 * Espejo de `apps/backend/src/domains/platform-crm/platform-crm-links.service.ts`.
 */

export const PLATFORM_CRM_PERMISSIONS = {
  MANAGE: 'platform:crm_link:manage',
  READ: 'platform:crm_link:read',
} as const;

export interface PlatformOrganizationSearchItem {
  id: number;
  name: string;
  slug: string;
  state: string;
  created_at: string | null;
}

export interface PlatformStoreSearchItem {
  id: number;
  name: string;
  slug: string;
  organization: { id: number; name: string };
  plan_name: string | null;
  subscription_state: string | null;
}

/** `GET store/platform-crm/accounts/search?q=` */
export interface PlatformAccountSearchResult {
  organizations: PlatformOrganizationSearchItem[];
  stores: PlatformStoreSearchItem[];
}

/** El enlace va a la organización entera O a una tienda, nunca a las dos. */
export type PlatformCrmLinkTarget = { organization_id: number } | { linked_store_id: number };

export interface PlatformOrganizationSubscription {
  store_name: string;
  plan_name: string | null;
  state: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
}

export interface PlatformOrganizationSummary {
  id: number;
  name: string;
  state: string;
  subscriptions: PlatformOrganizationSubscription[];
}

export interface PlatformCrmLink {
  id: number;
  status: string;
  note: string | null;
  linked_at: string;
  linked_by: { id: number; first_name: string | null; last_name: string | null };
  /** Tienda concreta del enlace; `null` = la organización completa. */
  linked_store: { id: number; name: string } | null;
}

export interface PlatformCrmLinkView {
  link: PlatformCrmLink | null;
  organization: PlatformOrganizationSummary | null;
}

/** Una cuenta Vendix enlazada al cliente (puede tener varias). */
export interface PlatformCrmLinkItem extends PlatformCrmLink {
  /** `organization` = la org completa; `store` = solo `linked_store`. */
  scope: 'organization' | 'store';
  organization: PlatformOrganizationSummary | null;
}

/** `GET store/platform-crm/customers/:customerId/links` */
export interface PlatformCrmLinkList {
  links: PlatformCrmLinkItem[];
}

const SUBSCRIPTION_STATE_LABELS: Record<string, string> = {
  draft: 'Borrador',
  trial: 'En prueba',
  active: 'Activa',
  grace_soft: 'En gracia',
  grace_hard: 'En gracia (final)',
  suspended: 'Suspendida',
  blocked: 'Bloqueada',
  cancelled: 'Cancelada',
  expired: 'Vencida',
  pending_payment: 'Pago pendiente',
};

const ORGANIZATION_STATE_LABELS: Record<string, string> = {
  active: 'Activa',
  inactive: 'Inactiva',
  suspended: 'Suspendida',
  archived: 'Archivada',
  draft: 'Borrador',
};

/** Etiqueta del estado de una suscripción; sin estado → ''. */
export function subscriptionStateLabel(state: string | null | undefined): string {
  return state ? (SUBSCRIPTION_STATE_LABELS[state] ?? state) : '';
}

/** Etiqueta del estado de una organización; sin estado → ''. */
export function organizationStateLabel(state: string | null | undefined): string {
  return state ? (ORGANIZATION_STATE_LABELS[state] ?? state) : '';
}

/** Lo que leen las compuertas del bloque de la sesión (`AuthFacade`). */
export interface VendixAccountSession {
  hasPermission(name: string): boolean;
  /** Tienda activa: `user.store` del login o del cambio de entorno. */
  userStore(): unknown;
}

/**
 * La tienda activa es de la organización plataforma. El login y el cambio de
 * entorno ya sirven la fila de su organización en `user.store.organizations`,
 * `is_platform` incluido: no hace falta pedir nada. Sin el dato → `false`.
 */
export function isPlatformStoreSession(store: unknown): boolean {
  const organization = (store as { organizations?: { is_platform?: unknown } } | null | undefined)
    ?.organizations;
  return organization?.is_platform === true;
}

/**
 * El bloque solo se monta en una tienda de la org plataforma Y con
 * `platform:crm_link:read`. El permiso solo no basta: super admin lo recibe
 * (recibe todos) aunque esté en una tienda ajena. Fuera de la tienda de Vendix
 * Platform el componente ni se descarga ni consulta el backend.
 */
export function canSeeVendixAccount(session: VendixAccountSession): boolean {
  return (
    isPlatformStoreSession(session.userStore()) &&
    session.hasPermission(PLATFORM_CRM_PERMISSIONS.READ)
  );
}

export function canManageVendixAccount(session: VendixAccountSession): boolean {
  return (
    isPlatformStoreSession(session.userStore()) &&
    session.hasPermission(PLATFORM_CRM_PERMISSIONS.MANAGE)
  );
}

// ─── Movimientos de la suscripción (D1, D3) ────────────────────────────────

export type SubscriptionMovementType = 'invoice' | 'payment' | 'event';

export interface MoneyAmount {
  currency: string;
  amount: number;
}

/** Un movimiento: misma forma para los tres tipos; lo que no aplica, `null`. */
export interface SubscriptionMovement {
  key: string;
  type: SubscriptionMovementType;
  date: string;
  store_id: number;
  store_name: string;
  state: string | null;
  invoice_number: string | null;
  total: number | null;
  amount_paid: number | null;
  due_at: string | null;
  change_kind: string | null;
  amount: number | null;
  currency: string | null;
  payment_method: string | null;
  failure_reason: string | null;
  event_type: string | null;
  from_state: string | null;
  to_state: string | null;
  from_plan_name: string | null;
  to_plan_name: string | null;
}

export interface SubscriptionMetrics {
  total_paid: MoneyAmount[];
  last_payment: { date: string; amount: number; currency: string; store_id: number } | null;
  next_renewal_at: string | null;
  overdue_count: number;
  overdue_balance: MoneyAmount[];
  monthly_value: MoneyAmount[];
}

export interface CoveredStore {
  store_id: number;
  store_name: string;
  organization_name: string;
  plan_name: string | null;
  subscription_state: string | null;
}

/** `GET store/platform-crm/customers/:customerId/subscription-movements` */
export interface SubscriptionMovementsView {
  window: { from: string; to: string };
  stores: CoveredStore[];
  summary: {
    total: SubscriptionMetrics;
    by_store: Array<{ store_id: number } & SubscriptionMetrics>;
  };
  items: SubscriptionMovement[];
  pagination: { page: number; limit: number; total: number; has_more: boolean };
}

export interface SubscriptionMovementsQuery {
  store_id?: number;
  type?: SubscriptionMovementType;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

// ─── Actividad por comercio (D4) ───────────────────────────────────────────

/** `GET store/platform-crm/customers/:customerId/stores/:storeId/activity` */
export interface PlatformStoreActivityView {
  store: { store_id: number; store_name: string; organization_name: string };
  window: { from: string; to: string; days: number };
  summary: {
    score: number;
    orders_count: number;
    revenue_operating: number;
    active_users: number;
    audit_events: number;
    last_activity_at: string | null;
  };
  series: {
    days: Array<{
      date: string;
      orders: number;
      revenue_operating: number;
      audit_events: number;
      logins: number;
    }>;
    by_channel: Record<string, number>;
    by_state: Record<string, number>;
  };
}

const INVOICE_STATE_LABELS: Record<string, string> = {
  issued: 'Emitida',
  paid: 'Pagada',
  overdue: 'Vencida',
  void: 'Anulada',
  refunded: 'Reembolsada',
  refunded_chargeback: 'Contracargo',
};

const PAYMENT_STATE_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  succeeded: 'Exitoso',
  failed: 'Fallido',
  refunded: 'Reembolsado',
  partial_refund: 'Reembolso parcial',
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  plan_changed: 'Cambio de plan',
  cancelled: 'Suscripción cancelada',
  reactivated: 'Suscripción reactivada',
  trial_started: 'Inicio de prueba',
  trial_ended: 'Fin de prueba',
  state_transition: 'Cambio de estado',
  chargeback_received: 'Contracargo recibido',
  renewal_failed: 'Renovación fallida',
  scheduled_cancel: 'Cancelación programada',
};

export function invoiceStateLabel(state: string | null | undefined): string {
  return state ? (INVOICE_STATE_LABELS[state] ?? state) : '';
}

export function paymentStateLabel(state: string | null | undefined): string {
  return state ? (PAYMENT_STATE_LABELS[state] ?? state) : '';
}

export function eventTypeLabel(type: string | null | undefined): string {
  return type ? (EVENT_TYPE_LABELS[type] ?? type) : '';
}

/**
 * Monto con su moneda explícita: los movimientos pueden venir en COP o USD,
 * no en la moneda de la tienda Vendix Platform.
 */
export function formatMoneyAmount(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined) return '';
  const code = (currency || 'COP').toUpperCase();
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: code === 'COP' ? 0 : 2,
      maximumFractionDigits: code === 'COP' ? 0 : 2,
    }).format(amount);
  } catch {
    return `${code} ${amount}`;
  }
}

/** Varios montos por moneda en una línea; vacío → '—'. */
export function formatMoneyList(list: MoneyAmount[] | null | undefined): string {
  if (!list || list.length === 0) return '—';
  return list.map((m) => formatMoneyAmount(m.amount, m.currency)).join(' · ');
}
