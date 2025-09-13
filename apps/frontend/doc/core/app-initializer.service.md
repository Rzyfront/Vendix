# AppInitializerService

Ubicación: `src/app/core/services/app-initializer.service.ts`

## Propósito
Orquestar la inicialización del frontend en entorno multi-tenant y multi-entorno (Vendix landing/admin, organización, tienda admin, e-commerce):
- Detecta el dominio y resuelve el entorno actual.
- Carga la configuración del tenant (organización/tienda) y aplica tema/branding.
- Prepara rutas y servicios según el entorno.
- Maneja errores y permite reinicialización.

## Flujo principal: initializeApp()
1. Detectar dominio actual con `DomainDetectorService.detectDomain()` ⇒ `DomainConfig`.
2. Cargar configuración del tenant con `TenantConfigService.loadTenantConfig(domainConfig)`.
3. Aplicar tema y branding con `ThemeService.applyTenantConfiguration(tenantConfig)`.
4. Configurar rutas (placeholder) según entorno con `configureRoutesForEnvironment()`.
5. Inicializar servicios específicos por entorno con `initializeEnvironmentServices()`.
6. En caso de error, `handleInitializationError()` (redirige a Vendix o navega a /error).

## Métodos clave
- isVendixCoreEnvironment(environment): boolean
- configureRoutesForEnvironment(domainConfig): Promise<void>
- getRouteConfigForEnvironment(environment): any
  - Devuelve módulos por entorno: landing, admin, organization, store, ecommerce, etc.
- initializeEnvironmentServices(domainConfig): Promise<void>
  - Inicializadores específicos: Vendix Landing/Admin, Org Landing/Admin, Store Admin, Store E-commerce.
- handleInitializationError(error): Promise<void>
- reinitializeApp(): Promise<void>
- getAppState(): { domain, tenant, theme, timestamp }
- isAppInitialized(): boolean

## Dependencias
- DomainDetectorService
- TenantConfigService
- ThemeService
- Router

## Notas
- La configuración dinámica de rutas está preparada pero aún loguea/describe; puede evolucionar a `router.resetConfig(...)` según entorno.
- Pensado para ejecutarse temprano (APP_INITIALIZER o bootstrap custom).
