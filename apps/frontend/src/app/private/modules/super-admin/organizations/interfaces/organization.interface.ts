/**
 * Legacy interface barrel for the super-admin organization slice.
 *
 * @deprecated Use '../contracts/organization.contract' for new code. This file
 * is kept as a thin re-export for backward compatibility with existing
 * consumers.
 *
 * The single source of truth now lives in
 * `apps/frontend/src/app/private/modules/super-admin/organizations/contracts/organization.contract.ts`.
 * This file re-exports the contract's types under the historical names so
 * existing consumers keep compiling while we migrate.
 *
 * Adding a NEW field here is a bug: extend the contract instead.
 */

import type { Organization } from '../../../../../core/models/organization.model';

import type {
  OrganizationListItem as ContractOrganizationListItem,
  OrganizationDetail as ContractOrganizationDetail,
  OrganizationUpdatePayload,
  OrganizationCreatePayload,
  OrganizationState,
  OrganizationMode,
  OrganizationAccountType,
  OrganizationOperatingScope,
  OrganizationFiscalScope,
  OrganizationPrimaryAddress,
  OrganizationPartner,
  OrganizationFraud,
  EditableField,
  JsonbSettingsKey,
  AddressField,
  AddressPayload,
} from '../contracts/organization.contract';

import {
  OrganizationState as OrganizationStateValue,
  OrganizationMode as OrganizationModeValue,
  OrganizationAccountType as OrganizationAccountTypeValue,
  OrganizationOperatingScope as OrganizationOperatingScopeValue,
  OrganizationFiscalScope as OrganizationFiscalScopeValue,
  EDITABLE_FIELDS,
  JSONB_SETTINGS_KEYS,
  ADDRESS_FIELDS,
} from '../contracts/organization.contract';

/* -------------------------------------------------------------------------- */
/*  Re-export the const enums under their historical names                    */
/* -------------------------------------------------------------------------- */

export {
  EDITABLE_FIELDS,
  JSONB_SETTINGS_KEYS,
  ADDRESS_FIELDS,
  OrganizationStateValue as OrganizationStateConst,
  OrganizationModeValue as OrganizationModeConst,
  OrganizationAccountTypeValue as OrganizationAccountTypeConst,
  OrganizationOperatingScopeValue as OrganizationOperatingScopeConst,
  OrganizationFiscalScopeValue as OrganizationFiscalScopeConst,
};

/* -------------------------------------------------------------------------- */
/*  Type re-exports from the contract                                         */
/* -------------------------------------------------------------------------- */

export type {
  EditableField,
  JsonbSettingsKey,
  AddressField,
  AddressPayload,
  OrganizationState,
  OrganizationMode,
  OrganizationAccountType,
  OrganizationOperatingScope,
  OrganizationFiscalScope,
  OrganizationPrimaryAddress,
  OrganizationPartner,
  OrganizationFraud,
  OrganizationCreatePayload,
  OrganizationUpdatePayload,
};

// Historical aliases — `OrganizationListItem` and `OrganizationDetail` come
// straight from the contract.
export type OrganizationListItem = ContractOrganizationListItem;
export type OrganizationDetail = ContractOrganizationDetail;

/* -------------------------------------------------------------------------- */
/*  Legacy types preserved for backward compatibility                         */
/* -------------------------------------------------------------------------- */

/**
 * Historical `OrganizationMode` was a union type. The contract now exports
 * both the const + type. Re-export the historical alias so consumers like
 * `organizations.component.ts` keep compiling.
 */
export type { OrganizationMode as OrganizationModeUnion };

/**
 * Historical alias for the rich detail shape. Was `OrganizationDetails` in
 * the legacy interface (note the trailing `s`). Prefer
 * `OrganizationDetail` from the contract for new code.
 *
 * The historical interface extended `Organization` from the core model and
 * carried `stats` + `recentActivity` arrays. We keep it standalone to avoid
 * forcing a structural compatibility with the normalized `OrganizationDetail`
 * shape (different keys, different counts, different address shape).
 */
export interface OrganizationDetails extends Organization {
  stats: {
    totalStores: number;
    activeStores: number;
    totalUsers: number;
    totalProducts: number;
    totalOrders: number;
    totalRevenue: number;
  };
  recentActivity: Array<{
    id: number;
    action: string;
    timestamp: string;
    user: {
      name: string;
      email: string;
    };
  }>;
}

/* -------------------------------------------------------------------------- */
/*  Form / query / column helpers preserved from the legacy file              */
/* -------------------------------------------------------------------------- */

export interface CreateOrganizationForm {
  basicInfo: {
    name: string;
    email: string;
    phone?: string;
    website?: string;
    description?: string;
  };
  legalInfo: {
    legalName?: string;
    taxId?: string;
  };
  branding: {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    fontFamily: string;
    logo?: File;
  };
  settings: {
    allowPublicStore: boolean;
    allowMultipleStores: boolean;
    maxStores: number;
    maxUsers: number;
  };
  limits: {
    products: number;
    orders: number;
    storage: number;
    bandwidth: number;
  };
  features: {
    ecommerce: boolean;
    inventory: boolean;
    analytics: boolean;
    multiCurrency: boolean;
    taxManagement: boolean;
    shippingManagement: boolean;
  };
}

export interface OrganizationFilters {
  search: string;
  status: string;
  plan: string;
  dateRange: {
    start: Date;
    end: Date;
  };
}

export interface OrganizationTableColumn {
  key: string;
  label: string;
  sortable: boolean;
  width?: string;
}

export interface OrganizationTableAction {
  label: string;
  icon: string;
  action: (organization: OrganizationListItem) => void;
  disabled?: (organization: OrganizationListItem) => boolean;
  danger?: boolean;
}
