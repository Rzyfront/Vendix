/**
 * Legacy interface barrel for the super-admin store slice.
 *
 * The single source of truth now lives in
 * `apps/frontend/src/app/private/modules/super-admin/stores/contracts/store.contract.ts`.
 * This file re-exports the contract's types under the historical names so
 * existing consumers keep compiling while we migrate.
 *
 * Adding a NEW field here is a bug: extend the contract instead.
 */

import type {
  StoreListItem,
  StoreUpdatePayload,
  StoreCreatePayload,
  StoreDetail,
  StoreSettings,
  EditableField,
  JsonbSettingsKey,
  OperatingHours,
  CurrencyOption,
  OrganizationOption,
  ManagerOption,
  AddressPayload,
  StoreIndustry,
} from '../contracts/store.contract';

// Bring the *value* form of the const enums into scope under their historical
// names so consumers of this file can still write `StoreType.PHYSICAL` etc.
import { StoreType, StoreState } from '../contracts/store.contract';

export {
  StoreType,
  StoreState,
  EDITABLE_FIELDS,
  JSONB_SETTINGS_KEYS,
} from '../contracts/store.contract';
export type {
  EditableField,
  JsonbSettingsKey,
  StoreIndustry,
  CurrencyOption,
  OrganizationOption,
  ManagerOption,
  AddressPayload,
  OperatingHours,
  StoreListItem,
  StoreDetail,
  StoreSettings,
  StoreCreatePayload,
  StoreUpdatePayload,
} from '../contracts/store.contract';

// Historical type aliases (value + type re-exports under the old names).
export type StoreTypeAlias = StoreType;
export type StoreStateAlias = StoreState;

// Re-export the most-used types under the historical names.
export type Store = StoreDetail;
export type StoreListItemAlias = StoreListItem;
export type UpdateStoreDto = StoreUpdatePayload;
export type CreateStoreDto = StoreCreatePayload;

// New type alias added by the plan (not previously in this file).
export type StoreDetailContract = StoreDetail;

/* -------------------------------------------------------------------------- */
/*  Domain helpers preserved from the legacy file                            */
/* -------------------------------------------------------------------------- */

export interface StoreQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  store_type?: StoreTypeAlias;
  is_active?: boolean;
  organization_id?: number;
  include_non_production?: boolean;
}

export interface StoreDashboardDto {
  start_date?: string;
  end_date?: string;
}

export interface StoreDashboardResponse {
  store_id: number;
  metrics: {
    total_orders: number;
    total_revenue: number;
    low_stock_products: number;
    active_customers: number;
    revenue_today: number;
    revenue_this_week: number;
    average_order_value: number;
  };
  recent_orders: Array<any>;
  top_products: Array<any>;
  sales_chart: Array<any>;
}

export interface StoreSettingsUpdateDto {
  settings: Partial<StoreSettings>;
}

export interface StoreFilters {
  search: string;
  store_type: StoreTypeAlias;
  is_active: boolean;
  organization_id: number;
  dateRange: {
    start: Date;
    end: Date;
  };
}

export interface StoreTableColumn {
  key: string;
  label: string;
  sortable: boolean;
  width?: string;
}

export interface StoreTableAction {
  label: string;
  icon: string;
  action: (store: StoreListItemAlias) => void;
  disabled?: (store: StoreListItemAlias) => boolean;
  danger?: boolean;
}

export interface StoreStats {
  total_stores: number;
  active_stores: number;
  inactive_stores: number;
  suspended_stores: number;
  draft_stores: number;
  total_revenue: number;
  total_orders: number;
  total_products: number;
}

export interface PaginatedStoresResponse {
  data: StoreListItemAlias[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

/**
 * Historical alias for the enriched detail shape (was `StoreDetails` in the
 * legacy interface). Prefer `StoreDetail` from the contract for new code.
 *
 * This interface is **standalone** on purpose: the legacy `addresses[]` shape
 * (`street` + `country`) does not match the normalized address shape returned
 * by `StoreDetail.addresses[]` (`address_line1` + `country_code`), so an
 * `extends StoreDetailContract` would trip TS2430. Both shapes exist in the
 * wild — the modal rewrite (plan §B.5) collapses them onto the normalized
 * one. Until then, this stays a standalone record.
 */
export interface StoreDetails {
  addresses?: Array<{
    id: number;
    street: string;
    city: string;
    country: string;
    postal_code: string;
    is_primary: boolean;
  }>;
  store_users?: Array<{
    id: number;
    user_id: number;
    role: string;
    user: {
      id: number;
      name: string;
      email: string;
    };
  }>;
}