# 🧪 Pruebas del Servicio de Roles - Vendix

## 📋 Descripción General

Este documento contiene los **casos de prueba exhaustivos** para el servicio de roles y permisos, incluyendo pruebas de funcionalidad, seguridad, edge cases y escenarios de error.

## 🎯 Objetivos de las Pruebas

- **Validar funcionalidad completa** del sistema RBAC
- **Verificar medidas de seguridad** implementadas
- **Probar casos límite** y escenarios de error
- **Asegurar integridad** de la regla de Super Admin único
- **Validar auditoría** y logging completo

## 📊 Casos de Prueba por Categoría

---

## ✅ **PRUEBAS DE FUNCIONALIDAD BÁSICA**

### 1. Gestión de Roles - CRUD

#### 1.1 Listar Roles como Super Admin
**ID**: FUNC-001
**Descripción**: Verificar que Super Admin ve todos los roles incluyendo super_admin
**Precondiciones**:
- Usuario autenticado como Super Admin
- Roles existentes en el sistema

**Pasos**:
1. Hacer login como Super Admin
2. Enviar GET a `/api/roles`
3. Verificar respuesta contiene todos los roles

**Resultado Esperado**:
```json
{
  "id": 1,
  "name": "super_admin",
  "description": "Super Administrador",
  "is_system_role": true,
  "role_permissions": [...],
  "_count": {
    "user_roles": 1
  }
}
```

#### 1.2 Listar Roles como Admin Regular
**ID**: FUNC-002
**Descripción**: Verificar filtrado de roles según permisos del usuario
**Precondiciones**:
- Usuario autenticado como Admin (no Super Admin)
- Rol super_admin existe en el sistema

**Resultado Esperado**:
- Lista de roles **SIN** el rol `super_admin`
- Status 200 OK

#### 1.3 Crear Rol Personalizado
**ID**: FUNC-003
**Descripción**: Verificar creación exitosa de rol personalizado
**Precondiciones**:
- Usuario con permisos SUPER_ADMIN o ADMIN
- Nombre de rol único

**Pasos**:
1. Enviar POST a `/api/roles`
2. Incluir `name`, `description`, `is_system_role`
3. Verificar respuesta 201

**Resultado Esperado**:
```json
{
  "id": 10,
  "name": "store_auditor",
  "description": "Auditor especializado para tienda",
  "is_system_role": false,
  "created_at": "2025-09-05T...",
  "updated_at": "2025-09-05T..."
}
```

#### 1.4 Actualizar Rol
**ID**: FUNC-004
**Descripción**: Verificar actualización de propiedades del rol
**Precondiciones**:
- Rol existente no del sistema
- Usuario con permisos adecuados

**Resultado Esperado**:
- Rol actualizado con nuevos valores
- Auditoría registrada

#### 1.5 Eliminar Rol Personalizado
**ID**: FUNC-005
**Descripción**: Verificar eliminación de rol personalizado
**Precondiciones**:
- Rol no del sistema
- Rol sin usuarios asignados

**Resultado Esperado**:
- Status 200 OK
- Mensaje de confirmación
- Auditoría registrada

---

## 🔐 **PRUEBAS DE SEGURIDAD**

### 2. Regla de Super Admin Único

#### 2.1 Asignar Super Admin por Primera Vez
**ID**: SEC-001
**Descripción**: Verificar asignación exitosa cuando no existe Super Admin
**Precondiciones**:
- Usuario con rol SUPER_ADMIN
- No existe Super Admin asignado
- Usuario destino válido

**Pasos**:
1. Enviar POST a `/api/roles/assign-to-user`
2. Incluir `userId` y `roleId: 1` (Super Admin)
3. Verificar respuesta 201

**Resultado Esperado**:
```json
{
  "id": 15,
  "user_id": 123,
  "role_id": 1,
  "users": {
    "id": 123,
    "email": "newadmin@example.com",
    "first_name": "New",
    "last_name": "Admin"
  },
  "roles": {
    "id": 1,
    "name": "super_admin",
    "description": "Super Administrador"
  }
}
```

#### 2.2 Bloquear Asignación de Segundo Super Admin
**ID**: SEC-002
**Descripción**: Verificar bloqueo cuando ya existe un Super Admin
**Precondiciones**:
- Ya existe un usuario con rol SUPER_ADMIN
- Usuario con rol SUPER_ADMIN intentando asignar

**Resultado Esperado**:
```json
{
  "message": "Ya existe un super administrador: admin@vendix.com. Solo puede existir un super administrador en el sistema.",
  "error": "Conflict",
  "statusCode": 409
}
```

#### 2.3 Solo Super Admin Puede Asignar Super Admin
**ID**: SEC-003
**Descripción**: Verificar que solo Super Admins pueden asignar el rol
**Precondiciones**:
- Usuario con rol ADMIN (no Super Admin)
- Intento de asignar rol SUPER_ADMIN

