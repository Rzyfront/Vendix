---
name: vendix-frontend-modal
description: Implementation patterns for modals in the Vendix frontend.
metadata:
  scope: [root]
  auto_invoke: "Creating or modifying modals in frontend"
---

# Vendix Frontend Modal Pattern

This skill describes the standard pattern for implementing modals in Vendix, using `app-modal` and the Modal-First architecture.

## Critical Rules (Best Practices)

1.  **System Components Only**: Inside the modal, ALWAYS use system components (`app-input`, `app-selector`, `app-textarea`). Avoid raw HTML inputs to maintain consistency and prevent event conflicts.
2.  **State Propagation (Prevent NG0100)**: When handling `isOpenChange`, **ALWAYS** emit the raw event (`$event`).
    *   Correct: `(isOpenChange)="isOpenChange.emit($event)"`
    *   Incorrect: `(isOpenChange)="closeModal()"` (If `closeModal` forces `false` immediately, it causes an `ExpressionChangedAfterItHasBeenCheckedError` loop when the modal tries to open).
3.  **Single-View Architecture**: For simple CRUD modules, avoid creating child routes (`/create`, `/edit/:id`). Use a single "List" view and handle Creation/Editing through modals on the same view.

---

## Component Structure (Modal Wrapper)

Follow this template to create robust modals:

**File:** `feature-create/feature-create.component.ts`

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
  selector: "app-feature-create", // Or vendix-feature-create
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

          <app-selector
            label="Category"
            formControlName="categoryId"
            [options]="categories"
          ></app-selector>

          <app-textarea
            label="Notes"
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
            Cancel
          </app-button>

          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="form.invalid || isSubmitting"
            [loading]="isSubmitting">
            Save
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

## `app-modal` Properties

| Property          | Type                           | Description                                                          |
| ----------------- | ------------------------------ | -------------------------------------------------------------------- |
| `isOpen`          | `boolean`                      | Controls the modal visibility.                                       |
| `size`            | `'sm' \| 'md' \| 'lg' \| 'xl'` | Defines the maximum width of the modal.                              |
| `title`           | `string`                       | Main title in the header.                                            |
| `subtitle`        | `string`                       | Secondary description below the title.                               |
| `showCloseButton` | `boolean`                      | Shows the 'X' button in the top-right corner (defaults to `true`).   |

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
2.  **Two-Way Binding**: Implement `isOpen` and `isOpenChange` to allow `[(isOpen)]` usage in the parent component.
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
**Cause**: Mapping the `isOpenChange` event (which emits `true` on open) to a function that sets the variable to `false` immediately.
**Solution**: In the modal template, use:
```html
(isOpenChange)="isOpenChange.emit($event)"
```
This ensures the parent receives the actual value (`true`) at the start, maintaining synchronization. It only emits `false` when it actually closes.

### Double borders or strange styles
**Cause**: Wrapping components like `app-table` in divs with additional borders inside the modal.
**Solution**: System components (`app-table`) already have their own borders. Place them directly in the modal container without extra decorative wrappers.

---

## Key File Reference

| File                                                                                                | Purpose                            |
| --------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `apps/frontend/src/app/shared/components/modal/modal.component.ts`                                  | Base modal implementation.         |
| `apps/frontend/src/app/private/modules/store/products/components/product-create-modal.component.ts` | Analyzed reference example.        |
