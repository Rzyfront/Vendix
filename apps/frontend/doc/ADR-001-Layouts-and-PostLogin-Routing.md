# ADR-001: Layouts y Routing Post-Login en entorno Multi-Tenant

Estado: Propuesto
Fecha: 2025-09-21

## Decisión
- La "home view" inicial se determina por el `DomainConfig.app` resuelto en tiempo de arranque (antes de cualquier sesión).
- El "layout post-login" NO depende del `app`, sino de (1) los roles del usuario y (2) su preferencia de layout. Se decide mediante una capa de guardas y un servicio de enrutamiento de layout.
- El branding/tema (logo, colores) proviene SIEMPRE del dominio resuelto, independiente de la organización/tienda activa del usuario.
- El ámbito de datos (qué organización/tienda se consulta) proviene de la organización/tienda del usuario (o la elegida si tiene varias), no del branding del dominio.

## Contexto
El backend retorna para cada hostname un `DomainConfig` con una clave `app` que indica el tipo de aplicación a mostrar como página de inicio:
- VENDIX_LANDING: Marketing, registro, login
- VENDIX_ADMIN: Gestión global de organizaciones
- ORG_LANDING: Landing personalizado de organización
- ORG_ADMIN: Dashboard organizacional
- STORE_LANDING: Tienda online pública
- STORE_ADMIN: Gestión de tienda (productos, pedidos, etc.)
- STORE_ECOMMERCE: Tienda online con carrito y checkout

Requisito clave:
- Tras iniciar sesión, el layout se determina por roles y preferencia del usuario, con validación de acceso. Un usuario con preferencia "admin" debe poder verla si sus roles/filtros lo permiten; si no, se aplica un fallback permitido.
- Caso especial: si un Owner inicia sesión en el dominio de Vendix Landing, verá el layout Admin pero con branding de Vendix y permisos/datos de su organización.

## Glosario
- DomainApp: valor de `DomainConfig.app`.
- Layout: cascarón de UI (Admin, POS, Storefront, SuperAdmin, Auth) que envuelve vistas.
- Branding Context: tema/SEO/logos que derivan del dominio resuelto.
- Data Scope: organización/tienda activa para consultas.

## Tipos propuestos (shared)
- enum DomainApp { VENDIX_LANDING, VENDIX_ADMIN, ORG_LANDING, ORG_ADMIN, STORE_LANDING, STORE_ADMIN, STORE_ECOMMERCE }
- enum LayoutKey { auth, admin, pos, storefront, superadmin }

## Mapeo DomainApp → Ruta inicial (anónimo)
- VENDIX_LANDING → / (landing) → Layout: auth/storefront minimal según diseño
- VENDIX_ADMIN → /sa (SuperAdmin) o /admin global (según segmentación)
- ORG_LANDING → /o/:orgSlug (landing de org)
- ORG_ADMIN → /o/:orgSlug/admin (dashboard)
- STORE_LANDING → /shop/:org/:store (home pública)
- STORE_ADMIN → /o/:org/:store/admin (backoffice)
- STORE_ECOMMERCE → /shop/:org/:store (home carrito)

Este enrutamiento se determina por un guard/canMatch "DomainAppGuard" antes de cargar features.

## Acceso de roles a layouts (matriz)
- super_admin → [superadmin, admin, pos, storefront]
- owner → [admin, pos, storefront]
- admin → [admin, pos, storefront]
- manager → [admin, pos]
- supervisor → [pos]
- employee → [pos]
- customer → [storefront]

Defaults de preferencia si el usuario no define una:
- super_admin → superadmin
- owner/admin → admin
- manager/supervisor/employee → pos
- customer → storefront

## Algoritmo de selección de Layout post-login
1. Obtener `roles` del usuario y su `preferredLayout` (puede venir en el perfil).
2. Construir `allowedLayouts` según roles.
3. Si `preferredLayout ∈ allowedLayouts` → usarlo.
4. Si no, usar el primer layout de `allowedLayouts` según prioridad: superadmin > admin > pos > storefront.
5. Si `allowedLayouts` está vacío → 403 o redirigir a página de acceso denegado.
6. Convertir `LayoutKey` en una URL de destino con contexto (org/store actual si aplica) usando `LayoutRouterService`.

