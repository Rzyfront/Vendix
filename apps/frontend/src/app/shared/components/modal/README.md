# Componente Modal

## 📋 Descripción General

El componente `Modal` es un componente reutilizable de Angular que permite mostrar contenido en una ventana superpuesta (overlay) con soporte para dos vías de data binding (two-way binding).

**Características principales:**
- ✅ Two-way binding con `[(isOpen)]`
- ✅ Soporte para backdrop click y tecla Escape
- ✅ Múltiples tamaños (sm, md, lg, xl)
- ✅ Animaciones suaves
- ✅ Bloqueo de scroll del body
- ✅ Accesibilidad (ARIA)

## 🚀 Uso Básico

### Two-Way Binding (Recomendado)

```html
<app-modal [(isOpen)]="isModalOpen" title="Mi Modal">
  <p>Contenido del modal</p>

  <div slot="footer" class="flex justify-end gap-3">
    <app-button variant="outline" (clicked)="isModalOpen = false">
      Cancelar
    </app-button>
    <app-button variant="primary" (clicked)="onSubmit()">
      Guardar
    </app-button>
  </div>
</app-modal>
```

```typescript
export class MiComponente {
  isModalOpen = false;

  onSubmit(): void {
    // Tu lógica aquí
    this.isModalOpen = false; // El modal se cerrará automáticamente
  }
}
```

## 📐 Variantes de Tamaño

El modal tiene 4 variantes de tamaño:

```html
<!-- Pequeño -->
<app-modal [(isOpen)]="isOpen" size="sm">...</app-modal>

<!-- Mediano (default) -->
<app-modal [(isOpen)]="isOpen" size="md">...</app-modal>

<!-- Grande -->
<app-modal [(isOpen)]="isOpen" size="lg">...</app-modal>

<!-- Extra grande -->
<app-modal [(isOpen)]="isOpen" size="xl">...</app-modal>
```

## 📝 Patrones Estándar

### 1. Modal de Creación

```html
<app-modal
  [(isOpen)]="showCreateModal"
  title="Crear Nuevo Usuario"
  size="lg"
>
  <form [formGroup]="userForm" (ngSubmit)="onSubmit()">
    <!-- Campos del formulario -->
  </form>

  <div slot="footer" class="flex justify-end gap-3">
    <app-button
      variant="outline"
      (clicked)="onCancel()"
      [disabled]="isSubmitting">
      Cancelar
    </app-button>
    <app-button
      variant="primary"
      (clicked)="onSubmit()"
      [disabled]="userForm.invalid || isSubmitting"
      [loading]="isSubmitting">
      Crear Usuario
    </app-button>
  </div>
</app-modal>
```

```typescript
export class UserCreateModalComponent {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() submit = new EventEmitter<CreateUserDto>();

  userForm: FormGroup;
  isSubmitting = false;

  onSubmit(): void {
    if (this.userForm.invalid || this.isSubmitting) return;

    this.isSubmitting = true;
    const userData = this.userForm.value;

    this.usersService.create(userData).subscribe({
      next: (result) => {
        this.isSubmitting = false;
        this.submit.emit(result);
        this.isOpenChange.emit(false); // Cierra el modal
        this.resetForm();
      },
      error: (err) => {
        this.isSubmitting = false;
        // Manejar error
      }
    });
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
    this.resetForm();
  }

  private resetForm(): void {
    this.userForm.reset({ /* valores por defecto */ });
  }
}
```

### 2. Modal de Edición

```html
<app-modal
  [(isOpen)]="showEditModal"
  [title]="'Editar Usuario: ' + currentUser?.name"
  size="lg"
>
  <form [formGroup]="userForm" (ngSubmit)="onSubmit()">
    <!-- Campos del formulario pre-llenados -->
  </form>

  <div slot="footer" class="flex justify-end gap-3">
    <app-button
      variant="outline"
      (clicked)="onCancel()"
      [disabled]="isSubmitting">
      Cancelar
    </app-button>
    <app-button
      variant="primary"
      (clicked)="onSubmit()"
      [disabled]="userForm.invalid || isSubmitting"
      [loading]="isSubmitting">
      Guardar Cambios
    </app-button>
  </div>
</app-modal>
```

```typescript
export class UserEditModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() user: User | null = null;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() submit = new EventEmitter<UpdateUserDto>();

  userForm: FormGroup;
  isSubmitting = false;

  ngOnChanges(): void {
    if (this.user) {
      this.userForm.patchValue({
        first_name: this.user.first_name,
        last_name: this.user.last_name,
        email: this.user.email,
        // ... más campos
      });
    }
  }

  onSubmit(): void {
    // Similar al modal de creación
  }
}
```

