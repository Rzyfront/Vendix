# Guía: Sistema Dinámico de Visibilidad de Módulos

Esta guía explica cómo agregar nuevos módulos al sistema dinámico de visibilidad de módulos (panel_ui) de Vendix.

## 📋 Resumen del Sistema

El sistema permite mostrar/ocultar módulos del sidebar basándose en la configuración `panel_ui` almacenada en `user_settings`. Cada módulo tiene una clave (key) que puede ser `true` (visible) o `false` (oculto).

### Caráterísticas:
- **Reactivo**: Los cambios se aplican sin recargar la página
- **Jerárquico**: Soporta módulos padre con submódulos hijos
- **Por App Type**: Configuración separada para ORG_ADMIN, STORE_ADMIN, STORE_ECOMMERCE
- **Basado en Roles**: Solo owners/admins pueden editar la configuración

---

## 🗂️ Archivos que Deben Modificarse

Al agregar un módulo nuevo, debes actualizar estos archivos:

| Archivo | Propósito |
|---------|-----------|
| `src/app/core/services/menu-filter.service.ts` | Mapeo de etiquetas → claves de módulo |
| `src/app/private/layouts/[app-type]/[app-type]-layout.component.ts` | Definición del menú en el sidebar |
| `src/app/shared/components/settings-modal/settings-modal.component.ts` | Configuración en modal de settings |
| `apps/backend/prisma/seed.ts` | Valores por defecto en backend |

---

## 📝 Paso a Paso: Agregar un Nuevo Módulo

### Escenario 1: Módulo Principal (sin submódulos)

**Ejemplo**: Agregar módulo "Calendario" a STORE_ADMIN

#### 1. Agregar al Layout (Sidebar)

**Archivo**: `src/app/private/layouts/store-admin/store-admin-layout.component.ts`

```typescript
private allMenuItems: MenuItem[] = [
  // ... módulos existentes
  {
    label: 'Calendario',           // ← Etiqueta en español
    icon: 'calendar',
    route: '/admin/store/calendar',
  },
];
```

#### 2. Agregar Mapeo en MenuFilterService

**Archivo**: `src/app/core/services/menu-filter.service.ts`

```typescript
private moduleKeyMap: Record<string, string> = {
  // ... mapeos existentes
  Calendario: 'calendar',          // ← Label : key
};
```

#### 3. Agregar a Settings Modal

**Archivo**: `src/app/shared/components/settings-modal/settings-modal.component.ts`

```typescript
const APP_MODULES = {
  // ...
  STORE_ADMIN: [
    // ... módulos existentes
    { key: 'calendar', label: 'Calendario', description: 'Gestionar calendario de eventos' },
  ],
};
```

#### 4. Agregar Default en Backend Seed

**Archivo**: `apps/backend/prisma/seed.ts`

```typescript
panel_ui = {
  STORE_ADMIN: {
    // ... módulos existentes
    calendar: true,                 // ← Valor por defecto
  },
};
```

---

### Escenario 2: Módulo Padre con Submódulos

**Ejemplo**: Agregar "Finanzas" con submódulos "Facturas" y "Pagos"

#### 1. Agregar al Layout con Hijos

**Archivo**: `src/app/private/layouts/store-admin/store-admin-layout.component.ts`

```typescript
private allMenuItems: MenuItem[] = [
  // ... módulos existentes
  {
    label: 'Finanzas',
    icon: 'wallet',
    children: [
      { label: 'Facturas', icon: 'receipt', route: '/admin/store/finanzas/invoices' },
      { label: 'Pagos', icon: 'credit-card', route: '/admin/store/finanzas/payments' },
    ],
  },
];
```

#### 2. Agregar Mapeo para Padre e Hijos

**Archivo**: `src/app/core/services/menu-filter.service.ts`

```typescript
private moduleKeyMap: Record<string, string> = {
  // ... mapeos existentes

  // Finanzas (padre + submódulos)
  Finanzas: 'finanzas',
  Facturas: 'finanzas_invoices',
  Pagos: 'finanzas_payments',
};
```

#### 3. Agregar a Settings Modal con Jerarquía

**Archivo**: `src/app/shared/components/settings-modal/settings-modal.component.ts`

```typescript
const APP_MODULES = {
  STORE_ADMIN: [
    // ... módulos existentes

    // Finanzas
    { key: 'finanzas', label: 'Finanzas (padre)', description: 'Sección financiera' },
    { key: 'finanzas_invoices', label: '└ Facturas', description: 'Facturas y cobros' },
    { key: 'finanzas_payments', label: '└ Pagos', description: 'Pagos a proveedores' },
  ],
};
```

#### 4. Agregar Defaults en Backend

**Archivo**: `apps/backend/prisma/seed.ts`

```typescript
panel_ui = {
  STORE_ADMIN: {
    // ... módulos existentes

    // Finanzas
    finanzas: true,                  // Padre visible por defecto
    finanzas_invoices: true,         // Hijo visible por defecto
    finanzas_payments: false,        // Hijo oculto por defecto
  },
};
```

---

## 🎯 Convención de Nombres

### Claves de Módulo (key):
- **Módulos principales**: Usar `snake_case` simple: `dashboard`, `products`, `calendar`
- **Submódulos**: Usar `parent_submodule` pattern: `orders_sales`, `inventory_suppliers`
- **Múltiples palabras**: Usar `snake_case`: `purchase_orders`, `analytics_performance`