**Resultado Esperado**:
```json
{
  "message": "Solo los super administradores pueden asignar el rol super_admin",
  "error": "Forbidden",
  "statusCode": 403
}
```

### 3. Filtrado de Visibilidad

#### 3.1 Ocultar Super Admin a No Super Admins
**ID**: SEC-004
**Descripción**: Verificar que usuarios no Super Admin no ven el rol
**Precondiciones**:
- Usuario con rol ADMIN u otro rol
- Rol super_admin existe

**Resultado Esperado**:
- Lista de roles sin el rol `super_admin`
- Status 200 OK

#### 3.2 Super Admin Ve Todos los Roles
**ID**: SEC-005
**Descripción**: Verificar que Super Admin ve todos los roles
**Precondiciones**:
- Usuario con rol SUPER_ADMIN

**Resultado Esperado**:
- Lista completa incluyendo `super_admin`
- Status 200 OK

---

## ⚠️ **PRUEBAS DE ERROR HANDLING**

### 4. Errores de Validación

#### 4.1 Rol Duplicado
**ID**: ERR-001
**Descripción**: Intentar crear rol con nombre existente
**Precondiciones**:
- Rol con nombre específico ya existe

**Resultado Esperado**:
```json
{
  "message": "Ya existe un rol con este nombre",
  "error": "Conflict",
  "statusCode": 409
}
```

#### 4.2 Usuario No Encontrado
**ID**: ERR-002
**Descripción**: Intentar asignar rol a usuario inexistente
**Precondiciones**:
- ID de usuario no existe en base de datos

**Resultado Esperado**:
```json
{
  "message": "Usuario no encontrado",
  "error": "Not Found",
  "statusCode": 404
}
```

#### 4.3 Rol No Encontrado
**ID**: ERR-003
**Descripción**: Intentar acceder a rol inexistente
**Precondiciones**:
- ID de rol no existe

**Resultado Esperado**:
```json
{
  "message": "Rol no encontrado",
  "error": "Not Found",
  "statusCode": 404
}
```

#### 4.4 Permiso Inexistente
**ID**: ERR-004
**Descripción**: Intentar asignar permiso inexistente a rol
**Precondiciones**:
- ID de permiso no existe

**Resultado Esperado**:
```json
{
  "message": "Uno o más permisos no existen o están inactivos",
  "error": "Bad Request",
  "statusCode": 400
}
```

### 5. Errores de Autorización

#### 5.1 Sin Token de Autenticación
**ID**: ERR-005
**Descripción**: Intentar acceder sin token JWT
**Precondiciones**:
- No incluir header Authorization

**Resultado Esperado**:
```json
{
  "message": "Unauthorized",
  "statusCode": 401
}
```

#### 5.2 Token Inválido
**ID**: ERR-006
**Descripción**: Intentar acceder con token inválido
**Precondiciones**:
- Token JWT malformado o expirado

**Resultado Esperado**:
```json
{
  "message": "Unauthorized",
  "statusCode": 401
}
```

#### 5.3 Sin Permisos Suficientes
**ID**: ERR-007
**Descripción**: Usuario sin rol requerido intenta operación
**Precondiciones**:
- Usuario con rol insuficiente

**Resultado Esperado**:
```json
{
  "message": "Forbidden",
  "statusCode": 403
}
```

---

## 🔧 **PRUEBAS DE GESTIÓN DE PERMISOS**

### 6. Asignación de Permisos

#### 6.1 Asignar Múltiples Permisos
**ID**: PERM-001
**Descripción**: Verificar asignación exitosa de múltiples permisos
**Precondiciones**:
- Rol existente
- Permisos válidos y activos

**Pasos**:
1. Enviar POST a `/api/roles/:id/permissions`
2. Incluir array de `permissionIds`
3. Verificar respuesta 200

**Resultado Esperado**:
- Rol actualizado con permisos asignados
- Relaciones `role_permissions` creadas

#### 6.2 Remover Permisos
**ID**: PERM-002
**Descripción**: Verificar remoción exitosa de permisos
**Precondiciones**:
- Rol con permisos asignados

**Resultado Esperado**:
- Permisos removidos del rol
- Auditoría registrada

#### 6.3 Skip Duplicados
**ID**: PERM-003
**Descripción**: Verificar que no se crean duplicados al asignar permisos ya existentes
**Precondiciones**:
- Rol ya tiene algunos permisos asignados

**Resultado Esperado**:
- Operación exitosa sin errores
- No se crean registros duplicados

---

## 👥 **PRUEBAS DE ASIGNACIÓN DE ROLES**

### 7. Asignación Básica

