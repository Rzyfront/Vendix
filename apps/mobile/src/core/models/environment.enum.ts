export enum DomainApp {
  VENDIX_LANDING = 'VENDIX_LANDING',
  VENDIX_ADMIN = 'VENDIX_ADMIN',
  ORG_LANDING = 'ORG_LANDING',
  ORG_ADMIN = 'ORG_ADMIN',
  STORE_LANDING = 'STORE_LANDING',
  STORE_ADMIN = 'STORE_ADMIN',
  STORE_ECOMMERCE = 'STORE_ECOMMERCE',
}

export type RoleName =
  | 'super_admin'
  | 'owner'
  | 'admin'
  | 'manager'
  | 'supervisor'
  | 'employee'
  | 'customer';
