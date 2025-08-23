# Vendix Backend

Un backend enterprise-grade para e-commerce construido con NestJS, Prisma y PostgreSQL, que incluye un sistema completo de autenticación JWT con seguridad avanzada, control de acceso basado en roles (RBAC) y sistema de onboarding multi-tenant.

## � **CARACTERÍSTICAS DE SEGURIDAD ENTERPRISE**

- ✅ **Refresh Tokens Seguros por Dispositivo** - Validación única por dispositivo
- ✅ **Device Fingerprinting** - Identificación única de dispositivos
- ✅ **IP Address Tracking** - Monitoreo de ubicación de acceso
- ✅ **Browser & OS Detection** - Detección de navegador y sistema operativo
- ✅ **Frequency Control** - Prevención de ataques de fuerza bruta
- ✅ **Auto Token Revocation** - Revocación automática de tokens sospechosos
- ✅ **Comprehensive Security Logging** - Auditoría completa de actividad
- ✅ **Flexible Environment Configuration** - Configuración por entorno

## 🚀 **CARACTERÍSTICAS PRINCIPALES**

### 🔑 **Sistema de Autenticación Avanzado**
- **Registro con verificación de email** automática
- **Login con tracking de dispositivo** y IP
- **Refresh tokens seguros** vinculados a dispositivos específicos
- **Recuperación de contraseñas** con tokens temporales
- **Bloqueo automático** después de intentos fallidos

### 🏢 **Sistema Multi-Tenant Completo**
- **Organizaciones** con roles y permisos
- **Tiendas múltiples** por organización
- **Sistema de onboarding** guiado paso a paso
- **Configuración flexible** por tienda
- **Gestión de direcciones** para organizaciones y tiendas

### 🛡️ **RBAC (Role-Based Access Control)**
- **7 roles jerárquicos** (superadmin, admin, manager, etc.)
- **75+ permisos granulares** por funcionalidad
- **Guards de seguridad multi-nivel** (JWT, Roles, Permisos)
- **API Keys** para integraciones
- **Sessions management** con auditoría

### 📧 **Sistema de Emails Integrado**
- **Verificación de email** automática al registrarse
- **Welcome emails** personalizados
- **Password reset** con tokens seguros
- **Integración con Resend** para deliverability

## 🛠️ **TECNOLOGÍAS**

- **Framework:** NestJS v10
- **Base de Datos:** PostgreSQL v13+
- **ORM:** Prisma v5
- **Autenticación:** JWT con secrets separados
- **Email Service:** Resend API
- **Validación:** class-validator
- **Hashing:** bcryptjs
- **Lenguaje:** TypeScript

## 📋 **PRERREQUISITOS**

- Node.js (v18 o superior)
- npm o yarn
- PostgreSQL (v13 o superior)
- Git
- Cuenta en Resend.com (para emails)

## 🚀 **GUÍA DE INSTALACIÓN RÁPIDA**

### 1️⃣ **Clonar e Instalar**
```bash
# Clonar el repositorio
git clone <repository-url>
cd vendix_backend

# Instalar dependencias
npm install
```

### 2️⃣ **Configurar Variables de Entorno**
```bash
# Copiar plantilla de configuración
cp .env.example .env

# Editar .env con tu configuración:
DATABASE_URL=postgresql://user:password@localhost:5432/vendix_db
JWT_SECRET=your-super-secret-jwt-key-min-32-characters
JWT_REFRESH_SECRET=your-different-refresh-secret-key
RESEND_API_KEY=your-resend-api-key
FROM_EMAIL=noreply@yourcompany.com
```

### 3️⃣ **Configurar Base de Datos**
```bash
# Ejecutar migraciones
npx prisma migrate deploy

# Generar cliente Prisma
npx prisma generate

# (Opcional) Cargar datos de prueba
npx prisma db seed
```

### 4️⃣ **Iniciar Servidor**
```bash
# Desarrollo
npm run start:dev

# El servidor estará disponible en http://localhost:3000
```

## ⚙️ **CONFIGURACIÓN DE SEGURIDAD RECOMENDADA**

### 🏢 **Para Empresas (Configuración por defecto)**
```bash
# .env
STRICT_DEVICE_CHECK=true          # Verificar dispositivo estrictamente
STRICT_IP_CHECK=false             # Flexible con IPs dinámicas
ALLOW_CROSS_DEVICE_REFRESH=false  # No permitir cross-device
MAX_REFRESH_FREQUENCY=30          # 30 segundos entre refreshes
JWT_EXPIRES_IN=1h                 # Access tokens de 1 hora
JWT_REFRESH_EXPIRES_IN=7d         # Refresh tokens de 7 días
```

> 📖 **Para configuración detallada**: Ver `doc/SECURITY_CONFIGURATION.md`

### 3. Configurar Base de Datos y Variables de Entorno

#### 3.1 Crear Base de Datos PostgreSQL

```sql
-- Conectar a PostgreSQL y crear la base de datos
CREATE DATABASE vendix_db;
```

#### 3.2 Configurar Variables de Entorno

Crear un archivo `.env` en la raíz del proyecto:

```env
# Base de Datos
DATABASE_URL="postgresql://username:password@localhost:5432/vendix_db"

# JWT Configuration
JWT_SECRET=tu_clave_secreta_muy_segura_aqui_cambiala_en_produccion
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=tu_clave_refresh_muy_segura_aqui_cambiala_en_produccion  
JWT_REFRESH_EXPIRES_IN=7d

# Puerto de la aplicación
PORT=3000
```

