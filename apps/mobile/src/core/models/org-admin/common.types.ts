// Common shared types for org-admin domain

export type ID = string;

export type ISODateString = string;

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore?: boolean;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface StatsCard {
  label: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon?: string;
  trend?: 'up' | 'down' | 'flat';
}

export interface SelectOption<T = string> {
  label: string;
  value: T;
}

export interface KeyValue {
  key: string;
  value: string;
}

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'VIEW'
  | 'EXPORT'
  | 'ACTIVATE'
  | 'DEACTIVATE'
  | 'APPROVE'
  | 'REJECT'
  | 'CANCEL'
  | 'POST'
  | 'VOID'
  | 'CLOSE'
  | 'REACTIVATE';

export interface MoneyAmount {
  amount: number;
  currency: string;
}

export interface Address {
  street?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
}
