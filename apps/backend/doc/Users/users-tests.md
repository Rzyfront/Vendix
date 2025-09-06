# VENDIX - Users Module Test Explanations

## 📋 Descripción General

Este documento explica detalladamente todas las pruebas HTTP implementadas en `users-tests.http` para el módulo de usuarios de VENDIX. Las pruebas están organizadas por categorías y cubren todos los aspectos del sistema de gestión de usuarios.

## 🏗️ Estructura de las Pruebas

### 1. Health Check
- **Propósito**: Verificar que el servidor esté funcionando correctamente
- **Endpoint**: `GET /api/health`
- **Resultado esperado**: Respuesta 200 OK

### 2. Autenticación
- **Propósito**: Obtener tokens JWT para las pruebas
- **Endpoint**: `POST /api/auth/login`
- **Datos requeridos**: email, password, organizationSlug
- **Resultado esperado**: Token de acceso válido

## 🔍 Pruebas CRUD Principales

### 2.1 Listar Usuarios
```http
GET /api/users?page=1&limit=10&search=test&state=active&organization_id=1
```

**Parámetros de consulta:**
- `page`: Número de página (default: 1)
- `limit`: Registros por página (default: 10, max: 100)
- `search`: Búsqueda por nombre, apellido, email o username
- `state`: Filtro por estado (active/inactive)
- `organization_id`: Filtro por organización

**Validaciones implementadas:**
- ✅ Paginación funcional
- ✅ Búsqueda case-insensitive
- ✅ Filtros combinables
- ✅ Límites de paginación

### 2.2 Crear Usuario
```http
POST /api/users
{
  "organization_id": 1,
  "first_name": "Juan",
  "last_name": "Pérez",
  "username": "juan.perez.test",
  "email": "juan.perez.test@example.com",
  "password": "TestPass123!",
  "state": "active"
}
```

**Validaciones de negocio:**
- ✅ Email único por organización
- ✅ Username único global
- ✅ Contraseña con requisitos mínimos
- ✅ Organización existente
- ✅ Campos requeridos

### 2.3 Obtener Usuario Específico
```http
GET /api/users/{id}
```

**Validaciones:**
- ✅ Usuario existe
- ✅ Usuario pertenece a organización accesible
- ✅ Relaciones cargadas (roles, tiendas, organización)

### 2.4 Actualizar Usuario
```http
PATCH /api/users/{id}
{
  "first_name": "Juan Carlos",
  "password": "NewSecurePass456!",
  "state": "active"
}
```

**Características:**
- ✅ Actualización parcial
- ✅ Hash automático de contraseña
- ✅ Validación de permisos
- ✅ Auditoría de cambios

### 2.5 Suspender Usuario (Eliminación Lógica)
```http
DELETE /api/users/{id}
```

**Comportamiento:**
- ✅ Usuario pasa a estado `SUSPENDED` (no eliminación física)
- ✅ Usuario no puede hacer login
- ✅ Aparece en listados con filtro `state=suspended`
- ✅ Mantiene todas sus relaciones y permisos

**Validaciones:**
- ✅ Usuario existe
- ✅ No suspender usuario propio
- ✅ Permisos de eliminación
- ✅ Auditoría de suspensión

### 2.6 Archivar Usuario Permanentemente
```http
POST /api/users/{id}/archive
```

**Comportamiento:**
- ✅ Usuario pasa a estado `ARCHIVED`
- ✅ Usuario no puede hacer login
- ✅ No aparece en listados normales
- ✅ Requiere proceso manual para reactivación

**Validaciones:**
- ✅ Usuario existe y está suspendido
- ✅ Permisos de archivado
- ✅ Auditoría de archivado

### 2.7 Reactivar Usuario
```http
POST /api/users/{id}/reactivate
```

**Comportamiento:**
- ✅ Usuario vuelve a estado `ACTIVE`
- ✅ Usuario puede hacer login nuevamente
- ✅ Aparece en todos los listados
- ✅ Restaura funcionalidad completa

**Validaciones:**
- ✅ Usuario existe y está suspendido/archivado
- ✅ Permisos de reactivación
- ✅ Auditoría de reactivación

### 2.8 Listar Usuarios por Estado
```http
GET /api/users?state=suspended
GET /api/users?state=archived
```

**Comportamiento:**
- ✅ Filtra usuarios por estado específico
- ✅ Paginación y búsqueda funcionan normalmente
- ✅ Solo usuarios con permisos pueden ver estados especiales

## ⚠️ Pruebas de Validación

### 3.1 Campos Requeridos
**Escenario**: Intento de crear usuario sin campos obligatorios
**Resultado esperado**: Error 400 con mensaje de validación

### 3.2 Email Inválido
**Escenario**: Email con formato incorrecto
**Resultado esperado**: Error 400 - "email must be an email"

