# 📋 Permisos del Sistema - Roles - Vendix

## 🎯 **DESCRIPCIÓN GENERAL**

Este documento detalla los **permisos granulares** disponibles en el sistema de roles de Vendix, organizados por módulos y funcionalidades.

## 🏗️ **ESTRUCTURA DE PERMISOS**

### Formato de Permisos
```
[recurso].[acción]
```

### Recursos Disponibles
- **users**: Gestión de usuarios
- **roles**: Gestión de roles
- **permissions**: Gestión de permisos
- **organizations**: Gestión de organizaciones
- **stores**: Gestión de tiendas
- **products**: Gestión de productos
- **orders**: Gestión de pedidos
- **reports**: Reportes y analytics

### Acciones Disponibles
- **read**: Ver/listar recursos
- **create**: Crear nuevos recursos
- **update**: Modificar recursos existentes
- **delete**: Eliminar recursos
- **manage**: Gestión completa (incluye todas las acciones)

---

## 👥 **PERMISOS DE USUARIOS**

### Gestión Básica
```
users.read          # Ver usuarios
users.create        # Crear usuarios
users.update        # Actualizar usuarios
users.delete        # Eliminar usuarios
users.manage        # Gestión completa de usuarios
```

### Gestión Avanzada
```
users.roles.read    # Ver roles de usuarios
users.roles.assign  # Asignar roles a usuarios
users.roles.remove  # Remover roles de usuarios
users.permissions.read  # Ver permisos de usuarios
```

---

## 🔐 **PERMISOS DE ROLES**

### Gestión de Roles
```
roles.read          # Ver roles
roles.create        # Crear roles
roles.update        # Actualizar roles
roles.delete        # Eliminar roles
roles.manage        # Gestión completa de roles
```

### Gestión de Permisos
```
roles.permissions.read     # Ver permisos de roles
roles.permissions.assign   # Asignar permisos a roles
roles.permissions.remove   # Remover permisos de roles
```

### Asignación de Usuarios
```
roles.users.assign   # Asignar roles a usuarios
roles.users.remove   # Remover roles de usuarios
```

---

## 🏢 **PERMISOS DE ORGANIZACIONES**

### Gestión Básica
```
organizations.read     # Ver organizaciones
organizations.create   # Crear organizaciones
organizations.update   # Actualizar organizaciones
organizations.delete   # Eliminar organizaciones
organizations.manage   # Gestión completa
```

### Configuración
```
organizations.settings.read    # Ver configuraciones
organizations.settings.update  # Actualizar configuraciones
organizations.domains.manage   # Gestionar dominios
```

---

## 🏪 **PERMISOS DE TIENDAS**

### Gestión Básica
```
stores.read          # Ver tiendas
stores.create        # Crear tiendas
stores.update        # Actualizar tiendas
stores.delete        # Eliminar tiendas
stores.manage        # Gestión completa
```

### Operaciones de Tienda
```
stores.inventory.read     # Ver inventario
stores.inventory.update   # Actualizar inventario
stores.sales.read         # Ver ventas
stores.sales.create       # Crear ventas
stores.employees.manage   # Gestionar empleados
```

---

## 📦 **PERMISOS DE PRODUCTOS**

### Gestión Básica
```
products.read        # Ver productos
products.create      # Crear productos
products.update      # Actualizar productos
products.delete      # Eliminar productos
products.manage      # Gestión completa
```

### Categorías y Atributos
```
products.categories.manage  # Gestionar categorías
products.attributes.manage  # Gestionar atributos
products.pricing.update     # Actualizar precios
```

---

## 🛒 **PERMISOS DE PEDIDOS**

### Gestión Básica
```
orders.read          # Ver pedidos
orders.create        # Crear pedidos
orders.update        # Actualizar pedidos
orders.delete        # Eliminar pedidos
orders.manage        # Gestión completa
```

### Estados y Procesamiento
```
orders.status.update     # Actualizar estado de pedidos
orders.payments.process  # Procesar pagos
orders.shipping.manage   # Gestionar envíos
```

---

## 📊 **PERMISOS DE REPORTES**

### Reportes Básicos
```
reports.read         # Ver reportes
reports.create       # Crear reportes
reports.export       # Exportar reportes
```

### Reportes Avanzados
```
reports.sales.advanced    # Reportes de ventas avanzados
reports.inventory.advanced # Reportes de inventario avanzados
reports.financial.read    # Reportes financieros
```

---

## ⚙️ **PERMISOS DEL SISTEMA**

### Configuración Global
```
system.settings.read      # Ver configuraciones del sistema
system.settings.update    # Actualizar configuraciones
system.backup.create      # Crear respaldos
system.backup.restore     # Restaurar respaldos
```

### Auditoría y Logs
```
system.audit.read         # Ver logs de auditoría
system.logs.read          # Ver logs del sistema
system.monitoring.read    # Ver métricas de monitoreo
```

---

## 🎭 **ROLES PREDEFINIDOS Y SUS PERMISOS**

### 1. Super Admin
**Descripción**: Control total del sistema
```
users.manage
roles.manage
organizations.manage
stores.manage
products.manage
orders.manage
reports.*
system.*
```

