# FASE 2 - Plan de Desarrollo Vendix Backend

## 🎯 Objetivo General
Completar la implementación del sistema multi-tenant de Vendix, enfocándose en la integración contextual, paneles administrativos y funcionalidades avanzadas de gestión.

## 📋 Módulos y Prioridades de Desarrollo

### � Referencias a TODO.md por módulo

- [Audit TODO](apps/backend/src/modules/audit/TODO.md)
- [Auth TODO](apps/backend/src/modules/auth/TODO.md)
- [Domains TODO](apps/backend/src/modules/domains/TODO.md)
- [Organizations TODO](apps/backend/src/modules/organizations/TODO.md)
- [Permissions TODO](apps/backend/src/modules/permissions/TODO.md)
- [Roles TODO](apps/backend/src/modules/roles/TODO.md)
- [Stores TODO](apps/backend/src/modules/stores/TODO.md)
- [Users TODO](apps/backend/src/modules/users/TODO.md)

### �🚀 ALTA PRIORIDAD - Core Multi-Tenant

#### 1. **Módulo de Autenticación**
**Objetivo**: Implementar login contextual por organización/tienda
- Login con resolución automática de dominio
- Middleware de autenticación contextual
- Gestión de sesiones multi-tenant
- Integración con sistema de dominios

**Estado Actual - FLUJO AUTOMÁTICO COMPLETO**:
- ✅ **Sistema de resolución de dominio completamente automático** (`DomainDetectorService`)
- ✅ Login contextual funcional con flujo automático
- ✅ RequestContextInterceptor + Prisma scope automático global
- ✅ JWT con contexto completo (organization_id, store_id, roles)

**Flujo Automático Completo**:
1. **Usuario accede a dominio** (ej: tienda.mitienda.com)
2. **Frontend automáticamente detecta y resuelve dominio** via `DomainDetectorService.detectDomain()`
3. **API call automático**: `/api/public/domains/resolve/{dominio}` → retorna `organization_slug` y `store_slug`
4. **Frontend automáticamente añade slugs detectados al login** (sin intervención del usuario)
5. **Login envía**: credenciales + `organization_slug` O `store_slug` (auto-detectados)
6. JWT se genera con contexto completo (organization_id, store_id, roles)
7. **Todas las operaciones posteriores son automáticamente contextualizadas** por Prisma scope

**Ventajas del Flujo Automático**:
- ✅ **Cero intervención del usuario**: dominio → resolución → login contextual automático
- ✅ **Seguro y transparente**: contexto detectado automáticamente
- ✅ **Escalable**: funciona con cualquier dominio/organización/tienda configurada

#### 2. **Módulo de Organizaciones** 
**Objetivo**: Panel administrativo completo de organización
- Dashboard con métricas organizacionales
- Gestión de staff y usuarios
- Configuración de branding y dominios
- Panel de seguimiento de logs

**Tareas Críticas**:
- ✅ Endpoint `/organizations/:id/dashboard`
- ✅ Gestión de usuarios por organización
- ✅ Configuración de organización
- ❓ Panel de logs organizacionales (existe logging, pero falta UI y filtros avanzados)

#### 3. **Módulo de Usuarios**
**Objetivo**: Sistema completo de gestión multi-tenant de usuarios
- Panel administrativo de usuarios
- Middleware de scope automático
- Gestión de perfiles y configuración
- Integración con autenticación contextual

**Tareas Críticas**:
- ✅ Panel administrativo de usuarios
- ✅ UserOrganizationGuard y UserStoreGuard
- ✅ Gestión de perfiles de usuario
- ✅ Integración con login contextual

### 📈 MEDIA PRIORIDAD - Funcionalidades Avanzadas

#### 4. **Módulo de Roles**
**Objetivo**: Sistema avanzado de roles multi-contexto
- Middleware de filtrado automático
- Roles por entorno específico
- Límites para roles de bajo alcance
- Panel de gestión de roles

