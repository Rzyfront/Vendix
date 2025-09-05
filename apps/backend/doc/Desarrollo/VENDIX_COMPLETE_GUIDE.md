# Vendix Backend - Guía Completa

## 🎯 Arquitectura Multi-Tenant

### Visión General
Vendix es una plataforma SaaS de comercio electrónico multi-tenant que permite a las organizaciones crear y gestionar múltiples tiendas online con configuraciones personalizadas por dominio.

### Estructura de Datos

#### Modelos Principales
```prisma
// Organizaciones (nivel superior)
model organizations {
  id                    Int    @id @default(autoincrement())
  name                  String @db.VarChar(255)
  slug                  String @unique @db.VarChar(255)
  organization_settings organization_settings?
  domain_settings       domain_settings[]
  stores                stores[]
}

// Configuración de Organización
model organization_settings {
  id              Int    @id @default(autoincrement())
  organization_id Int    @unique
  config          Json   // Configuración completa de la organización
}

// Tiendas (nivel intermedio)
model stores {
  id              Int    @id @default(autoincrement())
  name            String @db.VarChar(255)
  slug            String @db.VarChar(255)
  organization_id Int
  domain_settings domain_settings[]
}

// Configuración de Dominios (nivel específico)
model domain_settings {
  id              Int    @id @default(autoincrement())
  hostname        String @unique @db.VarChar(255)
  organization_id Int
  store_id        Int?
  config          Json   // Configuración específica del dominio
}
```

### Jerarquía de Configuración
1. **Organización** → Configuración base y defaults
2. **Tienda** → Configuración específica de tienda
3. **Dominio** → Configuración final y overrides

---

## 🔧 Gestión de Configuraciones de Dominio

### Servicio Principal: `DomainSettingsService`

#### Funcionalidades
- **Crear configuraciones** de dominio
- **Consultar configuraciones** por hostname, ID, organización o tienda
- **Actualizar configuraciones** existentes
- **Eliminar configuraciones**
- **Duplicar configuraciones** entre dominios
- **Validar hostnames** únicos

#### Ejemplo de Configuración Completa
```json
{
  "branding": {
    "companyName": "Mi Empresa",
    "storeName": "Mi Tienda Online",
    "logoUrl": "https://cdn.ejemplo.com/logo.png",
    "favicon": "https://cdn.ejemplo.com/favicon.ico",
    "primaryColor": "#007bff",
    "secondaryColor": "#6c757d",
    "accentColor": "#28a745"
  },
  "seo": {
    "title": "Mi Tienda Online - Los Mejores Productos",
    "description": "Encuentra los mejores productos en nuestra tienda online",
    "keywords": ["tienda", "online", "productos", "ecommerce"],
    "ogImage": "https://cdn.ejemplo.com/og-image.jpg",
    "robots": "index, follow"
  },
  "features": {
    "inventory": true,
    "pos": true,
    "orders": true,
    "customers": true,
    "wishlist": true,
    "reviews": true,
    "coupons": true,
    "shipping": true,
    "payments": true,
    "apiAccess": false,
    "webhooks": false,
    "customThemes": true,
    "advancedAnalytics": false
  },
  "theme": {
    "layout": "sidebar",
    "sidebarMode": "expanded",
    "colorScheme": "light",
    "borderRadius": "8px",
    "fontFamily": "Inter, sans-serif"
  },
  "ecommerce": {
    "currency": "USD",
    "locale": "es-ES",
    "timezone": "America/New_York",
    "taxCalculation": "automatic",
    "shippingEnabled": true,
    "digitalProductsEnabled": true,
    "subscriptionsEnabled": false
  },
  "integrations": {
    "googleAnalytics": "GA-XXXXXXXXX",
    "googleTagManager": "GTM-XXXXXXX",
    "facebookPixel": "123456789",
    "intercom": "app_id_123"
  },
  "security": {
    "forceHttps": true,
    "hsts": true,
    "allowedOrigins": ["https://mitienda.com", "https://app.mitienda.com"]
  },
  "performance": {
    "cacheTtl": 3600,
    "cdnEnabled": true,
    "compressionEnabled": true,
    "imageLazyLoading": true
  }
}
```

### API Endpoints

#### Endpoints Públicos (Sin Autenticación)
```http
# Resolver configuración de dominio
GET /api/public/domains/resolve/:hostname
```