#### 7.1 Asignar Rol Normal
**ID**: ASSIGN-001
**Descripción**: Verificar asignación exitosa de rol no crítico
**Precondiciones**:
- Usuario y rol existen
- Usuario no tiene el rol asignado

**Resultado Esperado**:
- Relación `user_roles` creada
- Auditoría registrada

#### 7.2 Prevenir Asignación Duplicada
**ID**: ASSIGN-002
**Descripción**: Verificar bloqueo de asignación de rol ya existente
**Precondiciones**:
- Usuario ya tiene el rol asignado

**Resultado Esperado**:
```json
{
  "message": "El usuario ya tiene este rol asignado",
  "error": "Conflict",
  "statusCode": 409
}
```

#### 7.3 Remover Rol de Usuario
**ID**: ASSIGN-003
**Descripción**: Verificar remoción exitosa de rol
**Precondiciones**:
- Usuario tiene el rol asignado
- No es el último rol del sistema (si aplica)

**Resultado Esperado**:
- Relación `user_roles` eliminada
- Auditoría registrada

---

## 📊 **PRUEBAS DE CONSULTAS**

### 8. Consultas de Usuario

#### 8.1 Obtener Roles de Usuario
**ID**: QUERY-001
**Descripción**: Verificar consulta de roles asignados a usuario
**Precondiciones**:
- Usuario con roles asignados

**Resultado Esperado**:
```json
[
  {
    "id": 5,
    "user_id": 13,
    "role_id": 3,
    "roles": {
      "id": 3,
      "name": "admin",
      "description": "Administrador",
      "role_permissions": [...]
    }
  }
]
```

#### 8.2 Obtener Permisos de Usuario
**ID**: QUERY-002
**Descripción**: Verificar consulta de permisos efectivos del usuario
**Precondiciones**:
- Usuario con roles que tienen permisos

**Resultado Esperado**:
- Lista de permisos únicos del usuario
- Sin duplicados

---

## 🎯 **PRUEBAS DE EDGE CASES**

### 9. Casos Especiales

#### 9.1 Rol del Sistema - No Eliminable
**ID**: EDGE-001
**Descripción**: Verificar protección de roles del sistema
**Precondiciones**:
- Rol con `is_system_role: true`

**Resultado Esperado**:
```json
{
  "message": "No se pueden eliminar roles del sistema",
  "error": "Bad Request",
  "statusCode": 400
}
```

#### 9.2 Rol del Sistema - No Modificable
**ID**: EDGE-002
**Descripción**: Verificar que roles del sistema no se pueden modificar
**Precondiciones**:
- Intento de modificar propiedades de rol del sistema

**Resultado Esperado**:
```json
{
  "message": "No se pueden modificar roles del sistema",
  "error": "Bad Request",
  "statusCode": 400
}
```

#### 9.3 Usuario Sin Roles
**ID**: EDGE-003
**Descripción**: Verificar consulta de usuario sin roles asignados
**Precondiciones**:
- Usuario existe pero sin roles

**Resultado Esperado**:
- Array vacío `[]`
- Status 200 OK

---

## 🚀 **PRUEBAS DE PERFORMANCE**

### 10. Carga y Estrés

#### 10.1 Múltiples Operaciones Concurrentes
**ID**: PERF-001
**Descripción**: Verificar comportamiento bajo carga
**Precondiciones**:
- Múltiples requests simultáneos

**Criterios de Aceptación**:
- Tiempo de respuesta < 200ms
- Tasa de éxito > 99%
- No deadlocks en base de datos

#### 10.2 Operaciones Masivas
**ID**: PERF-002
**Descripción**: Verificar asignación de múltiples permisos
**Precondiciones**:
- Array grande de permissionIds

**Resultado Esperado**:
- Operación completada exitosamente
- Todos los permisos asignados

---

## 🔄 **PRUEBAS DE REGRESIÓN**

### 11. Verificación de Integridad

#### 11.1 Estado Consistente Después de Operaciones
**ID**: REG-001
**Descripción**: Verificar integridad después de operaciones complejas
**Precondiciones**:
- Múltiples operaciones ejecutadas

**Verificaciones**:
- Conteos de `_count` correctos
- Relaciones `user_roles` consistentes
- Relaciones `role_permissions` válidas
- Auditoría completa registrada

#### 11.2 Recuperación de Errores
**ID**: REG-002
**Descripción**: Verificar recuperación después de errores
**Precondiciones**:
- Operación que causa error

**Verificaciones**:
- Estado de BD consistente
- No datos huérfanos
- Transacciones rollback apropiadas

---

## 📋 **MATRIZ DE COBERTURA DE PRUEBAS**

