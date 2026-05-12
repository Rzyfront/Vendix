import type { DrawerNavigationProp } from '@react-navigation/drawer';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

export type RootDrawerParamList = {
  '(store-admin)': undefined;
  '(org-admin)': undefined;
  '(super-admin)': undefined;
};

export type StoreAdminDrawerParamList = {
  dashboard: undefined;
  pos: undefined;
  products: undefined;
  orders: undefined;
  inventory: undefined;
  customers: undefined;
  invoicing: undefined;
  accounting: undefined;
  expenses: undefined;
  analytics: undefined;
  settings: undefined;
};

export type OrgAdminDrawerParamList = {
  dashboard: undefined;
  stores: undefined;
  users: undefined;
  orders: undefined;
  roles: undefined;
  subscriptions: undefined;
  settings: undefined;
};

export type SuperAdminDrawerParamList = {
  dashboard: undefined;
  organizations: undefined;
  users: undefined;
  stores: undefined;
  subscriptions: undefined;
  'ai-engine': undefined;
  monitoring: undefined;
  settings: undefined;
};

export type DrawerNavProp<T extends Record<string, undefined>> =
  DrawerNavigationProp<T>;

export type StackNavProp<T extends Record<string, undefined>> =
  NativeStackNavigationProp<T>;
