# Configuración de Entorno de Aplicación - Vendix Frontend

## 📋 Resumen Ejecutivo

El sistema de configuración de entorno de aplicación de Vendix Frontend es un mecanismo dinámico que determina automáticamente la interfaz de usuario apropiada basada en la resolución de dominios. Este sistema permite una experiencia multi-tenant completamente modular donde diferentes dominios muestran interfaces específicas según su propósito y contexto organizacional.

## 🎯 Arquitectura General

### Componentes Principales

1. **DomainDetectorService** - Resuelve dominios y determina entornos
2. **AppInitializerService** - Inicializa la aplicación según el entorno
3. **AuthService** - Maneja autenticación con contexto de dominio
4. **ThemeService** - Aplica branding dinámico
5. **NgRx Store** - Estado global de tenant y autenticación

### Flujo de Inicialización

```mermaid
graph TD
    A[APP_INITIALIZER] --> B[DomainDetectorService.detectDomain()]
    B --> C[API: /api/public/domains/resolve/{hostname}]
    C --> D[Respuesta con config.app]
    D --> E[Mapear a AppEnvironment]
    E --> F[Configurar rutas dinámicas]
    F --> G[Aplicar branding básico]
    G --> H[Inicializar servicios específicos]
```

## 🔧 Entornos de Aplicación Disponibles

### Determinación del Entorno

El entorno se determina mediante el campo `config.app` en la respuesta de la API de resolución de dominios:

```typescript
// apps/frontend/src/app/core/services/domain-detector.service.ts
switch (domainInfo.config?.app) {
  case 'VENDIX_LANDING':
    environment = AppEnvironment.VENDIX_LANDING;
    break;
  case 'VENDIX_ADMIN':
    environment = AppEnvironment.VENDIX_ADMIN;
    break;
  // ... otros casos
}
```

### 1. VENDIX_LANDING (`"VENDIX_LANDING"`)

**Propósito:** Página principal y marketing de Vendix

**Dominios típicos:**
- `vendix.com`
- `www.vendix.com`

**Módulos disponibles:**
- `landing/` - Página principal de marketing
- `auth/` - Autenticación completa y registro
- `onboarding/` - Proceso de onboarding

**Componentes principales:**
- `LandingComponent` - Página de marketing
- `LoginComponent` - Formulario de autenticación
- `RegisterComponent` - Registro de nuevos owners
- `VerifyEmailComponent` - Verificación de email con token
- `ForgotPasswordComponent` - Recuperación de contraseña
- `ResetPasswordComponent` - Cambio de contraseña con token

**Características:**
- Branding de Vendix
- Registro de organizaciones
- Información corporativa
- **Verificación de email completa:**
  - Registro con envío automático de email de verificación
  - Verificación de email con token (`/auth/verify-email?token=...`)
  - Estados de verificación: loading, success, error
  - Auto-redirección al login después de verificación exitosa
- **Recuperación de contraseña completa:**
  - Solicitud de enlace de recuperación (`/auth/forgot-password`)
  - Envío de email con token de recuperación
  - Cambio de contraseña con token (`/auth/reset-password?token=...`)
  - Validación de tokens y expiración
  - Auto-redirección al login después del cambio exitoso

### 2. VENDIX_ADMIN (`"VENDIX_ADMIN"`)

**Propósito:** Panel de super administración del sistema

**Dominios típicos:**
- `admin.vendix.com`
- `superadmin.vendix.com`

**Módulos disponibles:**
- `admin/` - Panel de administración completo
- `super-admin/` - Funcionalidades avanzadas
- `organizations/` - Gestión global de organizaciones
- `analytics/` - Métricas del sistema

**Componentes principales:**
- `AdminDashboardComponent` - Dashboard principal
- `OrganizationsComponent` - CRUD de organizaciones
- `StoresComponent` - Gestión de tiendas
- `UsersComponent` - Usuarios del sistema
- `SettingsComponent` - Configuraciones globales
- `AnalyticsComponent` - Analytics multi-tenant

**Características:**
- Control total del sistema
- Gestión de tenants
- Configuraciones globales
- Reportes consolidados

### 3. ORG_LANDING (`"ORG_LANDING"`)

**Propósito:** Página corporativa de la organización

**Dominios típicos:**
- `empresa.com`
- `www.empresa.com`

**Módulos disponibles:**
- `organization-landing/` - Landing page organizacional
- `auth/` - Autenticación contextual

**Componentes principales:**
- Página de información corporativa
- Formularios de contacto
- Login organizacional

**Características:**
- Branding personalizado por organización
- Información corporativa
- Contacto y soporte

### 4. ORG_ADMIN (`"ORG_ADMIN"`)

**Propósito:** Panel de administración organizacional

**Dominios típicos:**
- `admin.empresa.com`
- `manage.empresa.com`

**Módulos disponibles:**
- `organization/` - Panel organizacional
- `stores/` - Gestión de tiendas
- `users/` - Gestión de usuarios
- `reports/` - Reportes organizacionales