**Tareas Principales**:
- ✅ RoleScopeGuard para filtrado automático
- ✅ Roles organizacionales y por tienda
- ❓ Límites de operaciones por rol (lógica básica, falta refinar reglas y UI)
- ❌ Dashboard de gestión de roles

#### 5. **Módulo de Dominios**
**Objetivo**: Completar integración y branding
- Panel de gestión de dominios
- Integración con branding
- Middleware de resolución
- Métricas y reportes

**Tareas Principales**:
- ✅ Panel de gestión de dominios
- ✅ Configuración de branding por dominio
- ❌ DomainResolutionMiddleware (el archivo fue eliminado, requiere reimplementación)
- ❌ Métricas de disponibilidad

#### 6. **Módulo de Auditoría**
**Objetivo**: Sistema completo de monitoreo y alertas
- Panel de seguimiento de logs
- Sistema de alertas y notificaciones
- Métricas y reportes avanzados
- Gestión de retención

**Tareas Principales**:
- ✅ Endpoints de logs por organización/tienda
- ❌ Sistema de alertas automáticas
- ❓ Dashboard de auditoría (existe logging, falta UI y métricas visuales)
- ❌ Políticas de retención

### 🔧 BAJA PRIORIDAD - Optimizaciones

#### 7. **Módulo de Stores**
**Objetivo**: Funcionalidades avanzadas de tiendas
- Creación masiva de stores
- Gestión avanzada de inventario
- Métricas específicas por tienda
- Personalización avanzada

**Tareas de Optimización**:
- ✅ Creación masiva de stores
- ❓ Métricas avanzadas por tienda (básicas listas, falta profundidad y reporting)
- ✅ Personalización de branding
- ❓ Optimizaciones de rendimiento (mejoras posibles, revisar profiling)

#### 8. **Módulo de Permisos**
**Objetivo**: Funcionalidades avanzadas de permisos
- Permisos condicionales y temporales
- Caché y optimizaciones
- Dashboard de permisos
- Reportes de seguridad

**Tareas de Optimización**:
- ❌ Permisos condicionales
- ❓ Sistema de caché (básico, falta optimización avanzada)
- ❌ Dashboard de métricas
- ❌ Exportación de permisos

## 🔄 Orden Recomendado de Implementación

### Fase 2.1 - Core Contextual (Semanas 1-4)
1. **Autenticación Contextual** - Base del sistema multi-tenant
2. **Panel Organizaciones** - Gestión central de organizaciones  
3. **Gestión Usuarios** - Sistema completo de usuarios

## 🔒 Alcance y Contexto de Autenticación

### Scope de JwtAuthGuard (AuthGuard)
El `JwtAuthGuard` es el guard principal que protege las rutas privadas de la API. Su función es:
- Validar el JWT enviado en la petición.
- Extraer la información del usuario y adjuntarla a `req.user`.
- Permitir rutas públicas mediante decoradores o paths configurados.
Esto asegura que solo usuarios autenticados accedan a recursos protegidos, y que la información del usuario esté disponible para el resto del flujo.

### Scope de Contexto de Request (RequestContextService)
El `RequestContextService` utiliza `AsyncLocalStorage` para mantener el contexto de cada request de forma aislada y automática. Su funcionamiento es:
- Tras la autenticación, un middleware/interceptor crea un contexto con los datos del usuario (id, organización, tienda, roles, etc).
- Este contexto se almacena y es accesible globalmente durante toda la vida del request, sin necesidad de pasarlo manualmente entre funciones o servicios.
- PrismaService y otros servicios pueden acceder a este contexto para aplicar filtros automáticos multi-tenant (por ejemplo, filtrar por `organization_id` o `store_id` en todas las queries).

### Integración y Ventajas
- El guard de autenticación y el contexto de request trabajan juntos: primero se valida el usuario, luego se crea el contexto multi-tenant.
- Esto permite que toda la lógica de negocio y acceso a datos sea automáticamente "contextual", es decir, restringida al tenant/organización/tienda correspondiente.
- El desarrollador no necesita agregar manualmente filtros de organización o tienda en cada query, reduciendo errores y mejorando la seguridad.

