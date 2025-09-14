# Core

Descripción general del núcleo de la app (servicios compartidos, guardas e interceptores) que habilitan multi-tenant, detección de dominio, configuración de tenant, temas/branding y seguridad.

## ✅ Mejoras Implementadas

### SSR Compatibility
Todos los servicios ahora usan `PLATFORM_ID` para acceso seguro a browser APIs:
- ✅ `localStorage` protegido en AuthService, StoreService
- ✅ `window.location` protegido en DomainDetectorService
- ✅ `document` manipulación protegida en ThemeService
- ✅ Redirecciones seguras en AppInitializerService

### Seguridad Mejorada
- ✅ **AdminGuard**: Ahora valida `isLoggedIn() && isAdmin()` (antes solo login)
- ✅ **AuthInterceptor**: Solo añade Authorization a URLs API (no externas)
- ✅ **Token Rotation**: Actualiza access + refresh tokens en refresh

### Testing Coverage
- ✅ **DomainDetectorService**: Tests completos de mappings y API
- ✅ **TenantConfigService**: Tests de cache y manejo de errores
- ✅ **AuthInterceptor**: Tests de refresh token y concurrencia

## Servicios Clave

### Inicialización
- **AppInitializerService**: Orquesta inicialización multi-entorno con manejo de errores

### Detección de Dominio
- **DomainDetectorService**: Resuelve entorno desde dominio con SSR support
- ✅ Tests unitarios completos

### Configuración de Tenant
- **TenantConfigService**: Obtiene y cachea configuración del tenant
- ✅ Cache inteligente, tests completos

### Temas y Branding
- **ThemeService**: Aplica variables CSS/SEO/branding con SSR safety

### Estado y Almacenamiento
- **StoreService**: Estado de tienda con localStorage protegido

### Autenticación
- **AuthService (core)**: Manejo de sesión, tokens y redirecciones por rol
- **AuthRegistrationService (módulo)**: Servicio específico para registro

### Seguridad
- **AdminGuard**: Protege rutas administración con validación de roles
- **AuthInterceptor**: Bearer token + refresh con scope limitado a API

## Estructura de Archivos

```
core/
├── services/
│   ├── app-initializer.service.ts
│   ├── domain-detector.service.ts + .spec.ts ✅
│   ├── tenant-config.service.ts + .spec.ts ✅
│   ├── theme.service.ts
│   ├── auth.service.ts
│   ├── store.service.ts
│   └── auth-registration.service.ts (módulo)
├── guards/
│   └── admin.guard.ts ✅ Mejorado
├── interceptors/
│   └── auth.interceptor.ts + .spec.ts ✅ Mejorado
└── models/
    ├── domain-config.interface.ts
    ├── tenant-config.interface.ts
    └── environment.enum.ts
```
