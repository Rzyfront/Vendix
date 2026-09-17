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

### Type-check del arnés (specs incluidas, `scripts/` excluido)

`tsconfig.check.json` extiende `tsconfig.json` con una superficie **positiva**
y explícita — `"include": ["src/**/*", "prisma/**/*", "prisma.config.ts"]`
(ronda 3, F4; antes era por exclusión: `"exclude": ["node_modules", "dist",
"scripts"]`, heredando el `include` implícito `**/*` de `tsconfig.json`) — a
diferencia de `tsconfig.build.json`, **sí** tipa `**/*spec.ts`. Es el único
sitio donde este repo tipa la aritmética de dinero de las specs sin tocar
producción; `scripts/` no se despliega en la imagen de producción y queda
fuera del `include`, así que sus errores no bloquean este gate. `test/**`
también queda fuera a propósito: corre bajo otro runner
(`test/jest-e2e.json`) y ningún job de CI lo invoca, así que tiparlo aquí
daría una falsa sensación de cobertura. El `.tsbuildinfo` incremental vive en
`node_modules/.cache/tsconfig.check.tsbuildinfo` — no en `dist/`, que `nest
build` borra un paso después (`nest-cli.json`: `"deleteOutDir": true`).

**Requiere `npx prisma generate` previo en un clon limpio.** El cliente
Prisma generado vive en `node_modules/@prisma/client` (gitignored, no se
commitea) y 412 archivos bajo `src/` lo importan; sin generarlo antes, este
comando falla por módulos faltantes, no por errores de tipos reales.

```bash
npx prisma generate        # una vez, en un clon limpio o tras cambiar el schema
npm run buildcheck:types   # tsc -p tsconfig.check.json --noEmit
```

### Ejecutar tests por ruta (`test:path`)

`test:path` invoca jest directamente, **acotado a la ruta indicada** (un spec
o un directorio), con `--runInBand` (un solo proceso, sin worker pool) y
propagando el **código de salida real** de jest. Se llamó `buildcheck:test`
hasta la auditoría F-162 del plan `CP-pos-exclusive-tax-double-charge`
(QUI-832): colisionaba de nombre con el script `buildcheck:test` de la raíz
del monorepo (`bash scripts/buildcheck.sh --test`), que existe desde antes y
sigue existiendo con ese nombre — con el mismo nombre en dos `package.json`
había que saber desde qué directorio se invocaba para saber cuál corría.

El motivo de `test:path` **no** es que el script de la raíz mienta sobre su
código de salida: medido dos veces de forma independiente, `bash
scripts/buildcheck.sh --test <ruta>` devolvió el código de salida real (no
cero) ante un jest rojo por fallo de aserción, igual que este script.
`scripts/buildcheck.sh` ya acepta un filtro de ruta y ya usa `--runInBand` en
ese modo (`scripts/buildcheck.sh:72-75` y `:449-456`). El único modo en el que
el script de la raíz puede imprimir `FAIL` y salir con `0` es al correr la
suite **completa sin filtro** (pool de varios workers), si uno de ellos muere
por OOM antes de reportar — un escenario distinto del fallo de aserción, y no
el que motiva este script. La razón real de `test:path` es de conveniencia:
es la invocación directa, sin el envoltorio de la raíz, para cuando ya se
está trabajando dentro de `apps/backend`.

```bash
npm run test:path -- src/domains/store/taxes
npm run test:path -- src/domains/store/taxes/some.spec.ts
```

**La suite completa de jest NO es una compuerta de este plan.** Cada paso
verifica únicamente sus propios archivos de prueba, por ruta. Correr todo
`apps/backend/src` toma ≈10 h, muy por encima del `timeout-minutes: 25` de
CI, y el job `backend-test` de `.github/workflows/ci.yml` está en `if: false`
desde el 2026-08-14. Un cambio que necesite correr toda la suite como
compuerta requiere su propio plan.

### Qué corre hoy en CI (y qué no) — `backend-test-scoped`

`backend-test` (arriba) sigue en `if: false` — **ningún** PR lo dispara. Eso
**no** significa que ninguna spec del backend corra en CI: el job
`backend-test-scoped` de `.github/workflows/ci.yml` sí corre en cada PR que
toque `apps/backend/**`, con `test:path` acotado a cuatro directorios
(`payments`, `orders`, `tables`, `taxes` — 36 specs). Lo que **no** corre en
ningún job es el resto: 365 specs de las 401 del repo, `invoicing` incluido
(93 specs él solo, el directorio más grande fuera del alcance). Ese carril de
facturación se verifica por archivo, spec a spec, en los pasos C.x del plan
`CP-pos-exclusive-tax-double-charge` — no por un job de CI que lo corra
completo.

---
**Vendix Backend V2.0** - *Seguridad y Escalabilidad Enterprise*