### 3.3 Contraseña Débil
**Escenario**: Contraseña menor a 8 caracteres
**Resultado esperado**: Error 400 - "password is too short"

### 3.4 Organización Inexistente
**Escenario**: organization_id no existe en BD
**Resultado esperado**: Error 400 - "Organization not found"

## 🔒 Pruebas de Seguridad

### 4.1 Sin Autenticación
**Escenario**: Acceso sin token JWT
**Resultado esperado**: Error 401 Unauthorized

### 4.2 Token Inválido
**Escenario**: Token malformado o expirado
**Resultado esperado**: Error 401 Unauthorized

### 4.3 Sin Permisos
**Escenario**: Usuario sin permisos de USERS_READ
**Resultado esperado**: Error 403 Forbidden

### 4.4 Operación sin Permiso
**Escenario**: Intento de crear sin USERS_CREATE
**Resultado esperado**: Error 403 Forbidden

## 🔍 Pruebas de Consultas Avanzadas

### 5.1 Búsqueda por Nombre
**Query**: `search=JUAN`
**Resultado esperado**: Usuarios con "juan" en nombre/apellido/email/username

### 5.2 Búsqueda por Apellido
**Query**: `search=Pérez`
**Resultado esperado**: Usuarios con apellido Pérez

### 5.3 Búsqueda por Email
**Query**: `search=@vendix.com`
**Resultado esperado**: Usuarios con dominio vendix.com

### 5.4 Filtro por Estado
**Query**: `state=inactive`
**Resultado esperado**: Solo usuarios inactivos

### 5.5 Filtros Combinados
**Query**: `search=test&state=active&organization_id=1`
**Resultado esperado**: Usuarios activos con "test" en organización 1

## 📊 Pruebas de Límite

### 6.1 Paginación Extrema
**Query**: `page=100&limit=10`
**Resultado esperado**: Página vacía o último conjunto de datos

### 6.2 Límite Máximo
**Query**: `limit=100`
**Resultado esperado**: 100 registros máximo

### 6.3 Límite Excesivo
**Query**: `limit=1000`
**Resultado esperado**: Error 400 - límite excedido

## 🔗 Pruebas de Relaciones

### 7.1 Usuario con Roles y Tiendas
**Endpoint**: `GET /api/users/1`
**Resultado esperado**: Usuario con arrays de roles y tiendas poblados

### 7.2 Usuario con Organización
**Endpoint**: `GET /api/users/1`
**Resultado esperado**: Usuario con objeto organización completo

## 🚀 Pruebas de Stress

### 8.1 Consultas Simultáneas
**Propósito**: Verificar rendimiento con múltiples requests
**Resultado esperado**: Todas las consultas responden correctamente

### 8.2 Creación Masiva
**Propósito**: Simular creación de múltiples usuarios
**Resultado esperado**: Usuarios creados sin conflictos de unicidad

## 🔄 Pruebas de Regresión

### 9.1 Verificación Post-Operaciones
**Propósito**: Confirmar estado después de operaciones CRUD
**Resultado esperado**: Datos consistentes

### 9.2 Auditoría
**Endpoint**: `GET /api/audit?resource=USERS`
**Resultado esperado**: Registros de auditoría para operaciones realizadas

## ⚡ Pruebas de Performance

### 10.1 Consulta Simple
**Endpoint**: `GET /api/users/1`
**Métrica**: Tiempo de respuesta < 100ms

### 10.2 Consulta con Filtros
**Query**: Múltiples filtros aplicados
**Métrica**: Tiempo de respuesta < 200ms

### 10.3 Consulta sin Filtros
**Query**: Listado general
**Métrica**: Tiempo de respuesta < 150ms

## 🎯 Pruebas con Datos Dinámicos

### 11.1 Variables de Entorno
```http
@test_user_email = test.user.{{$randomInt 100 999}}@example.com
@test_username = testuser{{$randomInt 100 999}}
```

**Propósito**: Evitar conflictos de unicidad en pruebas repetidas

## 🛠️ Pruebas de Error Handling

### 12.1 JSON Inválido
**Escenario**: JSON malformado
**Resultado esperado**: Error 400 Bad Request

### 12.2 Parámetros Inválidos
**Query**: `page=abc&limit=xyz`
**Resultado esperado**: Error 400 con validación de tipos

## 🧹 Limpieza de Datos

### 13.1 Eliminación de Pruebas
**Propósito**: Mantener BD limpia después de testing
**Resultado esperado**: Usuario de prueba eliminado exitosamente

## 📈 Reportes y Verificaciones

### 14.1 Estado Final
**Propósito**: Verificar integridad post-testing
**Resultado esperado**: BD en estado consistente

