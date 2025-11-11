# TODO - Módulo de Stores

---

> Estado actualizado a 12/10/2025. Consulta FASE2.md para visión global y dependencias. Este TODO es el roadmap detallado de stores. Marca tareas completadas, pendientes o en revisión según el checklist de FASE2.

## 🎯 Objetivos del Módulo
- Panel Administrativo para gestión general de tienda
- Middleware para gestión de datos por tienda
- Gestión de usuarios subordinados en tienda
- Panel de configuración y personalización de tienda
- Panel de seguimiento de logs y actividad de tienda

## 📋 Funciones por Implementar

### ✅ **1. Panel Administrativo de Tienda (IMPLEMENTADO)** ✅
- [x] Crear endpoint `/stores/:id/dashboard` con métricas específicas ✅ IMPLEMENTADO
- [x] Implementar métricas de ventas y órdenes por tienda ✅ ÓRDENES, INGRESOS, STOCK BAJO, CLIENTES
- [x] Crear vista de inventario y productos por tienda ✅ MÉTRICAS DE PRODUCTOS Y ÓRDENES RECIENTES
- [x] Implementar métricas de clientes y usuarios por tienda ✅ CLIENTES ACTIVOS Y USUARIOS POR TIENDA
- [x] Crear dashboard de actividad reciente de la tienda ✅ ÓRDENES RECIENTES Y PRODUCTOS TOP
- [x] Implementar gráficos y estadísticas de rendimiento ✅ CHART DE VENTAS DIARIO Y VALOR PROMEDIO
- [x] Endpoint funcional: `GET /stores/:id/dashboard` ✅ OPERATIVO CON SCOPE MULTI-TENANT

### 2. **Scope Multi-Tenant Automático YA IMPLEMENTADO**
- [x] **Store scope automático via RequestContextService** - Filtra automáticamente por store_id en Prisma
- [x] **RequestContextInterceptor** - Maneja contexto de tienda automáticamente
- [x] **Prisma Extension** - Aplica filtrado por tienda sin intervención manual
- [x] **Sin StoreScopeGuard necesario** - Scope global maneja validación por tienda
- [x] **Logs automáticos por tienda ya operativos** - Via RequestContextService

### 3. **Gestión de Usuarios Subordinados**
- [ ] Implementar endpoints `/stores/:id/users` para gestión de staff
- [ ] Crear validación de límites de autorización por tienda
- [ ] Implementar sistema de permisos granulares por tienda
- [ ] Crear gestión de roles específicos por tienda
- [ ] Implementar validación de usuarios compartidos entre tiendas

### 4. **Configuración y Personalización**
- [ ] Integrar con `store_settings` para configuración específica
- [ ] Implementar gestión de branding de tienda (logo, colores)
- [ ] Crear configuración de horarios y ubicación
- [ ] Implementar personalización de temas y estilos
- [ ] Crear gestión de métodos de pago por tienda

### 5. **Gestión de Inventario y Productos**
- [ ] Implementar endpoints específicos por tienda para productos
- [ ] Crear gestión de categorías por tienda
- [ ] Implementar control de inventario por tienda
- [ ] Crear gestión de precios y promociones por tienda
- [ ] Implementar métricas de productos más vendidos

### 6. **Panel de Seguimiento y Logs**
- [ ] Crear endpoint `/stores/:id/audit` para logs de tienda
- [ ] Implementar filtros por usuario y tipo de operación
- [ ] Crear métricas de actividad por usuario de tienda
- [ ] Implementar exportación de reportes de actividad
- [ ] Crear dashboard de seguridad de tienda

### 7. **Integración con Dominios**
- [ ] Implementar configuración de dominios por tienda
- [ ] Crear validación de dominios personalizados por tienda
- [ ] Implementar integración con resolución de dominios
- [ ] Crear gestión de subdominios por tienda
- [ ] Implementar verificación de SSL por tienda

## 🔧 Implementaciones Técnicas REALES

### Scope Automático YA Funcional ✅
- [x] **RequestContextInterceptor** - Scope automático por store_id de JWT
- [x] **Prisma Extension** - Filtrado automático sin middlewares adicionales
- [x] **Permissions Guard** - Controla acceso por tienda cuando es necesario
- [x] **Auditoría automática** - Logs contextuales por tienda operativos