| Funcionalidad | Casos de Prueba | Estado |
|---------------|----------------|--------|
| CRUD Roles | 5 | ✅ Completo |
| Seguridad Super Admin | 3 | ✅ Completo |
| Gestión Permisos | 3 | ✅ Completo |
| Asignación Roles | 3 | ✅ Completo |
| Consultas Usuario | 2 | ✅ Completo |
| Error Handling | 7 | ✅ Completo |
| Edge Cases | 3 | ✅ Completo |
| Performance | 2 | ✅ Completo |
| Regresión | 2 | ✅ Completo |
| **TOTAL** | **30** | **✅ Completo** |

---

## 🎯 **CRITERIOS DE ÉXITO**

### Métricas de Calidad
- **Cobertura de Código**: > 90%
- **Tasa de Éxito**: > 99% en operaciones válidas
- **Tiempo de Respuesta**: < 150ms promedio
- **Auditoría**: 100% de operaciones registradas

### Validaciones de Seguridad
- ✅ Regla de Super Admin único implementada
- ✅ Filtrado de visibilidad por permisos
- ✅ Autorización adecuada en todos los endpoints
- ✅ Validación de entrada completa
- ✅ Auditoría completa de operaciones

### Casos Críticos Validados
- ✅ Asignación de Super Admin bloqueada cuando ya existe
- ✅ Solo Super Admins pueden asignar Super Admin
- ✅ Roles del sistema protegidos
- ✅ Operaciones sin permisos rechazadas
- ✅ Datos inválidos rechazados

---

## 🚨 **ESCENARIOS DE RIESGO**

### Riesgos Identificados
1. **Race Condition**: Múltiples asignaciones simultáneas de Super Admin
2. **Token Expirado**: Operaciones con tokens expirados durante ejecución
3. **Deadlocks**: Operaciones concurrentes en base de datos
4. **Memory Leaks**: Acumulaciones en operaciones masivas

### Mitigaciones Implementadas
- ✅ Transacciones de BD para operaciones críticas
- ✅ Validaciones atómicas para unicidad
- ✅ Timeouts apropiados en operaciones
- ✅ Manejo de concurrencia en aplicación

---

## 📝 **INSTRUCCIONES DE EJECUCIÓN**

### Pre-requisitos
1. **Servidor corriendo**: `npm run start:dev`
2. **Base de datos**: Seed ejecutado
3. **Usuarios de prueba**: Creados en seed
4. **Tokens válidos**: Obtenidos via login

### Orden de Ejecución Recomendado
1. **Login**: Obtener tokens de autenticación
2. **Health Check**: Verificar servidor operativo
3. **CRUD Básico**: Crear, leer, actualizar, eliminar
4. **Permisos**: Asignar y remover permisos
5. **Asignación**: Asignar roles a usuarios
6. **Seguridad**: Probar reglas de Super Admin
7. **Errores**: Probar casos de error
8. **Performance**: Pruebas de carga

### Variables de Entorno Requeridas
```bash
# Para testing
TEST_USER_EMAIL=superadmin@vendix.com
TEST_USER_PASSWORD=password123
TEST_ORG_SLUG=vendix-corp

# Para validaciones
JWT_SECRET=your-secret-key
DATABASE_URL=postgresql://...
```

---

## 📊 **REPORTING DE RESULTADOS**

### Formato de Reporte
```json
{
  "test_suite": "roles-api-tests",
  "timestamp": "2025-09-05T10:00:00Z",
  "results": {
    "total_tests": 30,
    "passed": 28,
    "failed": 2,
    "skipped": 0
  },
  "coverage": {
    "functionality": "100%",
    "security": "100%",
    "error_handling": "95%"
  },
  "performance": {
    "avg_response_time": "45ms",
    "success_rate": "99.8%"
  }
}
```

### Alertas Críticas
- ❌ **Failed Tests > 0**: Revisar inmediatamente
- ⚠️ **Response Time > 200ms**: Optimizar performance
- ⚠️ **Security Tests Failed**: Revisar vulnerabilidades
- ⚠️ **Audit Missing**: Verificar logging

---

## 🔧 **MANTENIMIENTO DE PRUEBAS**

### Actualización de Casos de Prueba
1. **Nuevas funcionalidades**: Agregar casos correspondientes
2. **Cambios en API**: Actualizar requests y validaciones
3. **Nuevos roles**: Agregar pruebas específicas
4. **Cambios de seguridad**: Revisar casos de autorización

### Frecuencia de Ejecución
- **Diaria**: Suite completa en CI/CD
- **Pre-deploy**: Validación completa antes de releases
- **Post-deploy**: Verificación en producción
- **On-demand**: Después de cambios críticos

### Automatización
```bash
# Ejecutar suite completa
npm run test:api:roles

# Ejecutar solo seguridad
npm run test:security:roles

# Ejecutar con reporte
npm run test:roles -- --reporter=json
```
