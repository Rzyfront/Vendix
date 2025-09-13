# DomainDetectorService

Ubicación: `src/app/core/services/domain-detector.service.ts`

## Propósito
Determinar el tipo de dominio y el entorno de ejecución para activar rutas/funcionalidades apropiadas:
- Soporta dominios core de Vendix y subdominios (`vendix.com`, `admin.vendix.com`, `*.vendix.com`).
- Mapeos de desarrollo local (`localhost:4200` y hosts custom como `mordoc.localhost:4200`).
- Resolución vía API para dominios personalizados.
- Construcción de `DomainConfig` consistente.

## Flujo: detectDomain(hostname?)
1. Obtiene `hostname` actual.
2. Si es dominio core, retorna `handleVendixDomain(hostname)`.
3. Si es entorno dev, intenta un mapeo local.
4. Si no, consulta API `/api/public/domains/resolve/:hostname`.
5. Construye `DomainConfig` con `buildDomainConfig(host, domainInfo)`.

## Tipos de dominio y entornos
- VENDIX_LANDING, VENDIX_ADMIN
- ORG_LANDING, ORG_ADMIN
- STORE_ADMIN, STORE_ECOMMERCE
- Tipos: VENDIX_CORE, ORGANIZATION_ROOT, ORGANIZATION_SUBDOMAIN, STORE_SUBDOMAIN, STORE_CUSTOM

## Métodos clave
- isVendixCoreDomain(hostname): boolean
- handleVendixDomain(hostname): DomainConfig
- getDevelopmentMapping(hostname): DomainConfig | null
- resolveDomainFromAPI(hostname): Promise<DomainResolution | null>
- buildDomainConfig(hostname, domainInfo): DomainConfig
- getDomainInfo(config): metadatos legibles del entorno

## Notas
- `production=false` hardcodeado; ajustar a `environment.production` en el futuro.
- Dev mappings útiles para testing multi-tenant local.