### 3. Modal de Confirmación

```html
<app-modal
  [(isOpen)]="showConfirmModal"
  [title]="title"
  [subtitle]="subtitle"
  size="sm"
  [showCloseButton]="false"
>
  <p>{{ message }}</p>

  <div slot="footer" class="flex justify-end gap-3">
    <app-button
      variant="outline"
      (clicked)="onCancel()">
      Cancelar
    </app-button>
    <app-button
      variant="destructive"
      (clicked)="onConfirm()">
      Confirmar
    </app-button>
  </div>
</app-modal>
```

```typescript
export class ConfirmModalComponent {
  @Input() isOpen = false;
  @Input() title = '¿Estás seguro?';
  @Input() subtitle = '';
  @Input() message = 'Esta acción no se puede deshacer.';
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() confirm = new EventEmitter<void>();

  onConfirm(): void {
    this.confirm.emit();
    this.isOpenChange.emit(false);
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }
}
```

## 🎨 Inputs del Modal

| Input | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `isOpen` | `boolean` | `false` | Estado del modal (two-way binding) |
| `title` | `string` | `undefined` | Título del modal |
| `subtitle` | `string` | `undefined` | Subtítulo del modal |
| `size` | `'sm' \| 'md' \| 'lg' \| 'xl'` | `'md'` | Tamaño del modal |
| `centered` | `boolean` | `true` | Centrar modal verticalmente |
| `closeOnBackdrop` | `boolean` | `false` | Cerrar al hacer click en el backdrop (QUI-438: ahora `false` por default) |
| `closeOnEscape` | `boolean` | `true` | Cerrar con tecla Escape |
| `showCloseButton` | `boolean` | `true` | Mostrar botón X en la cabecera |
| `customClasses` | `string` | `''` | Clases CSS adicionales |

## 📤 Outputs del Modal

| Output | Tipo | Descripción |
|--------|------|-------------|
| `isOpenChange` | `EventEmitter<boolean>` | Se emite cuando cambia el estado (para two-way binding) |
| `opened` | `EventEmitter<void>` | Se emite cuando el modal se abre |
| `closed` | `EventEmitter<void>` | Se emite cuando el modal se cierra |

## ⚠️ Errores Comunes (¡EVITAR!)

### ❌ INCORRECTO: Ignorar el valor del evento

```html
<!-- NO HACER ESTO -->
<app-modal [isOpen]="isOpen" (isOpenChange)="onClose.emit()">
```

**Problema**: El modal hijo ignora el valor del evento y siempre emite `onClose`, rompiendo la cadena de eventos.

### ✅ CORRECTO: Retransmitir el valor del evento

```html
<app-modal [(isOpen)]="isOpen">
</app-modal>

<!-- O con manejo adicional -->
<app-modal [isOpen]="isOpen" (isOpenChange)="onOpenChange($event)">
```

```typescript
onOpenChange(isOpen: boolean): void {
  this.isOpenChange.emit(isOpen); // SIEMPRE retransmitir
  if (!isOpen) {
    this.resetForm(); // Limpieza al cerrar
  }
}
```

### ❌ INCORRECTO: Botones fuera del footer

```html
<app-modal [(isOpen)]="isOpen">
  <form>...</form>

  <!-- NO HACER ESTO: botones fuera del footer -->
  <div class="flex gap-2">
    <button>Cancelar</button>
    <button>Guardar</button>
  </div>
</app-modal>
```

### ✅ CORRECTO: Botones en el footer

```html
<app-modal [(isOpen)]="isOpen">
  <form>...</form>

  <div slot="footer" class="flex justify-end gap-3">
    <app-button variant="outline" (clicked)="onCancel()">Cancelar</app-button>
    <app-button variant="primary" (clicked)="onSubmit()">Guardar</app-button>
  </div>
</app-modal>
```

## 🔧 Mejores Prácticas

### 1. Siempre usar Two-Way Binding

```typescript
// ✅ CORRECTO
export class ParentComponent {
  showModal = false;

  openModal(): void {
    this.showModal = true;
  }
}

// ❌ INCORRECTO
export class ParentComponent {
  showModal = false;

  openModal(): void {
    this.showModal = true;
  }

  onModalChange(isOpen: boolean): void {
    this.showModal = isOpen; // Innecesario con two-way binding
  }
}
```

