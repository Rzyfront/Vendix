/**
 * Single source of truth for the super-admin store shape.
 *
 * TODO(zod-migration): the plan calls for Zod schemas + `z.infer`. Zod is not
 * yet in the frontend dependency tree, so this file uses TypeScript types as
 * the contract surface and `as const` tuples for editable fields. Migrating to
 * Zod once `apps/frontend/package.json` gains the `zod` dep will not change the
 * exported type aliases — only the runtime validators will arrive.
 */

import type { AddressPayload } from '../../../../../shared/components/address-form-fields/address-form-fields.component';
import { STORE_INDUSTRIES } from '../../../../../shared/constants/industry-modules.constant';

/* -------------------------------------------------------------------------- */
/*  Enums (mirror Prisma persisted values — DO NOT rename)                    */
/* -------------------------------------------------------------------------- */

export const StoreType = {
  PHYSICAL: 'physical',
  ONLINE: 'online',
  HYBRID: 'hybrid',
  POPUP: 'popup',
  KIOSKO: 'kiosko',
} as const;
export type StoreType = (typeof StoreType)[keyof typeof StoreType];

export const StoreState = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  DRAFT: 'draft',
  SUSPENDED: 'suspended',
  ARCHIVED: 'archived',
} as const;
export type StoreState = (typeof StoreState)[keyof typeof StoreState];

/**
 * Derivada de `STORE_INDUSTRIES`, no escrita a mano.
 *
 * Había tres copias de esta unión en el frontend, una de ellas con sólo cuatro
 * industrias —le faltaba `gym` desde que se añadió— y ninguna avisaba: una unión
 * a mano no falla al quedarse corta, sólo rechaza el valor nuevo en el sitio más
 * lejano al cambio. Derivándola, agregar una industria al constante compartido
 * la propaga sola y olvidarla es imposible.
 */
export type StoreIndustry = (typeof STORE_INDUSTRIES)[number];

/* -------------------------------------------------------------------------- */
/*  Option shapes (returned by lookup endpoints)                              */
/* -------------------------------------------------------------------------- */

export interface CurrencyOption {
  code: string;
  name: string;
  symbol: string;
}

export interface OrganizationOption {
  id: number;
  name: string;
  slug: string;
}

export interface ManagerOption {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
}

/* -------------------------------------------------------------------------- */
/*  Address payload — mirrors `AddressPayload` from app-address-form-fields   */
/* -------------------------------------------------------------------------- */

export type { AddressPayload };

/* -------------------------------------------------------------------------- */
/*  StoreListItem (list shape returned by GET /superadmin/stores)             */
/* -------------------------------------------------------------------------- */

export interface StoreListItem {
  id: number;
  name: string;
  slug: string;
  store_code: string;
  store_type: StoreType;
  industries?: StoreIndustry[];
  timezone: string;
  is_active: boolean;
  manager_user_id?: number;
  organization_id: number;
  logo_url?: string;
  domain?: string | null;
  created_at: string;
  updated_at: string;
  settings?: StoreSettings;
  organizations?: {
    id: number;
    name: string;
    slug: string;
  };
  addresses?: Array<{
    id: number;
    store_id: number;
    address_line1: string;
    address_line2?: string;
    city: string;
    state_province: string;
    country_code: string;
    postal_code: string;
    phone_number?: string;
    type: string;
    is_primary: boolean;
    latitude?: number;
    longitude?: number;
    organization_id?: number;
    user_id?: number;
    municipality_code?: string | null;
  }>;
  _count?: {
    products: number;
    orders: number;
    store_users: number;
  };
}

/* -------------------------------------------------------------------------- */
/*  StoreDetail (normalized GET response — see plan §A.3)                     */
/* -------------------------------------------------------------------------- */

export interface StoreDetailCurrency extends CurrencyOption {}

export interface StoreDetailManager extends ManagerOption {}

export interface StoreDetailOrganization extends OrganizationOption {}

export interface StoreDetailPrimaryAddress {
  id: number;
  store_id: number;
  address_line1: string;
  address_line2?: string;
  city: string;
  state_province: string;
  country_code: string;
  postal_code: string;
  phone_number?: string;
  type: string;
  is_primary: boolean;
  latitude?: number;
  longitude?: number;
  organization_id?: number;
  user_id?: number;
  municipality_code?: string | null;
}

