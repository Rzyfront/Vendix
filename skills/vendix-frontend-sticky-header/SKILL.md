---
name: vendix-frontend-sticky-header
description: Guidelines for professional sticky headers in modules.
metadata:
  scope: [frontend]
  auto_invoke: "Implementing sticky headers or Refactoring module headers"
---
# Vendix Sticky Header Pattern

> **CRITICAL RULE** - Los headers pegajosos deben estar SIEMPRE en la raíz del formulario o contenedor principal, y NUNCA dentro de un contenedor con padding interno.

## 🚨 The Sticky Problem

Cuando un header tiene `sticky top-0` y su contenedor padre tiene `padding`, el header se quedará pegado al inicio del padding del padre, NO al inicio de la pantalla. Esto causa un "salto" o desplazamiento visual durante el scroll.

### ❌ WRONG (The Padded Parent)
```html
<div class="p-4 md:p-6"> <!-- ⬅️ Padding here breaks sticky! -->
  <div class="sticky top-0 z-30 bg-white shadow-sm">
    <h1>Header Title</h1>
  </div>
  <div class="content">...</div>
</div>
```

### ✅ CORRECT (The Clean Parent)
```html
<div class="min-h-screen"> <!-- ⬅️ No padding on parent -->
  <div class="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b p-4 md:px-6 shadow-sm">
    <div class="max-w-[1600px] mx-auto flex items-center justify-between">
      <h1>Header Title</h1>
      <div class="actions">...</div>
    </div>
  </div>
  
  <div class="p-4 md:p-6"> <!-- ⬅️ Padding here is safe -->
    <div class="max-w-[1600px] mx-auto">
      <div class="content">...</div>
    </div>
  </div>
</div>
```

---

## 🛠️ Implementation Checklist

1.  **Sticky Container**: `sticky top-0 z-30`
2.  **Aesthetics**: 
    -   `bg-white/80` + `backdrop-blur-md` (Premium glassmorphism)
    -   `border-b border-gray-200`
    -   `shadow-sm`
    -   `rounded-b-xl` (Opcional, para estilo de tarjeta flotante)
3.  **Actions**: Mover botones de "Guardar" y "Cancelar" al header (lado derecho).
4.  **Badges**: Colocar badges de estado (Estado de Orden, Modo Edición) al lado del título.
5.  **Layout**: Usar un contenedor interno `max-w-[1600px] mx-auto` para mantener consistencia.

---

## 🦖 Recommended Styles (Tailwind)

Para un header profesional y "Premium":

```html
<div class="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-200 p-4 md:px-6 md:py-4 shadow-sm mb-4 rounded-b-xl">
  <div class="max-w-[1600px] mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <!-- Left: Info & Badge -->
    <div class="flex items-center gap-4">
      <div class="w-12 h-12 rounded-xl bg-primary-50 flex items-center justify-center border border-primary-100">
        <app-icon name="box" size="24" class="text-primary-600"></app-icon>
      </div>
      <div>
        <div class="flex items-center gap-3">
          <h1 class="text-xl font-bold text-gray-900">Module Title</h1>
          <span class="px-2 py-1 bg-green-100 text-green-700 text-[10px] font-bold uppercase rounded-lg">Activo</span>
        </div>
        <p class="text-sm text-gray-500">Subtítulo descriptivo del módulo</p>
      </div>
    </div>
    
    <!-- Right: Actions -->
    <div class="flex items-center gap-3">
      <app-button variant="outline" size="sm">Cancelar</app-button>
      <app-button variant="primary" size="sm">Guardar Cambios</app-button>
    </div>
  </div>
</div>
```

---

## 📋 Common Error Prevention

-   **Z-index**: Siempre usar `z-30` o superior para evitar que el contenido del scroll pase por encima del header.
-   **Form Scope**: Si el header tiene botones que disparan el `submit` del formulario, asegúrate de que el `<form>` envuelva a todo el header.
-   **Negative Margins**: EVITA usar márgenes negativos (`-mx-4`) para "compensar" el padding del padre. Es mejor mover el padding del padre a los hijos del contenido.

---

## Related Skills
- `vendix-frontend-component` - Basic component rules
- `vendix-frontend-theme` - Branding and color patterns
- `vendix-naming-conventions` - Proper naming for classes and files