### 2. Limpiar Forms al Cerrar

```typescript
onOpenChange(isOpen: boolean): void {
  this.isOpenChange.emit(isOpen);
  if (!isOpen) {
    this.resetForm(); // Siempre limpiar al cerrar
  }
}

private resetForm(): void {
  this.form.reset({
    name: '',
    email: '',
    // ... valores por defecto
  });
}
```

### 3. Prevenir Submit durante Submit

```typescript
onSubmit(): void {
  if (this.isSubmitting) return; // Prevenir double-submit
  if (this.form.invalid) {
    this.form.markAllAsTouched();
    return;
  }

  this.isSubmitting = true;
  // ... lógica de submit
}
```

### 4. Botones en el Footer

**SIEMPRE** colocar los botones de acción en el `<div slot="footer">`:

```html
<div slot="footer" class="flex justify-end gap-3">
  <!-- Botón secundario/outline a la izquierda -->
  <app-button variant="outline" (clicked)="onCancel()">
    Cancelar
  </app-button>

  <!-- Botón primario a la derecha -->
  <app-button
    variant="primary"
    (clicked)="onSubmit()"
    [disabled]="form.invalid || isSubmitting"
    [loading]="isSubmitting">
    Guardar
  </app-button>
</div>
```

## 🔄 Guía de Migración

### De Patrón Viejo a Patrón Nuevo

**Antes (Patrón Viejo)**:
```html
<!-- Parent -->
<app-user-modal
  [isOpen]="showModal"
  (openChange)="onModalChange($event)"
  (submit)="onUserCreated($event)">
</app-user-modal>
```

```typescript
export class ParentComponent {
  showModal = false;

  onModalChange(isOpen: boolean): void {
    this.showModal = isOpen;
  }
}
```

```html
<!-- Child Modal -->
<app-modal
  [isOpen]="isOpen"
  (openChange)="onClose.emit()">
```

**Después (Patrón Nuevo)**:
```html
<!-- Parent -->
<app-user-modal
  [(isOpen)]="showModal"
  (submit)="onUserCreated($event)">
</app-user-modal>
```

```typescript
export class ParentComponent {
  showModal = false;
  // ¡No necesitas onModalChange!
}
```

```html
<!-- Child Modal -->
<app-modal [(isOpen)]="isOpen">
```

## 🐛 Debugging

### El modal no se abre

1. **Verificar que la variable esté conectada**:
   ```typescript
   console.log('isOpen:', this.isOpen); // Debe ser true
   ```

2. **Verificar que *ngIf no lo esté ocultando**:
   ```html
   <!-- NO usar *ngIf con [(isOpen)] -->
   <!-- ❌ INCORRECTO -->
   <app-modal *ngIf="shouldShow" [(isOpen)]="isOpen">

   <!-- ✅ CORRECTO -->
   <app-modal [(isOpen)]="isOpen">
   ```

### El modal no se cierra

1. **Verificar que isOpenChange se esté emitiendo**:
   ```typescript
   this.isOpenChange.emit(false); // Debe llamarse
   ```

2. **Verificar que el evento se esté retransmitiendo**:
   ```typescript
   onOpenChange(isOpen: boolean): void {
     console.log('Modal isOpen:', isOpen); // Debe imprimir
     this.isOpenChange.emit(isOpen); // Debe retransmitir
   }
   ```

### El modal no se puede volver a abrir

**Este es el bug principal que corregimos**. Si ocurre:

1. **Verificar que estás usando two-way binding**:
   ```html
   <!-- ✅ CORRECTO -->
   <app-modal [(isOpen)]="isOpen">

   <!-- ❌ INCORRECTO -->
   <app-modal [isOpen]="isOpen" (isOpenChange)="onClose.emit()">
   ```

2. **Verificar que estás retransmitiendo el evento**:
   ```typescript
   // ✅ CORRECTO
   onOpenChange(isOpen: boolean): void {
     this.isOpenChange.emit(isOpen); // Retransmitir
   }

   // ❌ INCORRECTO
   onClose(): void {
     this.onClose.emit(); // No retransmite el valor
   }
   ```

## 📚 Referencias

- [Angular Two-Way Binding](https://angular.io/guide/two-way-binding)
- [Angular Event Emitter](https://angular.io/api/core/EventEmitter)
- [WAI-ARIA Dialog Role](https://www.w3.org/TR/wai-aria-1.2/#dialog)

---

**Última actualización**: Diciembre 2025
**Versión**: 2.0.0 (con two-way binding)