### Etiquetas (label):
- **En español**: Coincide con el texto visible en el sidebar
- **Módulos principales**: Primera letra mayúscula: `Calendario`, `Productos`
- **Submódulos**: Igual que el principal: `Facturas`, `Ajustes de Stock`

### Prefijo Visual:
- Usar `└ ` para submódulos en settings-modal: `└ Facturas`
- Esto indica visualmente la jerarquía en el UI

---

## 🔍 Cómo Funciona el Filtrado

### Lógica en MenuFilterService:

```typescript
private filterItemsRecursive(items: MenuItem[], visibleModules: string[]): MenuItem[] {
  return items.reduce((filtered: MenuItem[], item) => {
    const moduleKey = this.moduleKeyMap[item.label];

    if (moduleKey) {
      // Item con mapeo: solo incluir si está visible
      if (visibleModules.includes(moduleKey)) {
        const filteredItem = { ...item };
        if (item.children) {
          // Filtrar hijos recursivamente
          filteredItem.children = this.filterItemsRecursive(item.children, visibleModules);
        }
        filtered.push(filteredItem);
      }
    } else if (item.children?.length > 0) {
      // Item sin mapeo pero con hijos: incluir si tiene hijos visibles
      const filteredChildren = this.filterItemsRecursive(item.children, visibleModules);
      if (filteredChildren.length > 0) {
        filtered.push({ ...item, children: filteredChildren });
      }
    }

    return filtered;
  }, []);
}
```

### Comportamiento:
1. **Módulo visible + hijos visibles** → Se muestra con todos sus hijos
2. **Módulo visible + hijos ocultos** → Se muestra pero vacío (sin sub-items)
3. **Módulo oculto** → No se muestra (independientemente de los hijos)

---

## 🧪 Testing Post-Implementación

Después de agregar un módulo, verificar:

### 1. Compilación
```bash
cd apps/frontend && npx tsc --noEmit
```

### 2. Visibilidad en Sidebar
- [ ] Módulo aparece cuando su key es `true`
- [ ] Módulo desaparece cuando su key es `false`
- [ ] Submódulos respetan su configuración individual

### 3. Settings Modal
- [ ] Toggle nuevo aparece en el modal
- [ ] Toggle refleja el estado actual
- [ ] Guardar cambios actualiza el sidebar sin recargar

### 4. Persistencia
```bash
# Verificar localStorage
localStorage.getItem('auth')
# Buscar config.panel_ui.STORE_ADMIN.[new_module_key]
```

---

## ⚠️ Errores Comunes

### Error 1: Módulo no aparece en el sidebar
**Causa**: Falta mapeo en `moduleKeyMap`
**Solución**: Verificar que la etiqueta coincida exactamente con la del layout

### Error 2: TypeScript error "Cannot find module"
**Causa**: Ruta relativa incorrecta al importar
**Solución**: Verificar profundidad de directorios (../../shared vs ../shared)

### Error 3: Duplicate key en object literal
**Causa**: Dos módulos con la misma etiqueta en diferentes layouts
**Solución**: Usar la misma key si es el mismo módulo, o etiquetas diferentes

### Error 4: Submódulo no respeta su configuración
**Causa**: Falta el mapeo del hijo en `moduleKeyMap`
**Solución**: Agregar entrada para cada sub-item individualmente

---

## 📊 Estructura Completa de Ejemplo

```typescript
// 1. Layout (store-admin-layout.component.ts)
{
  label: 'Proyectos',
  icon: 'folder',
  children: [
    { label: 'Activos', icon: 'check', route: '/admin/store/projects/active' },
    { label: 'Archivados', icon: 'archive', route: '/admin/store/projects/archived' },
  ],
}

// 2. Menu Filter Service (menu-filter.service.ts)
Proyectos: 'projects',
Activos: 'projects_active',
Archivados: 'projects_archived',

// 3. Settings Modal (settings-modal.component.ts)
{ key: 'projects', label: 'Proyectos (padre)', description: 'Gestión de proyectos' },
{ key: 'projects_active', label: '└ Activos', description: 'Proyectos activos' },
{ key: 'projects_archived', label: '└ Archivados', description: 'Proyectos archivados' },

// 4. Backend Seed (prisma/seed.ts)
projects: true,
projects_active: true,
projects_archived: false,
```

---

## 🚀 Comandos Útiles

```bash
# Compilar frontend
cd apps/frontend && npx tsc --noEmit

# Regenerar seeds (después de modificar backend)
cd apps/backend && npx prisma db seed

# Ver localStorage en consola
localStorage.getItem('auth')

# Limpiar localStorage para pruebas
localStorage.clear() && location.reload()
```

---

## 📚 Referencias Rápidas

| App Type | Archivo Layout |
|----------|----------------|
| ORG_ADMIN | `src/app/private/layouts/organization-admin/organization-admin-layout.component.ts` |
| STORE_ADMIN | `src/app/private/layouts/store-admin/store-admin-layout.component.ts` |
| STORE_ECOMMERCE | `src/app/private/layouts/store-ecommerce/store-ecommerce-layout.component.ts` |

---

**Última actualización**: Enero 2026
**Versión del sistema**: 2.0 (con soporte de submódulos individuales)
