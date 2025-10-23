import { Organization } from '../../../../../core/models/organization.model';

export interface OrganizationListItem {
  id: number;
  name: string;
  slug: string;
  email: string;
  status: Organization['status'];
  plan: Organization['plan'];
  createdAt: string;
  settings: {
    maxStores: number;
    maxUsers: number;
    allowMultipleStores: boolean;
  };
}

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