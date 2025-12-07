# Vendix Backend

Un backend enterprise-grade para e-commerce construido con NestJS, Prisma y PostgreSQL. Diseñado con una arquitectura multi-tenant robusta, incluye autenticación JWT avanzada, control de acceso basado en roles (RBAC), permisos granulares y un sistema inteligente de scoping de datos.

## 🌟 **NOVEDADES Y ARQUITECTURA ACTUAL**

### 🛡️ **Seguridad Global y Contextual**
- **Global Authentication**: `JwtAuthGuard` está configurado globalmente. Todas las rutas son privadas por defecto. (Usa `@Public()` para excepciones).
- **Auto-Scoping de Datos**: Implementamos `RequestContextService` con `AsyncLocalStorage`.
    - **`OrganizationPrismaService`**: Inyecta automáticamente `organization_id` en todas las queries.
    - **`StorePrismaService`**: Inyecta automáticamente `store_id` en todas las queries.
    - **Beneficio**: Previene fugas de datos entre tenants sin necesidad de filtros manuales en cada controlador.

### 🏗️ **Estructura de Dominios (DDD)**
El proyecto se organiza en dominios claros para separar responsabilidades:
- **`domains/auth`**: Autenticación, Guards, Decorators.
- **`domains/organization`**: Funcionalidades nivel Organización (Usuarios, Roles, Configuración Global).
- **`domains/store`**: Funcionalidades nivel Tienda (Inventario, Ventas, Pagos).
- **`domains/superadmin`**: Gestión de plataforma (SaaS Admin).

---

## 🚀 **CARACTERÍSTICAS PRINCIPALES**

### 🔑 **Sistema de Autenticación Avanzado**
- **Registro con verificación de email** automatizada.
- **Login seguro** con rastreo de IP y Fingerprinting.
- **Refresh tokens** rotativos vinculados al dispositivo.
- **Bloqueo automático** ante fuerza bruta.

### 🏢 **Multi-Tenant Real**
- **Aislamiento lógico** de datos por Organización y Tienda.
- **Jerarquía**: SuperAdmin -> Organización -> Tienda.
- **Onboarding Wizard**: Flujo guiado para nuevas organizaciones.

### 🛡️ **RBAC & Permisos Granulares**
- **Roles Globales y Locales**:
    - `SUPER_ADMIN`: Acceso total al SaaS.
    - `OWNER`, `ADMIN`: Gestión de Organización.
    - `MANAGER`, `CASHIER`: Gestión de Tienda.
- **Permisos Namespaced**: Estructura `contexto:modulo:accion` (ej. `organization:audit:read`, `store:inventory:create`).
- **Guards en Cascada**: `JwtAuthGuard` (Global) -> `RolesGuard` -> `PermissionsGuard`.

---

## 🛠️ **TECNOLOGÍAS**

- **Framework:** NestJS v10
- **Base de Datos:** PostgreSQL v13+
- **ORM:** Prisma v5 (con extensiones para RLS lógico)
- **Email:** Resend API
- **Validación:** class-validator & class-transformer
- **Seguridad:** Helmet, RateLimiting, BCrypt

---

## 📋 **PRERREQUISITOS**

- Node.js (v18+)
- PostgreSQL (v13+)
- Claves API (Resend, etc.)

---

## 🚀 **GUÍA DE INSTALACIÓN RÁPIDA**

### 1️⃣ **Configuración Inicial**
```bash
# Instalar dependencias
npm install

# Configurar entorno
cp .env.example .env
```

### 2️⃣ **Base de Datos**
Asegúrate de tener la DB creada y configura `DATABASE_URL` en `.env`.
```bash
# Migraciones
npx prisma migrate deploy

# Generar cliente
npx prisma generate

# Seed de datos (Roles, Permisos, Usuarios Base)
npx prisma db seed
```

### 3️⃣ **Ejecutar**
```bash
# Desarrollo
npm run start:dev
# Acceso: http://localhost:3000/api
# Swagger: http://localhost:3000/api-docs
```

---

## 🔐 **GUÍA DE DESARROLLO Y SEGURIDAD**

### Cómo proteger un nuevo Controlador

Gracias a la arquitectura actual, el código es limpio y seguro por defecto.

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

@Controller('organization/example')
@UseGuards(PermissionsGuard) // 1. RolesGuard es opcional si solo validas permisos, Jwt es global.
export class ExampleController {
  
  @Get()
  @Permissions('organization:example:read') // 2. Permiso específico namespaced
  findAll() {
    // 3. El servicio usa OrganizationPrismaService, 
    // por lo que los datos retornados ya están filtrados por la organización del usuario.
    return this.service.findAll();
  }
}
```

### Estructura de Directorios Actualizada
```
src/
├── app.module.ts            # Configuración Global (Guards, Interceptors)
├── common/                  # Utilidades, Filtros, Pipes
├── prisma/                  # Configuración Prisma & Seed
└── domains/                 # Lógica de Negocio
    ├── auth/                # Auth System
    ├── organization/        # Dominio Organización
    ├── store/               # Dominio Tienda
    └── superadmin/          # Dominio SuperAdmin
```

### Usuarios por Defecto (Seed)
- **Super Admin**: `sa@vx.com` / `super1`
- **Owner**: `owner@vx.com` / `owner1`
- **Admin**: `admin@vx.com` / `admin1`

---

## 🧪 **TESTING**

```bash
npm run test        # Unit tests
npm run test:e2e    # End-to-end (integración)
```

---
**Vendix Backend V2.0** - *Seguridad y Escalabilidad Enterprise*