**Resumen:**
El scope de autenticación (AuthGuard) asegura que solo usuarios válidos accedan, y el scope de contexto (RequestContextService) garantiza que todas las operaciones se realicen dentro del contexto correcto del tenant, logrando un verdadero aislamiento multi-tenant y simplificando el desarrollo seguro.

## 🗄️ PrismaService y Scope Multi-Tenant Automático

El `PrismaService` implementa una extensión personalizada que aplica el scope multi-tenant de forma automática en todas las operaciones de base de datos:

- Intercepta todas las queries y operaciones de escritura/lectura sobre los modelos relevantes.
- Inyecta automáticamente los campos `organization_id` y/o `store_id` en las operaciones según el contexto actual (obtenido de `RequestContextService`).
- Para operaciones de escritura (`create`, `createMany`, `upsert`), añade los IDs correspondientes en los datos insertados.
- Para operaciones de lectura y actualización (`findMany`, `update`, `delete`, etc.), agrega filtros de seguridad para asegurar que solo se acceda a datos del tenant/organización/tienda actual.
- Si el usuario es super admin o el modelo no es multi-tenant, omite el filtrado.

**Ventajas:**
- El desarrollador no necesita preocuparse por filtrar manualmente por organización o tienda en cada query.
- Se reduce el riesgo de fugas de datos entre tenants y se refuerza la seguridad multi-tenant.
- El scope es transparente y consistente en toda la aplicación.

**Resumen:**
El `PrismaService` es el encargado de aplicar el aislamiento multi-tenant a nivel de base de datos, usando el contexto de request para filtrar y proteger los datos de cada organización y tienda de forma automática y centralizada.

### Fase 2.2 - Roles Avanzados (Semanas 5-8)
4. **Roles Multi-Contexto** - Sistema avanzado de autorización
5. **Dominios Completos** - Integración final de dominios
6. **Auditoría Avanzada** - Sistema completo de monitoreo

### Fase 2.3 - Optimizaciones (Semanas 9-12)
7. **Stores Avanzados** - Funcionalidades de tiendas
8. **Permisos Avanzados** - Optimizaciones de seguridad

## 📊 Métricas de Éxito por Fase

### Fase 2.1
- ✅ Login contextual funcionando
- ✅ Panel organizacional completo
- ✅ Gestión de usuarios multi-tenant
- ⏱️ Tiempo de respuesta < 200ms

### Fase 2.2  
- ✅ Sistema de roles multi-contexto
- ✅ Integración completa de dominios
- ✅ Sistema de alertas de auditoría
- 📈 99.9% disponibilidad de autenticación

### Fase 2.3
- ✅ Funcionalidades avanzadas de stores
- ✅ Optimizaciones de permisos
- ✅ Reportes y métricas completos
- 🔒 100% validaciones de seguridad

## 🎯 Enfoque de Desarrollo

### Principios Guía
1. **Contexto Primero**: Implementar autenticación contextual antes que paneles
2. **Seguridad por Defecto**: Validaciones multi-tenant en cada operación
3. **Experiencia de Usuario**: Paneles intuitivos y métricas claras
4. **Escalabilidad**: Diseño pensado para crecimiento multi-organizacional

### Criterios de Aceptación
- Integración perfecta entre módulos
- Performance optimizado para carga multi-tenant
- Auditoría completa de todas las operaciones
- Experiencia de usuario consistente across organizaciones

## 🔧 Consideraciones Técnicas

### Dependencias entre Módulos
```
Autenticación → Organizaciones → Usuarios
     ↓              ↓             ↓
  Roles → Dominios → Auditoría → Stores
```

### Integraciones Críticas
- Autenticación ↔ Dominios (resolución contextual)
- Organizaciones ↔ Usuarios (gestión de staff)
- Roles ↔ Permisos (sistema de autorización)
- Auditoría ↔ Todos (logs automáticos)

Este plan asegura un desarrollo progresivo y estructurado, construyendo sobre la base sólida ya implementada en Fase 1.