#### Endpoints Privados (Con Autenticación)
```http
# Crear configuración
POST /api/domain-settings
Body: CreateDomainSettingDto

# Listar configuraciones
GET /api/domain-settings?organizationId=1&limit=10

# Obtener por hostname
GET /api/domain-settings/hostname/:hostname

# Obtener por ID
GET /api/domain-settings/:id

# Actualizar configuración
PUT /api/domain-settings/hostname/:hostname
Body: UpdateDomainSettingDto

# Eliminar configuración
DELETE /api/domain-settings/hostname/:hostname

# Duplicar configuración
POST /api/domain-settings/hostname/:hostname/duplicate
Body: { "newHostname": "nuevo-dominio.com" }

# Validar hostname
POST /api/domain-settings/validate-hostname
Body: { "hostname": "nuevo-dominio.com" }
```

### Permisos por Rol
- **super_admin**: Acceso completo a todas las operaciones
- **organization_admin**: Gestión de dominios de su organización
- **store_admin**: Consulta y actualización de dominios de su tienda
- **store_staff**: Solo consulta de configuraciones

---

## 🔐 Sistema de Autenticación

### Refresh Tokens Seguros
- **Device Fingerprinting**: Hash único SHA256 por dispositivo
- **IP Address Tracking**: Monitoreo de ubicación de acceso
- **Browser Detection**: Chrome, Firefox, Safari, Edge, Opera
- **OS Detection**: Windows, macOS, Linux, Android, iOS
- **Auto Revocation**: Tokens sospechosos se invalidan automáticamente
- **Frequency Control**: Máximo 1 refresh cada 30 segundos

### Endpoints de Autenticación
```http
# Registro de usuario
POST /api/auth/register
Body: { "email", "password", "firstName", "lastName" }

# Login
POST /api/auth/login
Body: { "email", "password" }

# Refresh token
POST /api/auth/refresh
Body: { "refreshToken" }

# Logout
POST /api/auth/logout
Header: Authorization: Bearer <token>

# Verificar email
POST /api/auth/verify-email
Body: { "token" }

# Solicitar reset de contraseña
POST /api/auth/forgot-password
Body: { "email" }

# Reset contraseña
POST /api/auth/reset-password
Body: { "token", "newPassword" }
```

---

## 📧 Sistema de Emails

### Configuración SMTP
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=tu-email@gmail.com
SMTP_PASS=tu-password-app
SMTP_FROM=noreply@tudominio.com
```

### Tipos de Email Soportados
- **Verificación de Email**: Confirmación de cuenta
- **Reset de Contraseña**: Recuperación de cuenta
- **Notificaciones**: Alertas del sistema
- **Bienvenida**: Onboarding de usuarios

---

## 🚀 Inicio Rápido

### Instalación
```bash
# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env

# Ejecutar migraciones
npx prisma migrate deploy

# Generar cliente Prisma
npx prisma generate

# Ejecutar seeders (opcional)
npx prisma db seed
```

### Desarrollo
```bash
# Modo desarrollo
npm run start:dev

# Modo producción
npm run build
npm run start:prod

# Tests
npm run test
npm run test:e2e
```

### Estructura de Proyecto
```
src/
├── auth/                 # Autenticación y autorización
├── common/              # Servicios y utilidades comunes
│   ├── services/        # DomainSettingsService, etc.
│   ├── controllers/     # Controladores públicos
│   └── dto/            # Data Transfer Objects
├── modules/            # Módulos de negocio
│   ├── organizations/
│   ├── stores/
│   ├── products/
│   └── ...
├── prisma/             # Configuración de base de datos
└── users/              # Gestión de usuarios
```

---

## 🛡️ Seguridad

### Configuración de Seguridad
- **JWT Tokens**: Autenticación stateless
- **Refresh Tokens**: Rotación automática
- **Rate Limiting**: Protección contra ataques
- **CORS**: Configuración de orígenes permitidos
- **Helmet**: Headers de seguridad HTTP
- **Validation**: Validación de entrada con class-validator

### Headers de Seguridad
```typescript
// Configuración automática con Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));
```

---

## 📊 Monitoring y Logs

### Logs del Sistema
- **Autenticación**: Login, logout, refresh tokens
- **Operaciones**: CRUD de configuraciones
- **Errores**: Excepciones y fallos del sistema
- **Seguridad**: Intentos de acceso sospechosos

### Métricas
- **Performance**: Tiempo de respuesta de APIs
- **Uso**: Endpoints más utilizados
- **Errores**: Tasa de errores por endpoint
- **Seguridad**: Intentos de login fallidos

---

## 🔄 Flujo de Trabajo Multi-Tenant

### 1. Configuración Inicial
```typescript
// Crear organización
const org = await organizationsService.create({
  name: "Mi Empresa",
  slug: "mi-empresa"
});

