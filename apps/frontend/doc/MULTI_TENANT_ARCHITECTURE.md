# 🏗️ ARQUITECTURA MULTI-TENANT VENDIX

## 📋 Tabla de Contenidos
1. [Conceptos Generales](#conceptos-generales)
2. [Tipos de Dominios](#tipos-de-dominios)
3. [Detección de Dominios](#detección-de-dominios)
4. [Configuración de Entornos](#configuración-de-entornos)
5. [Autenticación por Entorno](#autenticación-por-entorno)
6. [Configuración Dinámica](#configuración-dinámica)
7. [Implementación Técnica](#implementación-técnica)
8. [Ejemplos de Configuración](#ejemplos-de-configuración)
9. [Desarrollo Local](#desarrollo-local)
10. [Despliegue en Producción](#despliegue-en-producción)

---

## 🎯 Conceptos Generales

### Definiciones
- **Vendix**: Aplicación SaaS multi-tenant para e-commerce
- **Organización**: Empresa cliente que usa Vendix (ej: Mordoc S.A.S)
- **Tienda**: Punto de venta individual dentro de una organización (ej: Luda)
- **Multi-tenant**: Una aplicación que sirve múltiples clientes con configuraciones independientes

### Objetivos de la Arquitectura
- ✅ Soporte para dominios personalizados y subdominios
- ✅ Configuración dinámica por organización/tienda
- ✅ Temas y branding personalizables
- ✅ Autenticación separada por entorno
- ✅ Escalabilidad y reutilización de componentes
- ✅ Desarrollo local simplificado

---

## 🌐 Tipos de Dominios

### 1. Dominio Principal Vendix
```
vendix.com           → Landing principal + Auth + Onboarding
admin.vendix.com     → Super administración de Vendix
```

### 2. Dominios de Organización
```
{org}.vendix.com     → Admin org. (subdominio Vendix)
{org}.com            → Landing org. (dominio propio)
app.{org}.com        → Admin org. (dominio propio)
```

### 3. Dominios de Tienda
```
{store}.{org}.com           → E-commerce (subdominio org.)
admin.{store}.{org}.com     → Admin tienda (subdominio org.)
{store}.com                 → E-commerce (dominio propio)
admin.{store}.com           → Admin tienda (dominio propio)
```

### Ejemplos Reales
- `vendix.com` → Landing Vendix
- `mordoc.com` → Landing organización Mordoc
- `app.mordoc.com` → Admin organización Mordoc
- `luda.mordoc.com` → E-commerce tienda Luda
- `admin.luda.mordoc.com` → Admin tienda Luda
- `store.luda.com` → E-commerce con dominio propio

---

## 🔍 Detección de Dominios

### Tipos de Dominio (Enum)
```typescript
export enum DomainType {
  VENDIX_CORE = 'vendix_core',
  ORGANIZATION_ROOT = 'organization_root',
  ORGANIZATION_SUBDOMAIN = 'org_subdomain', 
  STORE_SUBDOMAIN = 'store_subdomain',
  STORE_CUSTOM = 'store_custom'
}
```

### Entornos de Aplicación (Enum)
```typescript
export enum AppEnvironment {
  VENDIX_LANDING = 'vendix_landing',
  VENDIX_ADMIN = 'vendix_admin',
  ORG_LANDING = 'org_landing',
  ORG_ADMIN = 'org_admin',
  STORE_ADMIN = 'store_admin',
  STORE_ECOMMERCE = 'store_ecommerce'
}
```

### Configuración de Dominio
```typescript
export interface DomainConfig {
  domainType: DomainType;
  environment: AppEnvironment;
  organizationSlug?: string;
  storeSlug?: string;
  customConfig?: TenantConfig;
  isVendixDomain: boolean;
}
```

### Algoritmo de Detección
1. **¿Es vendix.com o subdominio?** → Manejo Vendix
2. **¿Es dominio personalizado?** → Consulta API `/api/domains/resolve/{hostname}`
3. **Analizar respuesta** → Determinar tipo y configuración
4. **Cargar configuración** → Aplicar tema y funcionalidades

---

## ⚙️ Configuración de Entornos

### Configuración por Entorno
```typescript
export interface EnvironmentConfig {
  routes: Routes[];
  components: string[];
  services: string[];
  features: FeatureFlags;
  theme: ThemeConfig;
  auth: AuthConfig;
}
```

### Mapeo de Entornos
- **VENDIX_LANDING**: Landing, Auth, Onboarding, Marketing
- **VENDIX_ADMIN**: Gestión global, Organizaciones, Métricas
- **ORG_LANDING**: Landing personalizado de organización
- **ORG_ADMIN**: Dashboard org., Tiendas, Usuarios, Reportes
- **STORE_ADMIN**: Productos, Órdenes, POS, Clientes, Inventario
- **STORE_ECOMMERCE**: Catálogo, Carrito, Checkout, Cuenta cliente

---

## 🔐 Autenticación por Entorno

### Flujos de Autenticación

#### 1. Vendix Principal (vendix.com)
```typescript
async handleVendixAuth(user: User) {
  if (user.isSuperAdmin) {
    // Redirigir a admin.vendix.com
    window.location.href = 'https://admin.vendix.com';
  } else if (user.hasCompletedOnboarding) {
    // Redirigir a su organización
    this.redirectToUserOrganization(user);
  } else {
    // Continuar onboarding
    this.router.navigate(['/onboarding']);
  }
}
```

#### 2. Dominios de Organización/Tienda
```typescript
async handleTenantAuth(domainConfig: DomainConfig) {
  const hasAccess = await this.validateUserAccess(
    this.currentUser,
    domainConfig.organizationSlug,
    domainConfig.storeSlug
  );
  
  if (!hasAccess) {
    // Redirigir a login de Vendix
    window.location.href = 'https://vendix.com/auth/login';
  }
}
```

#### 3. E-commerce (Modo Cliente)
```typescript
async handleEcommerceAuth(domainConfig: DomainConfig) {
  // Permitir modo invitado
  this.allowGuestMode = true;
  
  // Cargar sesión de cliente si existe
  if (this.hasCustomerSession()) {
    this.loadCustomerSession();
  }
}
```

### Estados de Autenticación
- **Sin autenticar**: Acceso a landing y e-commerce como invitado
- **Usuario Vendix**: Acceso a org/tiendas según permisos
- **Super Admin**: Acceso total a admin.vendix.com
- **Cliente E-commerce**: Sesión independiente en tiendas

---

## 🎨 Configuración Dinámica

### Configuración de Tenant
```typescript
export interface TenantConfig {
  organization: OrganizationConfig;
  store?: StoreConfig;
  branding: BrandingConfig;
  theme: ThemeConfig;
  features: FeatureFlags;
  seo: SEOConfig;
}
```

### Branding Personalizable
```typescript
export interface BrandingConfig {
  logo: {
    url: string;
    alt: string;
    width?: number;
    height?: number;
  };
  
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: {
      primary: string;
      secondary: string;
      muted: string;
    };
  };
  
  fonts: {
    primary: string;
    secondary?: string;
    headings?: string;
  };
  
  customCSS?: string;
  favicon?: string;
}
```

### Aplicación de Tema
```typescript
class ThemeService {
  async applyTenantTheme(config: TenantConfig) {
    // 1. Aplicar colores CSS
    this.applyCSSVariables(config.branding.colors);
    
    // 2. Cargar fuentes personalizadas
    await this.loadFonts(config.branding.fonts);
    
    // 3. Inyectar CSS personalizado
    if (config.branding.customCSS) {
      this.injectCustomCSS(config.branding.customCSS);
    }
    
    // 4. Actualizar favicon
    if (config.branding.favicon) {
      this.updateFavicon(config.branding.favicon);
    }
    
    // 5. Configurar SEO
    this.seoService.updateMetaTags(config.seo);
  }
}
```

---

## 🛠️ Implementación Técnica

### Servicios Principales

#### 1. DomainDetectorService
- Detecta tipo de dominio basado en hostname
- Consulta API para dominios personalizados
- Retorna configuración de dominio

#### 2. TenantConfigService
- Carga configuración de organización/tienda
- Maneja cache de configuraciones
- Aplica configuración al estado global

#### 3. AppInitializerService
- Inicializa aplicación según dominio
- Configura rutas dinámicamente
- Aplica tema y branding

#### 4. ThemeService
- Aplica temas personalizados
- Gestiona CSS variables
- Carga fuentes dinámicamente

### Interceptors y Guards

#### AuthInterceptor
- Añade tokens automáticamente
- Maneja refresh de tokens
- Redirige en caso de 401

#### TenantGuard
- Valida acceso a tenant específico
- Verifica permisos de usuario
- Redirige si no tiene acceso

---

## 📝 Ejemplos de Configuración

### Ejemplo 1: Organización Mordoc
```json
{
  "hostname": "mordoc.com",
  "type": "organization_root",
  "purpose": "landing",
  "organizationSlug": "mordoc",
  "config": {
    "branding": {
      "logo": {
        "url": "https://cdn.mordoc.com/logo.png",
        "alt": "Mordoc S.A.S"
      },
      "colors": {
        "primary": "#1E40AF",
        "secondary": "#64748B"
      }
    },
    "environmentConfig": {
      "showLanding": true,
      "defaultStore": "luda"
    }
  }
}
```

### Ejemplo 2: Tienda Luda
```json
{
  "hostname": "luda.mordoc.com",
  "type": "store_subdomain", 
  "purpose": "ecommerce",
  "organizationSlug": "mordoc",
  "storeSlug": "luda",
  "config": {
    "branding": {
      "colors": {
        "primary": "#DC2626",
        "secondary": "#F59E0B"
      }
    },
    "features": {
      "guestCheckout": true,
      "wishlist": true,
      "reviews": true
    }
  }
}
```

---

## 💻 Desarrollo Local

### Configuración de Hosts
```bash
# Windows: C:\Windows\System32\drivers\etc\hosts
# Mac/Linux: /etc/hosts

127.0.0.1 mordoc.localhost
127.0.0.1 app.mordoc.localhost
127.0.0.1 luda.mordoc.localhost
127.0.0.1 admin.luda.localhost
```

### Environment Development
```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000',
  
  // Mapeo de dominios para desarrollo
  domainMapping: {
    'localhost:4200': { 
      type: 'vendix_core',
      environment: 'vendix_landing'
    },
    'mordoc.localhost:4200': { 
      type: 'organization_root',
      environment: 'org_landing',
      organizationSlug: 'mordoc'
    },
    'app.mordoc.localhost:4200': {
      type: 'organization_subdomain',
      environment: 'org_admin', 
      organizationSlug: 'mordoc'
    },
    'luda.mordoc.localhost:4200': {
      type: 'store_subdomain',
      environment: 'store_ecommerce',
      organizationSlug: 'mordoc',
      storeSlug: 'luda'
    }
  }
};
```

### Scripts de Desarrollo
```json
{
  "scripts": {
    "start": "ng serve --host 0.0.0.0 --disable-host-check",
    "start:vendix": "ng serve --host 0.0.0.0 --port 4200",
    "start:mordoc": "ng serve --host mordoc.localhost --port 4200",
    "start:luda": "ng serve --host luda.mordoc.localhost --port 4200"
  }
}
```

---

## 🚀 Despliegue en Producción

### Configuración DNS
```bash
# DNS Records necesarios
vendix.com          A    192.168.1.100
*.vendix.com        A    192.168.1.100
mordoc.com          A    192.168.1.100
*.mordoc.com        A    192.168.1.100
```

### Nginx Configuration
```nginx
server {
    listen 80;
    server_name vendix.com *.vendix.com mordoc.com *.mordoc.com;
    
    location / {
        proxy_pass http://localhost:4200;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### SSL/TLS
```bash
# Certificado wildcard para todos los subdominios
certbot certonly --dns-cloudflare \
  -d vendix.com \
  -d *.vendix.com \
  -d mordoc.com \
  -d *.mordoc.com
```

---

## 🔧 Estructura de Archivos

```
src/
├── app/
│   ├── core/
│   │   ├── services/
│   │   │   ├── domain-detector.service.ts
│   │   │   ├── tenant-config.service.ts
│   │   │   ├── app-initializer.service.ts
│   │   │   └── theme.service.ts
│   │   ├── guards/
│   │   │   ├── tenant.guard.ts
│   │   │   └── environment.guard.ts
│   │   ├── interceptors/
│   │   │   └── tenant.interceptor.ts
│   │   └── models/
│   │       ├── domain-config.interface.ts
│   │       ├── tenant-config.interface.ts
│   │       └── environment.enum.ts
│   ├── modules/
│   │   ├── vendix/           # Entorno Vendix
│   │   ├── organization/     # Entorno Organización  
│   │   ├── store-admin/      # Entorno Admin Tienda
│   │   └── ecommerce/        # Entorno E-commerce
│   └── shared/
│       ├── components/       # Componentes reutilizables
│       ├── services/         # Servicios compartidos
│       └── utils/           # Utilidades
```

---

## 🐛 Troubleshooting

### Problemas Comunes

#### 1. Dominio no detectado
- Verificar configuración DNS
- Revisar mapeo en environment
- Comprobar API `/api/domains/resolve`

#### 2. Tema no se aplica
- Verificar carga de configuración
- Revisar CSS variables
- Comprobar orden de carga

#### 3. Autenticación falla
- Verificar tokens en localStorage
- Revisar configuración de CORS
- Comprobar permisos de usuario

#### 4. Desarrollo local no funciona
- Verificar archivo hosts
- Comprobar puerto disponible
- Revisar proxy configuration

### Logs de Debug
```typescript
// Habilitar debug en development
export const environment = {
  debugDomainDetection: true,
  debugThemeApplication: true,
  debugAuthFlow: true
};
```

---

## 📊 Métricas y Monitoreo

### Métricas Importantes
- Tiempo de carga por dominio
- Errores de configuración
- Uso por tenant
- Performance de temas

### Logging
```typescript
class DomainDetectorService {
  async detectDomain(hostname: string): Promise<DomainConfig> {
    console.log(`[DOMAIN] Detecting: ${hostname}`);
    
    const config = await this.resolveConfig(hostname);
    
    console.log(`[DOMAIN] Resolved:`, config);
    
    return config;
  }
}
```

---

## 🔄 Actualizaciones y Migración

### Versionado de Configuración
- Mantener compatibilidad hacia atrás
- Migración automática de configs
- Rollback de configuraciones

### Deploy Strategy
1. Deploy backend API changes
2. Deploy frontend with feature flags
3. Enable gradually by tenant
4. Monitor and rollback if needed

---

## 📚 Referencias

- [Angular Multi-App Workspaces](https://angular.io/guide/file-structure#multiple-projects)
- [Dynamic Module Loading](https://angular.io/guide/lazy-loading-ngmodules)
- [CSS Custom Properties](https://developer.mozilla.org/en-US/docs/Web/CSS/--*)
- [DNS Wildcards](https://tools.ietf.org/html/rfc1034)

---

*Documentación creada el 30 de Junio, 2025*
*Versión: 1.0*
*Autor: Equipo Vendix*
