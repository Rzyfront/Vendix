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