// Crear tienda
const store = await storesService.create({
  name: "Mi Tienda",
  slug: "mi-tienda",
  organizationId: org.id
});

// Configurar dominio
const domain = await domainSettingsService.create({
  hostname: "mitienda.com",
  organizationId: org.id,
  storeId: store.id,
  config: { /* configuración completa */ }
});
```

### 2. Resolución de Dominio
```typescript
// El frontend consulta la configuración
const config = await fetch('/api/public/domains/resolve/mitienda.com');

// Aplica branding, tema y configuraciones
applyBranding(config.branding);
applyTheme(config.theme);
enableFeatures(config.features);
```

### 3. Gestión de Configuraciones
```typescript
// Actualizar configuración
await domainSettingsService.update('mitienda.com', {
  config: {
    branding: {
      primaryColor: '#ff6b6b'
    }
  }
});

// Duplicar configuración
await domainSettingsService.duplicate(
  'mitienda.com',
  'nueva-tienda.com'
);
```

---

## 🧪 Testing

### Tests Unitarios
```bash
# Ejecutar todos los tests
npm run test

# Tests con cobertura
npm run test:cov

# Tests en modo watch
npm run test:watch
```

### Tests E2E
```bash
# Tests end-to-end
npm run test:e2e

# Tests E2E específicos
npm run test:e2e -- --testNamePattern="Auth"
```

### Ejemplos de Test
```typescript
describe('DomainSettingsService', () => {
  it('should create domain configuration', async () => {
    const result = await service.create({
      hostname: 'test.com',
      organizationId: 1,
      config: { branding: { companyName: 'Test' } }
    });
    
    expect(result.hostname).toBe('test.com');
    expect(result.config.branding.companyName).toBe('Test');
  });
});
```

---

## 🔧 Troubleshooting

### Problemas Comunes

#### 1. Error "Cannot GET /api/public/domains/resolve/:hostname"
```bash
# Verificar que el controlador público esté registrado
# Revisar en app.module.ts que PublicModule esté importado
```

#### 2. Error de Prisma "Model not found"
```bash
# Regenerar cliente Prisma
npx prisma generate

# Verificar schema.prisma
npx prisma validate
```

#### 3. Errores de Autenticación
```bash
# Verificar configuración JWT
echo $JWT_SECRET
echo $JWT_EXPIRES_IN

# Verificar tokens en base de datos
npx prisma studio
```

### Logs de Debug
```typescript
// Habilitar logs detallados
const app = await NestFactory.create(AppModule, {
  logger: ['error', 'warn', 'debug', 'verbose']
});
```

---

## 📋 Checklist de Implementación

### ✅ Completado
- [x] Arquitectura multi-tenant
- [x] Gestión de configuraciones de dominio
- [x] Sistema de autenticación con refresh tokens
- [x] Endpoints públicos y privados
- [x] Validación de datos con DTOs
- [x] Sistema de permisos por rol
- [x] Documentación completa
- [x] Configuración de seguridad
- [x] Sistema de emails

### 🔄 En Progreso
- [ ] Tests unitarios completos
- [ ] Tests E2E
- [ ] Monitoreo y métricas
- [ ] Optimizaciones de performance

### 📋 Pendiente
- [ ] Documentación de API con Swagger
- [ ] Implementación de cache Redis
- [ ] Integración CI/CD
- [ ] Despliegue en producción

---

## 📞 Soporte

Para soporte técnico o preguntas sobre la implementación:
- **Email**: soporte@vendix.com
- **Documentación**: [docs.vendix.com](https://docs.vendix.com)
- **GitHub Issues**: [github.com/vendix/backend/issues](https://github.com/vendix/backend/issues)
