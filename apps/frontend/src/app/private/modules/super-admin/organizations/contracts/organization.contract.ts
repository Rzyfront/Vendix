/**
 * Single source of truth for the super-admin organization shape.
 *
 * TODO(zod-migration): the plan calls for Zod schemas + `z.infer`. Zod is not
 * yet in the frontend dependency tree, so this file uses TypeScript types as
 * the contract surface and `as const` tuples for editable fields. Migrating to
 * Zod once `apps/frontend/package.json` gains the `zod` dep will not change the
 * exported type aliases — only the runtime validators will arrive.
 */

import type { AddressPayload } from '../../../../../shared/components/address-form-fields/address-form-fields.component';

/* -------------------------------------------------------------------------- */
/*  Enums (mirror Prisma persisted values — DO NOT rename)                    */
/* -------------------------------------------------------------------------- */

/**
 * Persisted organization lifecycle state. Values mirror
 * `organization_state_enum` in Prisma. `DRAFT` exists in the DB but the legacy
 * TS surface only exposed `active | inactive | suspended | pending`.
 */
export const OrganizationState = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  SUSPENDED: 'suspended',
  DRAFT: 'draft',
  ARCHIVED: 'archived',
} as const;
export type OrganizationState = (typeof OrganizationState)[keyof typeof OrganizationState];

export const OrganizationMode = {
  PRODUCTION: 'production',
  DEMO: 'demo',
  TEST: 'test',
} as const;
export type OrganizationMode = (typeof OrganizationMode)[keyof typeof OrganizationMode];

export const OrganizationAccountType = {
  SINGLE_STORE: 'SINGLE_STORE',
  MULTI_STORE_ORG: 'MULTI_STORE_ORG',
} as const;
export type OrganizationAccountType =
  (typeof OrganizationAccountType)[keyof typeof OrganizationAccountType];

export const OrganizationOperatingScope = {
  STORE: 'STORE',
  ORGANIZATION: 'ORGANIZATION',
} as const;
export type OrganizationOperatingScope =
  (typeof OrganizationOperatingScope)[keyof typeof OrganizationOperatingScope];

export const OrganizationFiscalScope = {
  STORE: 'STORE',
  ORGANIZATION: 'ORGANIZATION',
} as const;
export type OrganizationFiscalScope =
  (typeof OrganizationFiscalScope)[keyof typeof OrganizationFiscalScope];

/* -------------------------------------------------------------------------- */
/*  Address payload — mirrors `AddressPayload` from app-address-form-fields   */
/* -------------------------------------------------------------------------- */

export type { AddressPayload };

/* -------------------------------------------------------------------------- */
/*  Primary address sub-object (normalized response shape)                    */
/* -------------------------------------------------------------------------- */

export interface OrganizationPrimaryAddress {
  id: number;
  organization_id: number;
  address_line1: string;
  address_line2?: string | null;
  city: string;
  state_province?: string | null;
  country_code: string;
  postal_code?: string | null;
  municipality_code?: string | null;
  department_code?: string | null;
  phone_number?: string | null;
  type: string;
  is_primary: boolean;
  latitude?: number | string | null;
  longitude?: number | string | null;
}

/* -------------------------------------------------------------------------- */
/*  Partner + Fraud sub-objects                                               */
/* -------------------------------------------------------------------------- */

export interface OrganizationPartner {
  is_partner: boolean;
  partner_settings: Record<string, unknown> | null;
  partner_since: string | null;
}

export interface OrganizationFraud {
  fraud_blocked: boolean;
  fraud_blocked_at: string | null;
  fraud_blocked_reason: string | null;
  chargeback_count: number;
}

/* -------------------------------------------------------------------------- */
/*  OrganizationListItem (list shape returned by GET /superadmin/organizations) */
/* -------------------------------------------------------------------------- */

/**
 * Rich list-item shape. The legacy list only exposed `id, name, slug, email,
 * status, plan, mode, createdAt, settings`; the backend now returns the full
 * org row so the table can render reasonable columns without a detail
 * round-trip. Fields marked optional may be absent in older rows.
 */
export interface OrganizationListItem {
  id: number;
  name: string;
  slug: string;
  email: string;
  status: OrganizationState;
  mode: OrganizationMode;
  phone?: string | null;
  website?: string | null;
  logo_url?: string | null;
  description?: string | null;
  legal_name?: string | null;
  tax_id?: string | null;
  document_type?: string | null;
  verification_digit?: string | null;
  person_type?: string | null;
  tax_regime?: string | null;
  fiscal_responsibilities?: string[];
  ciiu_code?: string | null;
  account_type?: OrganizationAccountType;
  operating_scope?: OrganizationOperatingScope;
  fiscal_scope?: OrganizationFiscalScope;
  is_partner?: boolean;
  fraud_blocked?: boolean;
  createdAt: string;
  updatedAt?: string;
  _count?: { stores: number; users: number };
  /**
   * Tenant limits (legacy — surfaced in the org card). The backend doesn't
   * expose these as first-class columns yet; the parent `loadOrganizations`
   * fills them with sensible defaults.
   */
  settings?: {
    maxStores: number;
    maxUsers: number;
    allowMultipleStores: boolean;
  };
}