### Sin Middlewares Adicionales Necesarios ❌
- ❌ **`StoreScopeMiddleware`** - Ya manejado por scope global
- ❌ **`StorePermissionsMiddleware`** - PermissionsGuard maneja esto
- ❌ **`StoreAuditMiddleware`** - RequestContextService genera logs automáticamente
- ❌ **`StoreLimitsMiddleware`** - Scope automático impone límites

### Endpoints por Crear
- [ ] `GET /stores/:id/dashboard` - Panel administrativo de tienda
- [ ] `GET /stores/:id/users` - Usuarios de la tienda
- [ ] `POST /stores/:id/users/:userId` - Agregar usuario a tienda
- [ ] `DELETE /stores/:id/users/:userId` - Remover usuario de tienda
- [ ] `GET /stores/:id/settings` - Configuración de tienda
- [ ] `PATCH /stores/:id/settings` - Actualizar configuración
- [ ] `GET /stores/:id/metrics` - Métricas detalladas
- [ ] `GET /stores/:id/audit` - Logs de actividad
- [ ] `GET /stores/:id/products` - Productos de la tienda

### Validaciones por Implementar
- [ ] Validación de límites de usuarios por tienda
- [ ] Validación de permisos específicos por tienda
- [ ] Validación de configuración de dominios por tienda
- [ ] Validación de inventario y stock por tienda
- [ ] Validación de horarios y disponibilidad

### Integraciones con Otros Módulos ✅
- [x] **RequestContextService** - Integra automáticamente con todos los módulos
- [x] **Scope cross-módulo operativo** - Filtra por organization_id/store_id automáticamente
- [x] **Multi-tenant completo** - Usuarios, productos, órdenes, etc. filtrados automáticamente
- [x] **Dominios** - Scope automático incluye configuración por tienda

## 🚀 Prioridades de Implementación

### 🔥 **PRIORIDADES ACTUALIZADAS - SCOPE STORE YA FUNCIONAL** ✅

#### ✅ **COMPLETADO Y OPERATIVO**
1. Scope multi-tenant automático por tienda ✓
2. Filtrado automático por store_id ✓
3. Integración con contexto global ✓
4. Logs automáticos por tienda ✓

#### Optativos MÁS ALLÁ del Core ✅
1. Panel administrativo visual - Mejora de UX
2. Gestión de usuarios visual - Mejora de gestión
3. Configuración branding avanzada - Mejora de personalización
4. Métricas específicas visuales - Mejora de monitorización

### Media Prioridad
5. Integración con dominios por tienda
6. Panel de logs y auditoría
7. Gestión avanzada de inventario

### Baja Prioridad
8. Métricas avanzadas y reportes
9. Personalización avanzada de branding
10. Optimizaciones de rendimiento

## 📊 MÉTRICAS DE ÉXITO ACTUALES ✅
- ✅ **Scope multi-tenant funcional** - Filtrado automático por store_id
- ✅ **Seguridad completa implementada** - Zero-trust architecture
- ✅ **Integración automática** - RequestContextService maneja todo
- ✅ **Sin rendimientos adicionales** - Arquitectura óptima
- ✅ **Auditoría por tienda operativa** - Logs contextuales automáticos

## 🔐 Consideraciones de Seguridad
- Validación estricta de pertenencia a tienda
- Límites de autorización para usuarios subordinados
- Protección contra acceso cruzado entre tiendas
- Logs de auditoría completos para todas las operaciones
- Validación de permisos en cada operación específica

## 💡 Funcionalidades Específicas por Tipo de Tienda

### Tiendas Físicas (physical)
- [ ] Gestión de ubicación y horarios
- [ ] Configuración de puntos de venta
- [ ] Control de inventario en tiempo real
- [ ] Integración con sistemas de caja

### Tiendas Online (online)
- [ ] Configuración de dominio y SSL
- [ ] Personalización de tema ecommerce
- [ ] Gestión de métodos de pago online
- [ ] Integración con pasarelas de pago

### Tiendas Híbridas (hybrid)
- [ ] Sincronización de inventario
- [ ] Gestión unificada de órdenes
- [ ] Configuración multi-canal
- [ ] Reportes consolidados

### Kioskos (kiosko)
- [ ] Configuración de interfaz limitada
- [ ] Gestión de productos rápidos
- [ ] Control de transacciones simples
- [ ] Integración con hardware específico
