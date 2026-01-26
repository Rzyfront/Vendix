---
name: vendix-frontend-modal
description: Patrones de implementación de modales en el frontend de Vendix.
metadata:
  scope: [root]
  auto_invoke: "Creating or modifying modals in frontend"
---

# Vendix Frontend Modal Pattern

Este skill describe el patrón estándar para implementar modales en Vendix, utilizando `app-modal` y la arquitectura Modal-First.

## 🚨 Reglas Críticas (Best Practices)

1.  **System Components Only**: Dentro del modal, usa SIEMPRE los componentes del sistema (`app-input`, `app-selector`, `app-textarea`). Evita inputs HTML crudos para mantener la consistencia y evitar conflictos de eventos.
2.  **Propagación de Estado (Prevent NG0100)**: Al manejar `isOpenChange`, **SIEMPRE** emite el evento crudo (`$event`).
    *   ✅ **Correcto**: `(isOpenChange)="isOpenChange.emit($event)"`
    *   ❌ **Incorrecto**: `(isOpenChange)="closeModal()"` (Si `closeModal` fuerza `false` inmediatamente, causa un loop `ExpressionChangedAfterItHasBeenCheckedError` cuando el modal intenta abrirse).
3.  **Arquitectura Single-View**: Para módulos CRUD simples, evita crear rutas hijas (`/create`, `/edit/:id`). Usa una única vista "Lista" y maneja Creación/Edición mediante modales sobre la misma vista.

---

## 🏗️ Estructura del Componente (Modal Wrapper)

Sigue este template para crear modales robustos:

**Archivo:** `feature-create/feature-create.component.ts`

```typescript
import { Component, Input, Output, EventEmitter } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ReactiveFormsModule, FormGroup, FormBuilder, Validators } from "@angular/forms";
import { 
  ModalComponent, 
  ButtonComponent, 
  InputComponent, 
  SelectorComponent, 
  TextareaComponent 
} from "@/shared/components";

@Component({
  selector: "app-feature-create", // O vendix-feature-create
  standalone: true,
  imports: [
    CommonModule, 
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)" 
      (cancel)="onClose()"
      title="Nuevo Elemento"
      size="md"
    >
      <!-- Body -->
      <div class="p-4 space-y-4">
        <form [formGroup]="form">
          <app-input
            label="Nombre"
            formControlName="name"
            [control]="form.get('name')"
            [required]="true"
          ></app-input>
          
          <app-selector
            label="Categoría"
            formControlName="categoryId"
            [options]="categories"
          ></app-selector>
          
          <app-textarea
            label="Notas"
            formControlName="notes"
            rows="3"
          ></app-textarea>
        </form>
      </div>

      <!-- Footer -->
      <div slot="footer">
        <div class="flex items-center justify-end gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100">
          <app-button 
            variant="outline" 
            (clicked)="onClose()">
            Cancelar
          </app-button>
          
          <app-button 
            variant="primary" 
            (clicked)="onSubmit()" 
            [disabled]="form.invalid || isSubmitting"
            [loading]="isSubmitting">
            Guardar
          </app-button>
        </div>
      </div>
    </app-modal>
  `
})
export class FeatureCreateComponent {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  
  form: FormGroup;
  isSubmitting = false;

  constructor(private fb: FormBuilder) {
    this.form = this.fb.group({
      name: ['', Validators.required],
      categoryId: [null],
      notes: ['']
    });
  }

  onSubmit() {
    if (this.form.valid) {
      // Dispatch Action
      this.onClose();
    }
  }

  onClose() {
    this.isOpenChange.emit(false);
  }
}
```

---

## ⚙️ Propiedades de `app-modal`

| Propiedad         | Tipo                           | Descripción                                                               |
| ----------------- | ------------------------------ | ------------------------------------------------------------------------- |
| `isOpen`          | `boolean`                      | Controla la visibilidad del modal.                                        |
| `size`            | `'sm' \| 'md' \| 'lg' \| 'xl'` | Define el ancho máximo del modal.                                         |
| `title`           | `string`                       | Título principal en el header.                                            |
| `subtitle`        | `string`                       | Descripción secundaria bajo el título.                                    |
| `showCloseButton` | `boolean`                      | Muestra el botón 'X' en la esquina superior derecha (por defecto `true`). |

---

## 🎨 Estilo del Footer

El footer suele tener las siguientes características:

- Fondo gris claro: `bg-gray-50`.
- Bordes redondeados inferiores: `rounded-b-xl`.
- Contenedor Flex: `flex items-center justify-end gap-3`.
- Botones: Siempre incluir un botón de cancelar (outline) y uno de acción principal (primary).

---

## 📋 Mejores Prácticas

1.  **Uso de Slots**: Utiliza `slot="footer"` para el área de acciones inferiores.
2.  **Two-Way Binding**: Implementa `isOpen` y `isOpenChange` para permitir el uso de `[(isOpen)]` en el componente padre.
3.  **Manejo de Cierre**: Escucha el evento `(cancel)` de `app-modal` para limpiar el estado o cerrar el modal correctamente cuando el usuario presiona Escape o hace clic fuera.
4.  **Validación de Formularios**: Deshabilita el botón de acción principal si el formulario es inválido o si hay una operación en curso (`isSubmitting`).
5.  **Responsividad**: Utiliza clases de Tailwind como `p-2 md:p-4` para ajustar el padding según el tamaño de la pantalla.

---

## 🧠 Solución de Problemas Comunes

### El modal se cierra al hacer clic dentro (Click Propagation)
**Causa**: Event bubbling desde elementos internos hacia el backdrop.
**Solución**: El componente `app-modal` ya implementa una verificación robusta (`contains` check) en su manejador de clics.
1. Asegúrate de usar la última versión de `app-modal`.
2. **NO uses hacks de `stopPropagation`** en tus contenedores internos; el modal lo maneja nativamente.
3. Usa `app-input` y componentes del sistema, ya que tienen un manejo de eventos predecible.

### Error NG0100 (ExpressionChangedAfterItHasBeenCheckedError)
**Causa**: Mapear el evento `isOpenChange` (que emite `true` al abrirse) a una función que setea la variable a `false` inmediatamente.
**Solución**: En el template del modal, usa:
```html
(isOpenChange)="isOpenChange.emit($event)"
```
Esto asegura que el padre reciba el valor real (`true`) al inicio, manteniendo la sincronización. Solo emite `false` cuando realmente se cierra.

### Bordes dobles o estilos extraños
**Causa**: Envolver componentes como `app-table` en divs con bordes adicionales dentro del modal.
**Solución**: Los componentes del sistema (`app-table`) ya tienen sus bordes. Colócalos directamente en el contenedor del modal sin wrappers decorativos extra.

---

## 🔍 Referencia de Archivos Clave

| Archivo                                                                                             | Propósito                        |
| --------------------------------------------------------------------------------------------------- | -------------------------------- |
| `apps/frontend/src/app/shared/components/modal/modal.component.ts`                                  | Implementación base del modal.   |
| `apps/frontend/src/app/private/modules/store/products/components/product-create-modal.component.ts` | Ejemplo de referencia analizado. |
