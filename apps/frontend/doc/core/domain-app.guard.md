# DomainAppGuard

Decide la ruta inicial para usuarios anónimos según `DomainConfig.app` y aplica el branding del tenant.

## Responsabilidades
- Obtener/esperar `DomainConfig` desde `DomainDetectorService` (lee `window.location.host`).
- Guardar `domainConfig$` en `TenantConfigService` y llamar `ThemeService.applyTenantConfiguration()`.
- Calcular la URL pública inicial usando `LayoutRouterService.computeHomeUrlFor(domainApp)`.
- Redirigir a esa URL (p. ej. '/', '/shop/:org/:store', '/o/:org/admin', etc.).

## Notas
- Debe funcionar en SSR y CSR.
- No asume sesión; sólo decide home pública.
- Si `app` es desconocido, fallback a '/' (landing genérica) y reportar a observabilidad.
