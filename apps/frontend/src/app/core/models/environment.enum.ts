// ============================================================================
// Domain Type (Legacy - para compatibilidad con domain_type_enum del backend)
// ============================================================================
export enum DomainType {
  VENDIX_CORE = 'vendix_core',
  ORGANIZATION = 'organization',
  STORE = 'store',
  ECOMMERCE = 'ecommerce',
}

// ============================================================================
// App Type (NUEVO ESTÁNDAR UNIFICADO)
// ============================================================================
// Este enum es la única fuente de verdad para determinar el tipo de aplicación.
// Sincronizado con app_type_enum del backend Prisma schema.
// Usado en: domain_settings.app_type, user_settings.app_type, localStorage
export enum AppType {
  VENDIX_LANDING = 'VENDIX_LANDING',   // Landing principal de Vendix
  VENDIX_ADMIN = 'VENDIX_ADMIN',       // Admin super usuario de Vendix
  ORG_LANDING = 'ORG_LANDING',         // Landing de organización
  ORG_ADMIN = 'ORG_ADMIN',             // Admin de organización
  STORE_LANDING = 'STORE_LANDING',     // Landing de tienda
  STORE_ADMIN = 'STORE_ADMIN',         // Admin de tienda
  STORE_ECOMMERCE = 'STORE_ECOMMERCE', // Ecommerce de tienda
  STORE_DELIVERY = 'STORE_DELIVERY',   // App interna de reparto (rol carrier)
  STORE_PRODUCT_PAGE = 'STORE_PRODUCT_PAGE', // Apps: página de un producto en su propio dominio
  STORE_SERVICE_PAGE = 'STORE_SERVICE_PAGE', // Apps: servicios y agenda en su propio dominio
  STORE_BOOKING = 'STORE_BOOKING', // Apps: reservas y check-in en línea del hotel en su propio dominio
  STORE_HOME = 'STORE_HOME', // Apps: inicio de tienda en {tienda}-store (portada con marca y botón de ingreso)
}

// ============================================================================
// AppEnvironment (Alias para compatibilidad - USAR AppType preferiblemente)
// ============================================================================
// Exportar como alias de tipo Y como valor para compatibilidad completa
export type AppEnvironment = AppType;
export const AppEnvironment = AppType;
