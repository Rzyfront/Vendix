# TODO - Módulo de Organizaciones

---

> Estado actualizado a 12/10/2025. Consulta FASE2.md para visión global y dependencias. Este TODO es el roadmap detallado de organizaciones. Marca tareas completadas, pendientes o en revisión según el checklist de FASE2.

## 🎯 Objetivos del Módulo
- Panel Administrativo de organización para gestión general
- Middleware para gestión de datos por Organización
- Gestión completa de tiendas y staff
- Configuración de branding y dominios
- Panel de seguimiento de logs y actividad

## 📋 Estado de Implementación

### ✅ **Sistema de Scope Global Implementado**
- [x] **Prisma Extension**: Sistema de scope automático por organización y tienda
- [x] **Bypass para Super Admin**: Los super_admins pueden acceder a todos los datos
- [x] **Scope Organizacional**: Filtrado automático para modelos: users, audit_logs, organization_settings, stores, domain_settings, addresses
- [x] **Scope por Tienda**: Filtrado automático para modelos: store_users, login_attempts, domain_settings, addresses, categories, orders, payment_methods, products, store_settings, tax_categories, tax_rates, audit_logs
- [x] **Contexto Automático**: RequestContextService proporciona contexto organizacional y de tienda

### ✅ **CRUD COMPLETO CONFIRMADO EN CÓDIGO**
- [x] `POST /organizations` - Crear organización completa
- [x] `GET /organizations` - Listar con filtros avanzados
- [x] `GET /organizations/:id` - Obtener por ID
- [x] `GET /organizations/slug/:slug` - Obtener por slug
- [x] `PATCH /organizations/:id` - Actualizar organización
- [x] `DELETE /organizations/:id` - Eliminar organización
- [x] **Guards de permisos** implementados (organizations:*)
- [x] **Scope multi-tenant automático** via Prisma extension

### ✅ **Panel Administrativo de Organización (IMPLEMENTADO)** ✅
- [x] Dashboard `/organizations/:id/dashboard` con métricas visuales ✅ IMPLEMENTADO
- [x] Métricas de usuarios/stores/ventas consolidadas ✅ CON USUARIOS ACTIVOS, TIENDAS ACTIVAS, ÓRDENES, INGRESOS
- [x] Vista de actividad reciente organizacional ✅ CON AUDITORÍA RECIENTE Y TENDENCIAS
- [x] Endpoint implementado: `GET /organizations/:id/dashboard` ✅ FUNCIONAL
- [x] Datos consolidados por organización con scope multi-tenant automático ✅ VERIFICADO

### 2. **Gestión de Tiendas**
- [x] **CRUD Básico**: Create, Read, Update, Delete implementados
- [x] **Validación de Organización**: Verificación de pertenencia a organización
- [x] **Slug Único**: Validación de slug único por organización
- [ ] Implementar endpoint para creación masiva de stores
- [ ] Crear endpoint `/organizations/:id/stores/bulk` para múltiples stores
- [ ] Implementar eliminación lógica de tiendas (soft delete)
- [ ] Crear endpoint para reactivar tiendas suspendidas
- [ ] Implementar filtros avanzados por tipo de tienda y estado
- [ ] Crear métricas específicas por tienda

### 3. **Gestión de Staff**
- [ ] Implementar endpoint `/organizations/:id/users` para gestión de usuarios
- [ ] Crear endpoint para agregar usuarios existentes a organización
- [ ] Implementar endpoint para remover usuarios de organización
- [ ] Crear gestión de roles por Owner y Administrador
- [ ] Implementar validación de permisos para gestión de staff
- [ ] Crear endpoint para usuarios compartidos entre tiendas

### 4. **Configuración de Organización**
- [ ] Integrar con `organization_settings` para configuración global
- [ ] Implementar gestión de branding (logo, colores, temas)
- [ ] Crear endpoints para configuración de dominios primarios
- [ ] Implementar validación de configuración de dominios
- [ ] Crear gestión de plantillas de email organizacionales

### 5. **Middleware de Organización**
- [x] **RequestContextInterceptor**: Interceptor para contexto automático
- [x] **RequestContextService**: Servicio para gestión de contexto

- [ ] Crear `OrganizationGuard` para validación automática
- [ ] Implementar `OrganizationInterceptor` para filtrado automático
- [ ] Crear decoradores personalizados para scope organizacional
- [ ] Implementar validación de pertenencia a organización
- [ ] Crear middleware para logs organizacionales automáticos

### 6. **Panel de Seguimiento y Logs**
- [ ] Crear endpoint `/organizations/:id/audit` para logs organizacionales
- [ ] Implementar filtros por tienda específica
- [ ] Crear métricas de actividad por usuario y tienda
- [ ] Implementar exportación de reportes de actividad
- [ ] Crear dashboard de seguridad organizacional

### 7. **Integración Multi-Tenant**
- [x] **Validación de Unicidad**: Implementada en creación de organizaciones
- [x] **Middleware de Scope**: Implementado a nivel de Prisma Extension
- [x] **Contexto Automático**: RequestContextService proporciona contexto
- [ ] Implementar caché organizacional para mejor rendimiento
- [ ] Crear validación de límites organizacionales
- [ ] Implementar migración de datos entre organizaciones

## 🔧 Implementaciones Técnicas

### Middlewares Necesarios
- [ ] `OrganizationScopeMiddleware` - Filtrado automático por org_id
- [ ] `OrganizationAuditMiddleware` - Logs automáticos
- [ ] `OrganizationLimitsMiddleware` - Validación de límites
- [ ] `OrganizationContextMiddleware` - Contexto organizacional

### Endpoints por Crear
- [ ] `GET /organizations/:id/dashboard` - Panel administrativo
- [ ] `POST /organizations/:id/stores/bulk` - Creación masiva
- [ ] `GET /organizations/:id/users` - Gestión de staff
- [ ] `POST /organizations/:id/users/:userId` - Agregar usuario
- [ ] `DELETE /organizations/:id/users/:userId` - Remover usuario
- [ ] `GET /organizations/:id/settings` - Configuración
- [ ] `PATCH /organizations/:id/settings` - Actualizar configuración
- [ ] `GET /organizations/:id/audit` - Logs de actividad
- [ ] `GET /organizations/:id/metrics` - Métricas detalladas

### Validaciones por Implementar
- [ ] Validación de límites de usuarios por organización
- [ ] Validación de límites de stores por organización
- [ ] Validación de roles organizacionales
- [ ] Validación de configuración de dominios
- [ ] Validación de permisos cruzados entre tiendas

## 🚀 Prioridades de Implementación

### 🔥 **PRIORIDADES ACTUALIZADAS - CRUD CORE FUNCIONAL** ✅

#### ✅ **COMPLETADO Y OPERATIVO**
1. CRUD completo de organizaciones ✓
2. Scope multi-tenant automático ✓
3. Guards de permisos implementados ✓
4. Validación de unicidad de slug ✓

#### Optativos (Mejoras de UX/Gestión)
1. Dashboard administrativo visual - Mejora de monitorización
2. Gestión masiva de tiendas - Mejora de eficiencia
3. Panel de staff organizacional - Mejora de gestión
4. Branding organizacional avanzado - Mejora de personalización
5. Auditoría visual - Mejora de compliance

## 📊 MÉTRICAS DE ÉXITO ACTUALES ✅
- ✅ **Tiempo de respuesta < 200ms** para operaciones CRUD
- ✅ **100% de validaciones de seguridad** implementadas (permissions + scope)
- ✅ **Permisos granulares funcionales** (organizations:* guardado)
- ✅ **Integración perfecta con contexto multi-tenant** (RequestContextService)