/* -------------------------------------------------------------------------- */
/*  OrganizationDetail (normalized GET response — see plan §A.3)              */
/* -------------------------------------------------------------------------- */

export interface OrganizationDetail extends OrganizationListItem {
  // DIAN fiscal identity
  document_type?: string | null;
  verification_digit?: string | null;
  person_type?: string | null;
  tax_regime?: string | null;
  fiscal_responsibilities?: string[];
  ciiu_code?: string | null;
  // Scopes
  account_type?: OrganizationAccountType;
  operating_scope?: OrganizationOperatingScope;
  fiscal_scope?: OrganizationFiscalScope;
  // Branding (top-level aliases of `organization_settings.settings.branding.*`)
  color_primary?: string | null;
  color_secondary?: string | null;
  color_accent?: string | null;
  // Partner
  is_partner?: boolean;
  partner_settings?: Record<string, unknown> | null;
  partner_since?: string | null;
  // Onboarding
  has_consumed_trial?: boolean;
  // Fraud
  fraud_blocked?: boolean;
  fraud_blocked_at?: string | null;
  fraud_blocked_reason?: string | null;
  chargeback_count?: number;
  // Primary address (normalized — only the billing/primary one)
  primary_address?: OrganizationPrimaryAddress | null;
  // Counts (richer set for the detail view)
  _count: { stores: number; users: number; addresses: number; suppliers: number; employees: number };
  created_at: string;
  updated_at: string;
}

/* -------------------------------------------------------------------------- */
/*  Editable / JSONB contract tuples                                          */
/* -------------------------------------------------------------------------- */

/**
 * Every editable field the frontend may send in
 * `PATCH /superadmin/organizations/:id` or `POST /superadmin/organizations`.
 * Mirrors `UpdateOrganizationDto` / `CreateOrganizationDto` in
 * `apps/backend/src/domains/superadmin/organizations/dto/index.ts`.
 */
export const EDITABLE_FIELDS = [
  // Identity + contact
  'name',
  'slug',
  'legal_name',
  'tax_id',
  'email',
  'phone',
  'website',
  'logo_url',
  'description',
  // Lifecycle + mode
  'state',
  'mode',
  // DIAN fiscal identity
  'document_type',
  'verification_digit',
  'person_type',
  'tax_regime',
  'fiscal_responsibilities',
  'ciiu_code',
  // Scopes
  'account_type',
  'operating_scope',
  'fiscal_scope',
  // Partner
  'is_partner',
  'partner_settings',
  'partner_since',
  // Fraud
  'fraud_blocked',
  'fraud_blocked_reason',
  // Onboarding
  'onboarding',
  'has_consumed_trial',
  // Address (routed to `addresses[]`)
  'address_line1',
  'address_line2',
  'city',
  'state_province',
  'country_code',
  'department_code',
  'municipality_code',
  'postal_code',
  'latitude',
  'longitude',
  // Branding (routed to `organization_settings.settings.branding.*`)
  'color_primary',
  'color_secondary',
  'color_accent',
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

/**
 * Keys that the backend persists inside `organization_settings.settings` JSONB
 * instead of as columns on `organizations`.
 */
export const JSONB_SETTINGS_KEYS = [
  'color_primary',
  'color_secondary',
  'color_accent',
] as const;
export type JsonbSettingsKey = (typeof JSONB_SETTINGS_KEYS)[number];

/**
 * Keys the backend routes to the primary `addresses` row (organization_id =
 * :id, is_primary = true). Mirrors `ORG_ADDRESS_DTO_KEYS` on the backend.
 */
export const ADDRESS_FIELDS = [
  'address_line1',
  'address_line2',
  'city',
  'state_province',
  'country_code',
  'department_code',
  'municipality_code',
  'postal_code',
  'latitude',
  'longitude',
] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];

/* -------------------------------------------------------------------------- */
/*  Create / Update payloads                                                  */
/* -------------------------------------------------------------------------- */

export interface OrganizationCreatePayload {
  name: string;
  email: string;
  slug?: string;
  legal_name?: string;
  tax_id?: string;
  document_type?: string;
  verification_digit?: string;
  person_type?: string;
  tax_regime?: string;
  fiscal_responsibilities?: string[];
  ciiu_code?: string;
  phone?: string;
  website?: string;
  logo_url?: string;
  description?: string;
  state?: OrganizationState;
  mode?: OrganizationMode;
  account_type?: OrganizationAccountType;
  operating_scope?: OrganizationOperatingScope;
  fiscal_scope?: OrganizationFiscalScope;
  is_partner?: boolean;
  partner_settings?: Record<string, unknown>;
  partner_since?: string;
  fraud_blocked?: boolean;
  fraud_blocked_reason?: string;
  onboarding?: boolean;
  has_consumed_trial?: boolean;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state_province?: string;
  country_code?: string;
  department_code?: string;
  municipality_code?: string;
  postal_code?: string;
  latitude?: number;
  longitude?: number;
  color_primary?: string;
  color_secondary?: string;
  color_accent?: string;
}

/**
 * `OrganizationUpdatePayload` — every field is optional. The backend DTO uses
 * class-validator decorators; this contract mirrors the same shape so the
 * `safeParse` checks in the HTTP layer catch drift early.
 */
export type OrganizationUpdatePayload = Partial<OrganizationCreatePayload>;