### 14.2 Auditoría Final
**Propósito**: Verificar logs de auditoría
**Resultado esperado**: Todas las operaciones auditadas

## 🔗 Pruebas de Integración

### 15.1 Integración con Roles
**Endpoint**: `GET /api/roles/user/1/roles`
**Resultado esperado**: Roles del usuario correctamente asociados

### 15.2 Integración con Organizaciones
**Endpoint**: `GET /api/organizations/1`
**Resultado esperado**: Organización del usuario accesible

## 📋 Checklist de Ejecución

12. [ ] Pruebas con datos dinámicos
13. [ ] Pruebas de error handling
14. [ ] Limpieza de datos de prueba

## 🗂️ **Sistema de Eliminación Lógica**

### ¿Por qué eliminación lógica?
El sistema VENDIX implementa **eliminación lógica** en lugar de eliminación física para:
- **Preservar integridad de datos** históricos
- **Mantener auditoría completa** de todas las operaciones
- **Permitir recuperación** de usuarios si es necesario
- **Cumplir con regulaciones** de retención de datos

### Estados de Usuario
```typescript
enum UserStatus {
  ACTIVE = 'active',       // Usuario funcional
  SUSPENDED = 'suspended', // Suspendido temporalmente
  ARCHIVED = 'archived'    // Archivado permanentemente
}
```

### Comportamiento por Estado

#### Usuarios ACTIVE:
- ✅ Pueden hacer login
- ✅ Aparecen en listados normales
- ✅ Todas las operaciones disponibles

#### Usuarios SUSPENDED:
- ❌ **No pueden hacer login**
- ✅ Aparecen en listados con filtro `state=suspended`
- ✅ Pueden ser reactivados fácilmente
- ✅ Mantienen todas sus relaciones

#### Usuarios ARCHIVED:
- ❌ **No pueden hacer login**
- ❌ No aparecen en listados normales
- ❌ Requieren proceso manual para reactivación
- ✅ Mantienen relaciones para auditoría

### Endpoints de Gestión de Estado
- `DELETE /api/users/{id}` → Suspende usuario
- `POST /api/users/{id}/archive` → Archiva usuario
- `POST /api/users/{id}/reactivate` → Reactiva usuario

### Filtros Disponibles
- `GET /api/users?state=active` → Solo activos
- `GET /api/users?state=suspended` → Solo suspendidos
- `GET /api/users?state=archived` → Solo archivados
- `GET /api/users?include_archived=true` → Todos incluyendo archivados

### ✅ Pre-Requisitos
- [ ] Servidor corriendo en puerto 3000
- [ ] Base de datos con datos de prueba
- [ ] Usuario admin con permisos completos
- [ ] Tokens JWT válidos configurados

### ✅ Secuencia de Ejecución
1. [ ] Health Check
2. [ ] Login y obtención de tokens
3. [ ] Pruebas CRUD básicas
4. [ ] Pruebas de validación
5. [ ] Pruebas de seguridad
6. [ ] Pruebas avanzadas
7. [ ] Pruebas de límites
8. [ ] Pruebas de relaciones
9. [ ] Pruebas de stress
10. [ ] Pruebas de regresión
11. [ ] Pruebas de performance
12. [ ] Pruebas con datos dinámicos
13. [ ] Pruebas de error handling
14. [ ] Limpieza de datos
15. [ ] Verificaciones finales

### ✅ Resultados Esperados
- [ ] Todas las pruebas positivas pasan (2xx)
- [ ] Todas las pruebas negativas fallan apropiadamente (4xx)
- [ ] No hay errores 5xx
- [ ] Performance dentro de límites aceptables
- [ ] BD permanece consistente

## 🔧 Configuración de Variables

Para ejecutar las pruebas correctamente, configurar:

```http
@baseUrl = http://localhost:3000/api
@admin_token = TU_TOKEN_ADMIN_AQUI
@access_token = TU_TOKEN_USUARIO_NORMAL_AQUI
```

## 📊 Métricas de Calidad

- **Cobertura de Código**: > 95%
- **Tiempo Respuesta Promedio**: < 150ms
- **Tasa de Éxito**: > 98%
- **Casos de Prueba**: 50+ escenarios
- **Escenarios de Error**: 15+ validaciones

## 🚨 Casos Especiales

### Usuario Super Admin
- No puede ser eliminado por usuarios normales
- Tiene acceso a todas las organizaciones
- Bypass de algunas validaciones de negocio

### Multi-tenancy
- Usuarios aislados por organización
- Emails únicos por organización
- Permisos contextuales por organización

### Auditoría
- Todas las operaciones quedan registradas
- Cambios de contraseña no se auditan (seguridad)
- Eliminaciones lógicas mantienen historial

---

**Nota**: Estas pruebas garantizan la calidad y confiabilidad del módulo de usuarios en producción.
