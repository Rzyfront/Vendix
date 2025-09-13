# TenantConfigService

Ubicación: `src/app/core/services/tenant-config.service.ts`

## Propósito
Gestionar la configuración del tenant (organización/tienda) y exponer estado reactivo:
- Descarga y cachea configuración basada en `DomainConfig`.
- Expone `tenantConfig$` y `domainConfig$` (BehaviorSubject).
- Permite actualización parcial y verificación de features.

## Flujo principal
- loadTenantConfig(domainConfig):
  1. Guarda `domainConfig` en `domainConfig$`.
  2. Si es entorno Vendix (landing/admin), usa `getVendixDefaultConfig()`.
  3. Busca en cache por clave derivada `getCacheKey()`.
  4. Si no hay cache, `fetchTenantConfig()` contra API.
  5. Actualiza cache y `tenantConfig$`.

## API endpoints
- Organización: `/api/tenants/organization/:organizationSlug`
- Tienda: `/api/tenants/store/:organizationSlug/:storeSlug`

## Utilidades
- updateTenantConfig(partial)
- clearCache()
- isFeatureEnabled(name)
- getCurrentOrganization(), getCurrentStore()
- isVendixDomain(), getCurrentEnvironment()

## Notas
- Incluye tema/branding por defecto para Vendix (logos, colores, fontes, SEO).
- Cache por clave `environment-org-store`.