**⚠️ Importante:** Cambia los valores de `JWT_SECRET` y `JWT_REFRESH_SECRET` por claves seguras únicas en producción.

#### 3.3 Ejecutar Migraciones

```bash
# Generar el cliente Prisma
npm run db:generate

# Ejecutar migraciones para crear las tablas
npm run db:migrate
```

### 4. Ejecutar Seed de Datos

```bash
# Ejecutar el seed para crear roles, permisos y usuarios de prueba
npm run db:seed
```

El seed creará:
- **7 roles** del sistema (super_admin, owner, admin, manager, supervisor, employee, customer)
- **75 permisos** granulares para todas las funcionalidades
- **7 usuarios de prueba** con diferentes roles y credenciales

### 5. Credenciales de Administración

#### Super Administrador (Acceso Completo)
- **Email:** `sa@vx.com`
- **Password:** `super1`
- **Username:** `vendixadmin`
- **Permisos:** Todos los 75 permisos del sistema

#### Propietario del Negocio
- **Email:** `owner@vx.com`
- **Password:** `owner1`
- **Username:** `owner`

#### Administrador del Sistema
- **Email:** `admin@vx.com`
- **Password:** `admin1`
- **Username:** `systemadmin`

**📝 Nota:** Existen usuarios adicionales para testing con roles de manager, supervisor, employee y customer. Todos usan el formato `@vx.com` para el email y contraseñas simples para facilitar las pruebas en desarrollo.

### 6. Iniciar la Aplicación

```bash
# Modo desarrollo (con hot reload)
npm run start:dev

# Modo producción
npm run start:prod

# Modo debug
npm run start:debug
```

La aplicación estará disponible en: `http://localhost:3000`

## 🧪 Cómo Probar y Desarrollar

### Testing de Autenticación

1. **Probar Registro:**
```bash
POST http://localhost:3000/auth/register
Content-Type: application/json

{
  "email": "test@example.com",
  "password": "password123",
  "first_name": "Test",
  "last_name": "User"
}
```

2. **Probar Login:**
```bash
POST http://localhost:3000/auth/login
Content-Type: application/json

{
  "email": "sa@vx.com",
  "password": "super1"
}
```

3. **Probar Endpoints Protegidos:**
```bash
GET http://localhost:3000/test/protected
Authorization: Bearer YOUR_JWT_TOKEN
```

### Endpoints de Testing Disponibles

- `GET /test/public` - Endpoint público (sin autenticación)
- `GET /test/protected` - Requiere JWT válido  
- `GET /test/admin` - Solo para administradores
- `GET /test/permissions` - Prueba permisos específicos

### Desarrollo de Nuevas Funcionalidades

#### Proteger Rutas con Guards

```typescript
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, PermissionsGuard } from '../auth/guards';
import { Roles, RequirePermissions, CurrentUser } from '../auth/decorators';

@Controller('products')
export class ProductsController {
  
  // Solo usuarios autenticados
  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(@CurrentUser() user: any) {
    return this.productsService.findAll();
  }
  
  // Solo administradores
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'super_admin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.productsService.remove(+id);
  }
  
  // Permisos específicos
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('products.create')
  @Post()
  create(@Body() createProductDto: CreateProductDto) {
    return this.productsService.create(createProductDto);
  }
}
```

## 🗂️ Estructura del Proyecto

```
src/
├── auth/                    # Sistema de autenticación
│   ├── decorators/          # Decoradores personalizados (@Roles, @RequirePermissions)
│   ├── dto/                 # DTOs de validación
│   ├── guards/              # Guards de seguridad (JWT, Roles, Permissions)
│   ├── strategies/          # Estrategias de Passport (JWT)
│   └── auth.service.ts      # Lógica de autenticación
├── modules/                 # Módulos de lógica de negocio
│   ├── products/
│   ├── orders/
│   ├── customers/
│   └── ...
├── prisma/                  # Servicio de Prisma
├── test/                    # Controladores de testing
└── users/                   # Gestión de usuarios
```

## 🔧 Scripts Disponibles

```bash
# Desarrollo
npm run start:dev          # Iniciar en modo desarrollo
npm run start:debug        # Iniciar en modo debug

# Base de Datos
npm run db:generate         # Generar cliente Prisma
npm run db:migrate          # Ejecutar migraciones
npm run db:seed            # Ejecutar seed de datos
npm run db:studio          # Abrir Prisma Studio

# Testing
npm run test               # Ejecutar tests unitarios
npm run test:e2e           # Ejecutar tests e2e
npm run test:cov           # Coverage de tests

# Producción
npm run build              # Compilar proyecto
npm run start:prod         # Iniciar en modo producción
```

## 📊 Herramientas de Desarrollo

- **Prisma Studio:** `npm run db:studio` - Interfaz visual para la base de datos
- **Hot Reload:** Cambios automáticos en modo desarrollo
- **TypeScript:** Tipado estático para mejor desarrollo
- **ESLint:** Linting automático del código

## 🔐 Seguridad

- Autenticación JWT con tokens de corta duración (15 min)
- Refresh tokens para sesiones extendidas (7 días)
- Hashing de contraseñas con bcrypt (12 rounds)
- Validación de entrada con class-validator
- Sistema de auditoría y logging
- Control granular de permisos

## 📚 Documentación Adicional

- Para detalles de la base de datos, revisa `prisma/schema.prisma`
- Para ejemplos de uso, consulta los controladores en `src/test/`

---

**🎯 ¡Listo para desarrollar!** El sistema está completamente configurado y listo para usar.
