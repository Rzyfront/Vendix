/**
 * Formatters para branding + payment methods.
 * Espejo de apps/frontend/.../config/application/* y config/payment-methods/*
 */

import type {
  StorePaymentMethodState,
  StorePaymentMethod,
  OrganizationBrandingSettings,
} from '@/core/models/org-admin/config.types';

// ----------------------------------------------------------------------------
// Branding defaults — fallback si la org nunca guardó branding
// ----------------------------------------------------------------------------

export const BRANDING_DEFAULTS: OrganizationBrandingSettings = {
  name: 'Mi organización',
  primary_color: '#2ecc71',
  secondary_color: '#3498db',
  accent_color: '#e67e22',
  background_color: '#ffffff',
  surface_color: '#f8f9fa',
  text_color: '#212529',
  text_secondary_color: '#6c757d',
  text_muted_color: '#adb5bd',
};

export function mergeBrandingDefaults(
  incoming: Partial<OrganizationBrandingSettings> | null | undefined,
): OrganizationBrandingSettings {
  return { ...BRANDING_DEFAULTS, ...(incoming ?? {}) };
}

// ----------------------------------------------------------------------------
// Hex validators
// ----------------------------------------------------------------------------

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isValidHex(value: string | null | undefined): boolean {
  if (!value) return false;
  return HEX_RE.test(value.trim());
}

export function normalizeHex(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  const m = HEX_RE.exec(trimmed);
  if (!m) return trimmed;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  return `#${hex.toLowerCase()}`;
}

// ----------------------------------------------------------------------------
// Payment method state — paridad con web payment-method-row.component.html
// ----------------------------------------------------------------------------

export interface PaymentStateBadge {
  label: string;
  variant: 'success' | 'neutral' | 'warning';
}

export function paymentStateBadge(state: StorePaymentMethodState | string | null | undefined): PaymentStateBadge {
  switch (state) {
    case 'enabled':
      return { label: 'Activo', variant: 'success' };
    case 'requires_configuration':
      return { label: 'Requiere config', variant: 'warning' };
    case 'disabled':
    default:
      return { label: 'Desactivado', variant: 'neutral' };
  }
}

// ----------------------------------------------------------------------------
// Amount formatter (form payment-methods)
// ----------------------------------------------------------------------------

export function formatAmountRange(method: Pick<StorePaymentMethod, 'min_amount' | 'max_amount'>): string {
  const min = method.min_amount;
  const max = method.max_amount;
  if (min == null && max == null) return 'Sin límites';
  if (min != null && max != null) return `$${min.toLocaleString('es-CO')} – $${max.toLocaleString('es-CO')}`;
  if (min != null) return `Mín. $${min.toLocaleString('es-CO')}`;
  return `Máx. $${max!.toLocaleString('es-CO')}`;
}

// ----------------------------------------------------------------------------
// Stats — paridad con stats cards web
// ----------------------------------------------------------------------------

export interface PaymentStatsSummary {
  total: number;
  enabled: number;
  disabled: number;
  requiresConfig: number;
}

export function summarizePaymentStats(stats: {
  total_methods: number;
  enabled_methods: number;
  disabled_methods: number;
  requires_config: number;
}): PaymentStatsSummary {
  return {
    total: stats.total_methods,
    enabled: stats.enabled_methods,
    disabled: stats.disabled_methods,
    requiresConfig: stats.requires_config,
  };
}

// ----------------------------------------------------------------------------
// Branding preview helper (concat)
// ----------------------------------------------------------------------------

export function brandingName(branding: Partial<OrganizationBrandingSettings> | null | undefined): string {
  return branding?.name?.trim() || BRANDING_DEFAULTS.name;
}