### 2. Admin
**Descripción**: Administración de organización
```
users.read
users.create
users.update
roles.read
roles.users.assign
organizations.read
organizations.update
stores.manage
products.manage
orders.manage
reports.read
```

### 3. Manager
**Descripción**: Gestión de tienda
```
users.read (solo de su tienda)
stores.read
stores.update (solo su tienda)
products.read
products.update (solo productos de su tienda)
orders.read
orders.update (solo pedidos de su tienda)
reports.read (solo de su tienda)
```

### 4. Employee
**Descripción**: Empleado de tienda
```
stores.read (solo su tienda)
products.read (solo su tienda)
orders.read
orders.create
orders.update (solo pedidos asignados)
```

### 5. Customer
**Descripción**: Cliente
```
orders.read (solo sus pedidos)
orders.create
products.read
```

---

## 🔧 **IMPLEMENTACIÓN TÉCNICA**

### Estructura en Base de Datos
```sql
-- Tabla de permisos
CREATE TABLE permissions (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  resource VARCHAR(50) NOT NULL,
  action VARCHAR(50) NOT NULL,
  path VARCHAR(200),
  method VARCHAR(10),
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabla de relación roles-permisos
CREATE TABLE role_permissions (
  id SERIAL PRIMARY KEY,
  role_id INTEGER REFERENCES roles(id),
  permission_id INTEGER REFERENCES permissions(id),
  granted BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(role_id, permission_id)
);
```

### Validación en Código
```typescript
// Verificar permiso específico
async hasPermission(userId: number, permission: string): Promise<boolean> {
  const userPermissions = await this.getUserPermissions(userId);
  return userPermissions.some(p => p.name === permission);
}

// Verificar permisos por patrón
async hasPermissionPattern(userId: number, pattern: string): Promise<boolean> {
  const userPermissions = await this.getUserPermissions(userId);
  const regex = new RegExp(pattern.replace('*', '.*'));
  return userPermissions.some(p => regex.test(p.name));
}
```

---

## 🚀 **MEJORES PRÁCTICAS**

### 1. Principio de Menor Privilegio
- Asignar solo los permisos necesarios
- Usar permisos granulares en lugar de comodines
- Regularmente auditar y remover permisos innecesarios

### 2. Separación de Responsabilidades
- Un rol por responsabilidad específica
- Evitar roles con demasiados permisos
- Usar roles compuestos cuando sea necesario

### 3. Auditoría de Cambios
- Registrar todos los cambios en permisos
- Mantener historial de asignaciones
- Alertar sobre cambios críticos

### 4. Mantenimiento
- Regularmente revisar permisos obsoletos
- Actualizar permisos según cambios en el sistema
- Documentar cambios en permisos

---

## 📊 **MONITOREO Y REPORTES**

### Métricas a Monitorear
- **Permisos por usuario**: Número promedio de permisos
- **Roles activos**: Roles con usuarios asignados
- **Cambios de permisos**: Frecuencia de modificaciones
- **Permisos sin usar**: Permisos no asignados

### Reportes Disponibles
- **Matriz de permisos**: Usuarios vs permisos
- **Actividad de roles**: Cambios en asignaciones
- **Permisos críticos**: Uso de permisos sensibles
- **Auditoría de seguridad**: Cambios en permisos del sistema

---

## 🔐 **CONSIDERACIONES DE SEGURIDAD**

### Permisos Críticos
```
system.backup.restore     # Alto riesgo
users.manage             # Alto riesgo
roles.manage             # Alto riesgo
system.settings.update   # Alto riesgo
```

### Controles de Seguridad
- **Aprobaciones**: Cambios críticos requieren aprobación
- **Notificaciones**: Alertas para cambios en permisos críticos
- **Logs detallados**: Registro completo de cambios
- **Restricciones temporales**: Permisos con expiración

---

## 📋 **MIGRACIÓN Y ACTUALIZACIÓN**

### Actualización de Permisos
1. **Backup**: Respaldar permisos actuales
2. **Análisis**: Identificar permisos afectados
3. **Migración**: Actualizar permisos en BD
4. **Validación**: Verificar funcionamiento
5. **Rollback**: Plan de reversión preparado

### Nuevos Permisos
1. **Documentación**: Registrar nuevos permisos
2. **Implementación**: Agregar a código
3. **Asignación**: Actualizar roles según sea necesario
4. **Testing**: Validar funcionamiento
5. **Deploy**: Despliegue controlado

---

## 🎯 **CASOS DE USO COMUNES**

### 1. Nuevo Empleado
```
Asignar rol: employee
Permisos básicos: stores.read, products.read, orders.create
Ubicación: Tienda específica
```

### 2. Promoción a Manager
```
Remover rol: employee
Asignar rol: manager
Permisos adicionales: stores.update, reports.read
```

### 3. Cambio de Tienda
```
Mantener rol: employee
Actualizar permisos de ubicación
Auditar cambio de tienda
```

### 4. Desactivación de Usuario
```
Remover todos los roles
Mantener historial de permisos
Registrar auditoría de desactivación
```

---

*Documento de permisos - Vendix Roles System*
*Versión: 1.0.0*
*Fecha: Septiembre 2025*