**Componentes principales:**
- Dashboard organizacional
- Gestión de múltiples tiendas
- Control de personal
- Analytics organizacional

**Características:**
- Control de todas las tiendas
- Gestión de usuarios organizacionales
- Reportes consolidados
- Configuraciones organizacionales

### 5. STORE_ADMIN (`"STORE_ADMIN"`)

**Propósito:** Panel de administración de tienda específica

**Dominios típicos:**
- `admin.tiendita.empresa.com`
- `manage.tiendita.empresa.com`

**Módulos disponibles:**
- `store/` - Panel de tienda
- `products/` - Gestión de productos
- `orders/` - Procesamiento de pedidos
- `customers/` - Gestión de clientes
- `pos/` - Punto de venta

**Componentes principales:**
- Dashboard de tienda
- Gestión de inventario
- Procesamiento de ventas
- Sistema POS
- Gestión de clientes locales

**Características:**
- Operaciones diarias de tienda
- Control de inventario
- Procesamiento de pedidos
- Sistema de punto de venta

### 6. STORE_ECOMMERCE (`"STORE_ECOMMERCE"`)

**Propósito:** Tienda online (e-commerce)

**Dominios típicos:**
- `tiendita.empresa.com`
- `shop.tiendita.empresa.com`

**Módulos disponibles:**
- `ecommerce/` - Experiencia de compra
- `products/` - Catálogo de productos
- `cart/` - Carrito de compras
- `checkout/` - Proceso de pago
- `account/` - Gestión de cuenta

**Componentes principales:**
- `StorefrontComponent` - Página principal
- Catálogo de productos
- Carrito y checkout
- Perfil de cliente
- Historial de pedidos

**Características:**
- Experiencia de compra online
- Catálogo dinámico
- Carrito persistente
- Múltiples métodos de pago
- Gestión de cuenta de cliente

## 🔄 Flujos Post-Autenticación

### Sistema de Redirección por Roles

```typescript
// apps/frontend/src/app/core/services/auth.service.ts
redirectAfterLogin(): void {
  const user = this.getCurrentUser();
  if (user?.roles?.includes('ADMIN') || user?.roles?.includes('SUPER_ADMIN')) {
    this.router.navigate(['/admin/dashboard']);
  } else if (user?.roles?.includes('OWNER') || user?.roles?.includes('MANAGER')) {
    this.router.navigate(['/organization']);
  } else if (user?.roles?.includes('STORE_MANAGER') || user?.roles?.includes('EMPLOYEE')) {
    this.router.navigate(['/store']);
  } else {
    this.router.navigate(['/store']); // E-commerce por defecto
  }
}
```

### Auto-Poblado de Contexto

El sistema automáticamente puebla `organizationSlug` y `storeSlug` desde el dominio actual:

```typescript
// Auto-populate organizationSlug/storeSlug from current domain
const enrichedLoginDto = { ...loginDto };
if (!enrichedLoginDto.organizationSlug && !enrichedLoginDto.storeSlug) {
  const currentDomain = this.tenantFacade.getCurrentDomainConfig();
  if (currentDomain) {
    enrichedLoginDto.organizationSlug = currentDomain.organizationSlug;
    enrichedLoginDto.storeSlug = currentDomain.storeSlug;
  }
}
```

### Flujo de Recuperación de Contraseña

```typescript
// 1. Usuario solicita recuperación
POST /api/auth/forgot-password
{
  "email": "user@example.com",
  "organization_slug": "empresa"
}

// 2. Sistema envía email con enlace
/auth/reset-password?token=abc123...

// 3. Usuario cambia contraseña
POST /api/auth/reset-password
{
  "token": "abc123...",
  "newPassword": "newSecurePassword"
}
```

**URLs disponibles en VENDIX_LANDING:**
- `/auth/forgot-password` - Solicitar recuperación
- `/auth/reset-password?token=...` - Cambiar contraseña

### Flujo Completo de Registro y Verificación

```typescript
// 1. Usuario se registra
POST /api/auth/register-owner
{
  "organizationName": "Mi Empresa",
  "email": "owner@empresa.com",
  "password": "securePass123",
  "first_name": "Juan",
  "last_name": "Pérez"
}

// 2. Sistema envía email de verificación automáticamente
// Email contiene enlace: /auth/verify-email?token=abc123...

// 3. Usuario hace click en enlace y verifica email
GET /auth/verify-email?token=abc123...
// → Verificación automática y redirección a login

// 4. Usuario puede iniciar sesión
POST /api/auth/login
{
  "email": "owner@empresa.com",
  "password": "securePass123"
}
```

**URLs disponibles en VENDIX_LANDING:**
- `/auth/register` - Registro de nuevos owners
- `/auth/verify-email?token=...` - Verificación de email
- `/auth/login` - Inicio de sesión (después de verificación)

## 🎨 Sistema de Branding Dinámico

### Aplicación de Branding

1. **Resolución de Dominio** → Obtiene configuración de branding
2. **Transformación** → Convierte formato API a ThemeService
3. **Aplicación** → Aplica colores, logos y fuentes

