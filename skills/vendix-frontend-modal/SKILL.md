---
name: vendix-frontend-modal
description: Implementation patterns for modals in the Vendix frontend.
metadata:
  scope: [root]
  auto_invoke: "Creating or modifying modals in frontend"
---

# Vendix Frontend Modal Pattern

> **Tip**: Antes de usar app-modal, consulta su README en `apps/frontend/src/app/shared/components/modal/README.md` para conocer sus inputs, outputs, gotchas y patrones de uso.

This skill describes the standard pattern for implementing modals in Vendix, using `app-modal` and the Modal-First architecture.

## Critical Rules (Best Practices)

1.  **System Components Only**: Inside the modal, ALWAYS use system components (`app-input`, `app-selector`, `app-textarea`). Avoid raw HTML inputs to maintain consistency and prevent event conflicts.
2.  **Two-Way Binding con `model()`**: `app-modal` usa `model()` para `isOpen`.
    Usar siempre `[(isOpen)]` para two-way binding.
    - Correcto: `[(isOpen)]="showModal"`
    - También válido (one-way + handler): `[isOpen]="showModal" (isOpenChange)="onClose($event)"`
    - El NG0100 ya no aplica con `model()` — el cierre es reactivo por diseño.
3.  **Single-View Architecture**: For simple CRUD modules, avoid creating child routes (`/create`, `/edit/:id`). Use a single "List" view and handle Creation/Editing through modals on the same view.

---

## Component Structure (Modal Wrapper)

Follow this template to create robust modals:

**File:** `feature-create/feature-create.component.ts`

```typescript
import { Component, model, signal, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import {
  ReactiveFormsModule,
  FormGroup,
  FormBuilder,
  Validators,
} from "@angular/forms";
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  SelectorComponent,
  TextareaComponent,
} from "@/shared/components";

@Component({
  selector: "app-feature-create",
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
  ],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      (cancel)="onClose()"
      title="New Item"
      size="md"
    >
      <!-- Body -->
      <div class="p-4 space-y-4">
        <form [formGroup]="form">
          <app-input
            label="Name"
            formControlName="name"
            [control]="form.get('name')"
            [required]="true"
          ></app-input>
        </form>
      </div>

      <!-- Footer -->
      <div slot="footer" class="flex gap-3 justify-end w-full">
        <app-button variant="ghost" (clicked)="onClose()">Cancelar</app-button>
        <app-button variant="primary" [loading]="isSubmitting()" (clicked)="onSubmit()">
          Guardar
        </app-button>
      </div>
    </app-modal>
  `,
})
export class FeatureCreateComponent {
  private fb = inject(FormBuilder);

  // Two-way binding con el padre — model() reemplaza @Input() + @Output()
  readonly isOpen = model<boolean>(false);

  // Estado local con signals
  readonly isSubmitting = signal(false);

  form = this.fb.group({
    name: ['', Validators.required],
  });

  onClose(): void {
    this.isOpen.set(false);
  }

  onSubmit(): void {
    if (this.form.invalid) return;
    this.isSubmitting.set(true);
    // ... lógica de submit
  }
}
```

> **Nota sobre patrones legacy**: Si encuentras modales con `@Input() isOpen` y `@Output() isOpenChange = new EventEmitter()`, son componentes que aún no se han migrado. En código nuevo, **siempre usar `model()`**.

---

## Uso desde el Padre

El componente padre declara un signal local y lo pasa con two-way binding:

```html
<!-- padre.component.html -->
<app-feature-create [(isOpen)]="showCreateModal" />

<app-button (clicked)="showCreateModal.set(true)">Crear</app-button>
```

```typescript
// padre.component.ts
readonly showCreateModal = signal(false);
```

---

## `app-modal` Properties

| Property          | Type                           | Description                                                        |
| ----------------- | ------------------------------ | ------------------------------------------------------------------ |
| `isOpen`          | `boolean`                      | Controls the modal visibility.                                     |
| `size`            | `'sm' \| 'md' \| 'lg' \| 'xl'` | Defines the maximum width of the modal.                            |
| `title`           | `string`                       | Main title in the header.                                          |
| `subtitle`        | `string`                       | Secondary description below the title.                             |
| `showCloseButton` | `boolean`                      | Shows the 'X' button in the top-right corner (defaults to `true`). |

---

## Footer Styling

The footer typically has the following characteristics:

- Light gray background: `bg-gray-50`.
- Bottom rounded corners: `rounded-b-xl`.
- Flex container: `flex items-center justify-end gap-3`.
- Buttons: Always include a cancel button (outline) and a primary action button (primary).

---

## Best Practices

1.  **Using Slots**: Use `slot="footer"` for the bottom action area.
2.  **Two-Way Binding**: Usar `model<boolean>(false)` para `isOpen`. El padre usa `[(isOpen)]="showModal"` con un signal local.
3.  **Close Handling**: Listen to the `(cancel)` event from `app-modal` to clean up state or properly close the modal when the user presses Escape or clicks outside.
4.  **Form Validation**: Disable the primary action button if the form is invalid or if an operation is in progress (`isSubmitting`).
5.  **Responsiveness**: Use Tailwind classes like `p-2 md:p-4` to adjust padding based on screen size.

---

## Troubleshooting Common Issues

### Modal closes when clicking inside (Click Propagation)

**Cause**: Event bubbling from inner elements to the backdrop.
**Solution**: The `app-modal` component already implements a robust verification (`contains` check) in its click handler.

1. Make sure you are using the latest version of `app-modal`.
2. **Do NOT use `stopPropagation` hacks** in your inner containers; the modal handles this natively.
3. Use `app-input` and system components, as they have predictable event handling.

### NG0100 Error (ExpressionChangedAfterItHasBeenCheckedError)

**Estado**: Ya no aplica con `model()`. El two-way binding reactivo de `model()` gestiona el estado de apertura de forma sincrónica dentro del ciclo de Signals, eliminando este error por diseño.

**Si aún aparece en código legacy** (componentes con `@Input()/@Output()`): La causa es mapear `isOpenChange` a una función que fuerza `false` inmediatamente. La solución legacy era usar `(isOpenChange)="isOpenChange.emit($event)"`. La solución definitiva es migrar a `model()`.

### Double borders or strange styles

**Cause**: Wrapping components like `app-table` in divs with additional borders inside the modal.
**Solution**: System components (`app-table`) already have their own borders. Place them directly in the modal container without extra decorative wrappers.

---

## Key File Reference

| File                                                                                                | Purpose                     |
| --------------------------------------------------------------------------------------------------- | --------------------------- |
| `apps/frontend/src/app/shared/components/modal/modal.component.ts`                                  | Base modal implementation.  |
| `apps/frontend/src/app/private/modules/store/products/components/product-create-modal.component.ts` | Analyzed reference example. |
