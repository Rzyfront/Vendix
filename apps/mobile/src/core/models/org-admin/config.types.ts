import type { ISODateString } from './common.types';

export interface OrganizationSettings {
  id: string;
  organization_id: string;
  app_name?: string;
  logo_url?: string;
  primary_color?: string;
  contact_email?: string;
  contact_phone?: string;
  timezone?: string;
  locale?: string;
  currency?: string;
  fiscal_scope?: 'STORE' | 'ORGANIZATION';
  operating_scope?: 'STORE' | 'ORGANIZATION';
  is_active: boolean;
  updated_at?: ISODateString;
  created_at?: ISODateString;
}

export interface PaymentMethod {
  id: string;
  code: string;
  name: string;
  type: 'CASH' | 'CARD' | 'TRANSFER' | 'DIGITAL_WALLET' | 'CREDIT' | 'OTHER';
  is_active: boolean;
  provider?: string;
  config?: Record<string, unknown>;
  organization_id: string;
  created_at?: ISODateString;
  updated_at?: ISODateString;
}

export interface FiscalScopeInfo {
  current_scope: 'STORE' | 'ORGANIZATION';
  is_locked: boolean;
  can_switch: boolean;
  reason?: string;
  fiscal_data?: {
    nit?: string;
    dv?: string;
    name?: string;
    regime?: string;
    [k: string]: unknown;
  };
}

export interface FiscalManagementStatus {
  is_active: boolean;
  current_step?: string;
  steps_completed: string[];
  started_at?: ISODateString;
  completed_at?: ISODateString;
  progress_percent: number;
}

// ============================================================================
// Operating Scope (paridad visual web → mobile)
// Espejo 1:1 de apps/frontend/.../operating-scope/services/operating-scope.service.ts
// ============================================================================

export type OperatingScopeValue = 'STORE' | 'ORGANIZATION';
export type OperatingScopeDirection = 'NOOP' | 'UP' | 'DOWN';

export interface OperatingScopeAuditLogEntry {
  id: number;
  previous_value: OperatingScopeValue | null;
  new_value: OperatingScopeValue;
  changed_by_user_id: number | null;
  changed_at: string;
  reason: string | null;
}

export interface OperatingScopeCurrentState {
  current: OperatingScopeValue;
  is_partner: boolean;
  account_type: string | null;
  audit_log_recent: OperatingScopeAuditLogEntry[];
  editable: boolean;
}

export type OperatingScopeBlockerCode =
  | 'PARTNER_LOCKED'
  | 'NOT_ENOUGH_STORES'
  | 'NO_ACTIVE_STORES'
  | 'OPEN_POS_TO_CENTRAL'
  | 'OPEN_PURCHASE_ORDERS'
  | 'OPEN_CROSS_STORE_TRANSFERS'
  | 'STOCK_AT_CENTRAL'
  | 'ACTIVE_RESERVATIONS_AT_CENTRAL'
  | (string & {});

export interface OperatingScopeBlockerDetails {
  count?: number;
  remediation_link?: string | null;
  [extra: string]: unknown;
}

export interface OperatingScopeBlocker {
  code: OperatingScopeBlockerCode;
  message: string;
  details?: OperatingScopeBlockerDetails;
}

export interface OperatingScopePreview {
  organization_id: number;
  current_scope: OperatingScopeValue;
  target_scope: OperatingScopeValue;
  is_partner: boolean;
  direction: OperatingScopeDirection;
  can_apply: boolean;
  warnings: string[];
  blockers: OperatingScopeBlocker[];
}

export interface OperatingScopeApplyResult {
  organization_id: number;
  previous_scope: OperatingScopeValue;
  new_scope: OperatingScopeValue;
  audit_log_id: number;
  applied_at: string;
  forced?: boolean;
}

export interface ApplyOperatingScopeDto {
  target_scope: OperatingScopeValue;
  reason?: string;
  force?: boolean;
}

// ============================================================================
// General (branding + appearance) — paridad visual con web
// Espejo de apps/frontend/src/app/core/models/organization.model.ts
// ============================================================================

export interface OrganizationBrandingSettings {
  name: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  background_color: string;
  surface_color: string;
  text_color: string;
  text_secondary_color: string;
  text_muted_color: string;
  logo_url?: string;
  favicon_url?: string;
}

export interface OrganizationFonts {
  primary: string;
  secondary: string;
  headings: string;
}

export interface OrganizationPanelUISettings {
  ORG_ADMIN?: Record<string, boolean>;
}

export interface OrganizationSettingsFull {
  branding: OrganizationBrandingSettings;
  inventory?: {
    mode: 'organizational' | 'independent';
    low_stock_alerts_scope: 'location' | 'store' | 'org';
    fallback_on_stockout: 'reject' | 'ask_user' | 'auto_next_available';
    costing_method?: 'weighted_average' | 'fifo';
  };
  fonts?: OrganizationFonts;
  panel_ui?: OrganizationPanelUISettings;
  payroll?: unknown;
}

export type OrganizationBranding = OrganizationBrandingSettings;

// ============================================================================
// Payment Methods (store-scoped) — paridad con web
// Espejo de apps/frontend/.../config/payment-methods/services/payment-methods.service.ts
// ⚠️ KNOWN ISSUE: estos endpoints están store-scoped y ORG_ADMIN recibe 403.
//    Se replica la UI web tal cual; el error 403 se muestra al usuario.
// ============================================================================

export type StorePaymentMethodState = 'enabled' | 'disabled' | 'requires_configuration';

export interface SystemPaymentMethod {
  id: number;
  name: string;
  display_name: string;
  type: string;
  provider: string;
  requires_config: boolean;
  config_schema?: Record<string, unknown>;
  is_active: boolean;
}

export interface StorePaymentMethod {
  id: number;
  store_id: number;
  system_payment_method_id: number;
  display_name: string;
  custom_config: Record<string, unknown>;
  state: StorePaymentMethodState;
  display_order: number;
  min_amount?: number | null;
  max_amount?: number | null;
  created_at: string;
  updated_at: string;
  system_payment_method?: SystemPaymentMethod;
}

export interface PaymentMethodStats {
  total_methods: number;
  enabled_methods: number;
  disabled_methods: number;
  requires_config: number;
  total_transactions: number;
  successful_transactions: number;
  failed_transactions: number;
  total_revenue: number;
}

export interface UpdateStorePaymentMethodDto {
  display_name?: string;
  custom_config?: Record<string, unknown>;
  min_amount?: number | null;
  max_amount?: number | null;
}

export interface EnableSystemPaymentMethodDto {
  custom_config?: Record<string, unknown>;
  display_name?: string;
}

/**
 * Legacy OperatingScopeInfo (pre-PR #14).
 *
 * Mantenido para compat con `app/(org-admin)/settings/operating-scope.tsx`
 * que sigue usando el contrato antiguo (`current_scope`, `is_locked`,
 * `can_switch`, `available_scopes`).
 *
 * El contrato nuevo (POST-PR #14) está en `OperatingScopeCurrentState`
 * (campo `current`, `is_partner`, `editable`) — usado por
 * `app/(org-admin)/config/application.tsx`.
 *
 * Cuando `operating-scope.tsx` migre al contrato nuevo, este type se puede
 * eliminar.
 */
export interface OperatingScopeInfo {
  current_scope: 'STORE' | 'ORGANIZATION';
  is_locked: boolean;
  can_switch: boolean;
  reason?: string;
  available_scopes: Array<'STORE' | 'ORGANIZATION'>;
}