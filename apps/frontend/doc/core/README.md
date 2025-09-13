# Core

Descripción general del núcleo de la app (servicios compartidos, guardas e interceptores) que habilitan multi-tenant, detección de dominio, configuración de tenant, temas/branding y seguridad.

Servicios clave:
- AppInitializerService: orquesta la inicialización multi-entorno.
- DomainDetectorService: resuelve el entorno a partir del dominio.
- TenantConfigService: obtiene y cachea la configuración del tenant.
- ThemeService: aplica variables CSS/SEO/branding.
- StoreService: estado de tienda, obtiene por dominio/slug.
- AuthService (core): manejo de sesión, tokens y redirecciones.
- AdminGuard: protege rutas de administración.
- AuthInterceptor: añade Bearer token y refresca en 401.
