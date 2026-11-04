import type { BadgeVariant } from '../../../../../shared/components/badge/badge.component';
import { AppKind, AppStatus, StoreApp } from '../interfaces/store-app.interface';
import { appViewRoute } from './app-routes.util';

export type AppCardAction =
  /** Opens the app's own view: `/admin/apps/:kind`, or `/admin/ecommerce` for the online store. */
  | { kind: 'route'; label: string; route: string }
  | { kind: 'disabled'; label: string };

export interface AppCard {
  key: AppKind;
  name: string;
  description: string;
  icon: string;
  statusLabel: string;
  statusVariant: BadgeVariant;
  /** "Encendida" (draft or published). */
  enabled: boolean;
  hostname: string | null;
  publicUrl: string | null;
  action: AppCardAction;
}

const STATUS: Record<AppStatus, { label: string; variant: BadgeVariant }> = {
  published: { label: 'Publicada', variant: 'success' },
  draft: { label: 'Borrador', variant: 'warning' },
  disabled: { label: 'Apagada', variant: 'neutral' },
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

/** Store types without online store (`MenuFilterService.storeTypeHiddenModules`). */
const STORE_TYPES_WITHOUT_ECOMMERCE = ['physical', 'popup', 'kiosko'];

/**
 * Card view of one app of `GET /store/apps` (apps-module S4/T6, apps-vistas-f1).
 *
 * Every card navigates to the app's own view: no app is managed from a modal
 * (S6). The online store goes to its view of today, `/admin/ecommerce` (S5).
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
    enabled: app.enabled === true,
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
  return {
    kind: 'route',
    label: app.key === 'ecommerce' ? 'Administrar' : 'Abrir',
    route: appViewRoute(app.key),
  };
}
