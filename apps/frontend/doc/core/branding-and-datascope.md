# Branding vs Scope de Datos

- Branding/tema: proviene del dominio (`DomainConfig.branding`) y se aplica con `ThemeService` (variables CSS, logos, SEO). No cambia por la organización activa del usuario.
- Scope de datos: proviene de la organización/tienda activa del usuario (por defecto `defaultOrganizationId/defaultStoreId`). Lo usan servicios de datos y guards por módulo.

## Caso especial: Owner en Vendix Landing
- DomainApp = VENDIX_LANDING → Branding = Vendix.
- Tras login, `PostLoginLayoutGuard` elige layout Admin (permitido por rol Owner).
- Se navega a `/admin` con branding Vendix y permisos/datos de su organización.

## Multi-org
- Si el usuario tiene varias organizaciones, mostrar selector al entrar a Admin/POS; persistir selección.
