import type { BadgeVariant } from '../../../../../shared/components/badge/badge.component';
import { AppKind, AppStatus, StoreApp } from '../interfaces/store-app.interface';

export type AppCardAction =
  | { kind: 'route'; label: string; route: string }
  /** Opens the app's own settings inside `/admin/apps` (product page, service page, booking). */
  | { kind: 'configure'; label: string }
  | { kind: 'disabled'; label: string };

export interface AppCard {
  key: AppKind;
  name: string;
  description: string;
  icon: string;
  statusLabel: string;
  statusVariant: BadgeVariant;
  hostname: string | null;
  publicUrl: string | null;
  action: AppCardAction;
}

const STATUS: Record<AppStatus, { label: string; variant: BadgeVariant }> = {
  published: { label: 'Publicada', variant: 'success' },
  draft: { label: 'Borrador', variant: 'warning' },
  disabled: { label: 'Desactivada', variant: 'neutral' },
  not_installed: { label: 'No instalada', variant: 'neutral' },
};

const ICONS: Record<AppKind, string> = {
  ecommerce: 'shopping-bag',
  store_home: 'home',
  landing: 'sparkles',
  product_page: 'package',
  service_page: 'briefcase',
  booking: 'bed-double',
};

/**
 * Apps that already have an admin screen. The card sends the user to it,
 * unchanged (apps-module D1/D2); the rest arrive in their own phase.
 */
const ADMIN_SCREEN: Partial<Record<AppKind, { label: string; route: string }>> = {
  ecommerce: { label: 'Administrar', route: '/admin/ecommerce' },
  landing: { label: 'Configurar', route: '/admin/customers/crm' },
};

/**
 * Apps configured from `/admin/apps` itself (Fase 2 product page, Fase 3
 * service page, Fase 4 booking). Booking only reaches this point for a
 * `hospitality` store: the industry check above disables it for the rest.
 */
const CONFIGURABLE_HERE: AppKind[] = ['product_page', 'service_page', 'booking'];

/** Store types without online store (`MenuFilterService.storeTypeHiddenModules`). */
const STORE_TYPES_WITHOUT_ECOMMERCE = ['physical', 'popup', 'kiosko'];

/**
 * Card view of one app of `GET /store/apps` (apps-module S4/T6).
 *
 * The action respects the same rules as the sidebar: a store type that hides
 * `ecommerce` gets an explanation instead of a silent gap, and an app that
 * does not apply to the store industries says so.
 */
export function toAppCard(app: StoreApp, storeType: string | null): AppCard {
  const status = STATUS[app.status] ?? STATUS.not_installed;
  return {
    key: app.key,
    name: app.name,
    description: app.description,
    icon: ICONS[app.key] ?? 'app-window',
    statusLabel: status.label,
    statusVariant: status.variant,
    hostname: app.domain?.hostname ?? null,
    publicUrl: app.public_url,
    action: resolveAction(app, storeType),
  };
}

function resolveAction(app: StoreApp, storeType: string | null): AppCardAction {
  if (!app.applies_to_store_industries) {
    return { kind: 'disabled', label: 'No aplica a tu industria' };
  }
  if (
    app.key === 'ecommerce' &&
    STORE_TYPES_WITHOUT_ECOMMERCE.includes(storeType ?? '')
  ) {
    return { kind: 'disabled', label: 'No disponible para tu tipo de tienda' };
  }
  const screen = ADMIN_SCREEN[app.key];
  if (screen) return { kind: 'route', ...screen };
  if (CONFIGURABLE_HERE.includes(app.key)) return { kind: 'configure', label: 'Configurar' };
  return { kind: 'disabled', label: 'Próximamente' };
}