export interface StoreDetail extends StoreListItem {
  organization?: StoreDetailOrganization;
  manager?: StoreDetailManager | null;
  currency?: StoreDetailCurrency | null;
  primary_address?: StoreDetailPrimaryAddress | null;
  description?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  currency_code?: string | null;
  color_primary?: string | null;
  color_secondary?: string | null;
  color_accent?: string | null;
}

/* -------------------------------------------------------------------------- */
/*  StoreSettings (JSONB payload on store_settings.settings)                  */
/* -------------------------------------------------------------------------- */

export interface OperatingHours {
  monday?: { open: string; close: string };
  tuesday?: { open: string; close: string };
  wednesday?: { open: string; close: string };
  thursday?: { open: string; close: string };
  friday?: { open: string; close: string };
  saturday?: { open: string; close: string };
  sunday?: { open: string; close: string };
}

export interface StoreSettings {
  description?: string;
  email?: string;
  phone?: string;
  website?: string;
  currency_code?: string;
  color_primary?: string;
  color_secondary?: string;
  color_accent?: string;
  // Legacy keys retained for backward-compat with pre-existing stores.
  theme?: string;
  notifications?: boolean;
  language?: string;
  currency_format?: string;
  email_notifications?: boolean;
  sms_notifications?: boolean;
  inventory_alerts?: boolean;
  low_stock_threshold?: number;
  [key: string]: unknown;
}

/* -------------------------------------------------------------------------- */
/*  Editable / JSONB contract tuples                                          */
/* -------------------------------------------------------------------------- */

/**
 * Every editable field the frontend may send in `PATCH /superadmin/stores/:id`
 * or `POST /superadmin/stores`. Mirrors `UpdateStoreDto` / `CreateStoreDto` in
 * `apps/backend/src/domains/store/stores/dto/index.ts`.
 */
export const EDITABLE_FIELDS = [
  'name',
  'slug',
  'store_code',
  'logo_url',
  'color_primary',
  'color_secondary',
  'color_accent',
  'domain',
  'timezone',
  'currency_code',
  'operating_hours',
  'store_type',
  'industries',
  'is_active',
  'manager_user_id',
  'description',
  'email',
  'phone',
  'website',
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
  'organization_id',
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

/**
 * Keys that the backend persists inside `store_settings.settings` JSONB
 * instead of as columns on `stores`.
 */
export const JSONB_SETTINGS_KEYS = [
  'description',
  'email',
  'phone',
  'website',
  'currency_code',
  'color_primary',
  'color_secondary',
  'color_accent',
] as const;
export type JsonbSettingsKey = (typeof JSONB_SETTINGS_KEYS)[number];

/* -------------------------------------------------------------------------- */
/*  Create / Update payloads                                                  */
/* -------------------------------------------------------------------------- */

export interface StoreCreatePayload {
  organization_id: number;
  name: string;
  slug: string;
  store_code: string;
  store_type: StoreType;
  industries?: StoreIndustry[];
  is_active?: boolean;
  logo_url?: string;
  color_primary?: string;
  color_secondary?: string;
  color_accent?: string;
  domain?: string;
  timezone?: string;
  currency_code?: string;
  operating_hours?: OperatingHours;
  manager_user_id?: number;
  description?: string;
  email?: string;
  phone?: string;
  website?: string;
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

  // ------------------------------------------------------------------
  // Legacy single-string address fields — kept so the existing
  // store-create-modal / store-edit-modal / stores.component code keeps
  // compiling until the modal rewrite (plan §B.5) lands. Both fields are
  // deprecated and SHOULD NOT be sent by new code. The backend DTO will
  // ignore them (whitelist:true) so the data never reaches the database.
  /** @deprecated Use `address_line1` (and `address_line2`, `city`, `state_province`, `country_code`). */
  address?: string;
  /** @deprecated Use `country_code` (ISO-3166-1 alpha-2). */
  country?: string;
}

/**
 * `StoreUpdatePayload` — every field is optional. The backend DTO uses
 * class-validator decorators; this contract mirrors the same shape so the
 * `safeParse` checks in the HTTP layer catch drift early.
 */
export type StoreUpdatePayload = Partial<StoreCreatePayload>;