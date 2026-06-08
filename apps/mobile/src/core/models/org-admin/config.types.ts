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

export interface OperatingScopeInfo {
  current_scope: 'STORE' | 'ORGANIZATION';
  is_locked: boolean;
  can_switch: boolean;
  reason?: string;
  available_scopes: Array<'STORE' | 'ORGANIZATION'>;
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