```typescript
// Transformación de branding API
private transformApiBranding(apiBranding: any): any {
  return {
    logo: {
      url: apiBranding.logo_url,
      alt: apiBranding.name || 'Logo'
    },
    colors: {
      primary: apiBranding.primary_color,
      secondary: apiBranding.secondary_color,
      // ... otros colores
    },
    fonts: {
      primary: 'Inter, sans-serif',
      secondary: 'Inter, sans-serif'
    }
  };
}
```

### Niveles de Branding

- **VENDIX_LANDING/ADMIN:** Branding corporativo de Vendix
- **ORG_LANDING/ADMIN:** Branding personalizado por organización
- **STORE_ECOMMERCE/ADMIN:** Branding específico de tienda

## 🔀 Transiciones entre Entornos

### Cambio de Dominio

Los usuarios pueden transitar entre entornos cambiando de dominio:

```
vendix.com (VENDIX_LANDING)
├── admin.vendix.com (VENDIX_ADMIN)
├── empresa.com (ORG_LANDING)
│   ├── admin.empresa.com (ORG_ADMIN)
│   └── tienda.empresa.com (STORE_ECOMMERCE)
│       └── admin.tienda.empresa.com (STORE_ADMIN)
```

### Re-inicialización

Cada cambio de dominio dispara una re-inicialización completa:

```typescript
async reinitializeApp(): Promise<void> {
  // Limpiar configuraciones actuales
  this.tenantConfig.clearCache();
  this.themeService.resetTheme();

  // Re-inicializar con nuevo dominio
  await this.initializeApp();
}
```

## 📊 Estados y Configuraciones

### Estado en NgRx Store

```typescript
interface TenantState {
  domainConfig: DomainConfig | null;
  tenantConfig: TenantConfig | null;
  initialized: boolean;
  loading: boolean;
  error: string | null;
}
```

### Cache Local

- **Domain Config:** `localStorage['vendix_domain_config']`
- **User Data:** `localStorage['vendix_user']`
- **Tokens:** `localStorage['access_token']`, `localStorage['refresh_token']`

## 🔧 Configuración de Desarrollo

### Variables de Entorno

```typescript
// environment.ts
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000',
  // ... otras configuraciones
};
```

### Simulación de Dominios

Para desarrollo local, se pueden simular diferentes dominios mediante:

1. **Hosts file** para mapear dominios locales
2. **Query parameters** para forzar entornos
3. **Environment overrides** para testing

## 🚀 Guía de Implementación

### Agregar Nuevo Entorno

1. **Actualizar enum AppEnvironment**
2. **Agregar caso en DomainDetectorService**
3. **Crear módulo específico**
4. **Configurar rutas**
5. **Actualizar lógica de redirección**
6. **Documentar en este archivo**

### Debugging

```typescript
// Ver estado actual
const appState = this.appInitializer.getAppState();
console.log('Current App State:', appState);

// Ver configuración de dominio
const domainConfig = this.tenantFacade.getCurrentDomainConfig();
console.log('Domain Config:', domainConfig);
```

## 📈 Métricas y Monitoreo

### Eventos a Monitorear

- **Domain Resolution:** Latencia y tasa de éxito
- **App Initialization:** Tiempo de carga por entorno
- **Authentication:** Tasa de éxito por entorno
- **Branding Application:** Aplicación correcta de temas

### Logs Importantes

```typescript
console.log(`[DOMAIN DETECTOR] Analyzing hostname: ${currentHostname}`);
console.log(`[APP INITIALIZER] Domain detected:`, domainConfig);
console.log(`[APP INITIALIZER] Route configuration:`, routeConfig);
```

## 🔒 Consideraciones de Seguridad

### Validación de Dominios

- Solo dominios verificados pueden configurar entornos
- Validación de permisos por rol
- Sanitización de configuración de branding

### Autenticación Contextual

- Auto-poblado de slugs desde dominio
- Validación de acceso por tenant
- Refresh tokens por contexto

## 🎯 Mejores Prácticas

### Desarrollo

1. **Modularidad:** Cada entorno es un módulo independiente
2. **Reutilización:** Componentes compartidos entre entornos
3. **Testing:** Tests específicos por entorno
4. **Documentación:** Mantener este documento actualizado

### Performance

1. **Lazy Loading:** Módulos cargados bajo demanda
2. **Caching:** Configuraciones cacheadas localmente
3. **Bundle Splitting:** Separación por entorno

### Mantenimiento

1. **Versionado:** Control de versiones de configuraciones
2. **Rollback:** Capacidad de revertir cambios
3. **Monitoring:** Alertas en fallos de inicialización

---

## 📚 Referencias

- [DomainDetectorService](../src/app/core/services/domain-detector.service.ts)
- [AppInitializerService](../src/app/core/services/app-initializer.service.ts)
- [AuthService](../src/app/core/services/auth.service.ts)
- [ThemeService](../src/app/core/services/theme.service.ts)
- [Multi-Tenant Architecture](MULTI_TENANT_ARCHITECTURE.md)