Pseudo-código:
```
const allowed = getAllowedLayoutsForRoles(user.roles);
const targetLayout = allowed.includes(user.prefLayout)
  ? user.prefLayout
  : pickByPriority(allowed);
return layoutToUrl(targetLayout, { domainApp, org: activeOrg, store: activeStore });
```

## Branding vs Ámbito de Datos
- ThemeService aplica variables CSS, logos y SEO tomando `TenantConfig.branding` que proviene de `DomainDetectorService → TenantConfigService`.
- DataScopeService/AuthService mantienen `activeOrganization`/`activeStore` para filtrar datos.
- Caso especial (Owner en Vendix Landing):
  - DomainApp = VENDIX_LANDING → Branding = Vendix.
  - Tras login, `PostLoginLayoutGuard` elige `admin` (permitido por rol Owner) y navega a `/admin`.
  - Las vistas usan `activeOrganization = user.defaultOrganization` para datos.
  - Resultado: UI con branding Vendix, datos de su organización.

## Guards y Servicios
- DomainAppGuard (root):
  - canMatch/canActivate en rutas raíz. Resuelve `DomainConfig` via `DomainDetectorService` y decide la ruta pública por `app`.
  - Persistir `domainConfig$` en `TenantConfigService` y aplicar `ThemeService`.
- AuthGuard (genérico): verifica sesión.
- PostLoginLayoutGuard:
  - Al entrar desde callback o `/post-login`, ejecuta el algoritmo de selección de layout y navega a la URL final.
- LayoutAccessGuard (por módulo):
  - En cada módulo de layout (admin/pos/storefront/superadmin) valida que el usuario tenga acceso; caso contrario llama a `PostLoginLayoutGuard` para buscar alternativa o muestra 403.
- LayoutRouterService:
  - `computeHomeUrlFor(domainApp)` — para anónimo.
  - `computePostLoginUrl(user, domainApp)` — para logueado.
  - `layoutToUrl(layout, ctx)` — helper.

## Estructura de rutas sugerida (Angular)
- /auth → AuthLayoutModule (login, register, recovery)
- /admin → AdminLayoutModule (org/stores/users/reports)
- /pos → POSLayoutModule
- /shop → StorefrontLayoutModule
- /sa → SuperAdminLayoutModule
- /post-login → (route con PostLoginLayoutGuard)

## Flujos clave
- Anónimo (por dominio): DomainAppGuard → home pública.
- Login exitoso: `navigate('/post-login')` → PostLoginLayoutGuard decide layout destino.
- Deep linking protegido: AuthGuard bloquea, guarda `returnUrl`, tras login PostLoginLayoutGuard valida si el usuario puede acceder; si no, reubica a layout permitido y muestra toast.
- Cambio de preferencia de layout: persistir en backend; próxima sesión respeta.

## Edge cases
- Múltiples organizaciones: selector de organización activa al entrar a layouts admin/pos.
- Dominio de tienda pero usuario SuperAdmin: puede ir a superadmin; branding se mantiene del dominio (tienda), datos de scope superadmin.
- Cliente intenta entrar a /admin: LayoutAccessGuard → redirige a storefront.
- SSR: DomainAppGuard debe poder funcionar en SSR; ThemeService debe aplicar branding en server y rehidratar en cliente.

## Pasos de implementación
1. Tipos compartidos (en libs/shared-types): DomainApp, LayoutKey, UserProfile { roles: string[], preferredLayout?: LayoutKey, organizations: ... }.
2. Servicios: DomainDetectorService, TenantConfigService, ThemeService (existen en docs), LayoutRouterService (nuevo).
3. Guards: DomainAppGuard, PostLoginLayoutGuard, LayoutAccessGuard.
4. Rutas: Definir /post-login y aplicar guards por módulo.
5. Preferencia de usuario: UI para cambiarla + endpoint backend.
6. Pruebas: unitarias para `LayoutRouterService.computePostLoginUrl` con combinaciones de roles/preferencias.

## Aceptación
- La home pública cambia al modificar `DomainConfig.app` del dominio.
- Tras login, usuarios aterrizan en un layout permitido por su rol.
- El caso Owner en Vendix landing muestra admin con branding Vendix y datos de su org.
