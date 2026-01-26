---
name: vendix-angular-forms
description: >
  Angular Reactive Forms patterns with strict typing for FormControl bindings in templates.
  Trigger: When creating Angular forms, fixing FormControl type errors, or binding form controls in templates.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
  scope: [frontend]
  auto_invoke: "Creating Angular Forms"
---

## When to Use

Use this skill when:

- Creating new Angular Reactive Forms
- Fixing `Type 'AbstractControl | null' is not assignable to type 'FormControl'` errors
- Binding form controls to `[formControl]` directive in templates
- Working with typed FormControls in Angular 20+

## Critical Patterns

### Pattern 1: Typed FormControl Getters

**PROBLEM**: `form.get('fieldName')` returns `AbstractControl | null`, but `[formControl]` expects `FormControl`.

**SOLUTION**: Always create typed getters for each form control.

```typescript
import { FormGroup, FormControl } from "@angular/forms";

export class MyFormComponent {
  form: FormGroup = new FormGroup({
    email: new FormControl(""),
    enabled: new FormControl(false),
    maxValue: new FormControl(100),
  });

  // ✅ CORRECT: Typed getters
  get emailControl(): FormControl<string> {
    return this.form.get("email") as FormControl<string>;
  }

  get enabledControl(): FormControl<boolean> {
    return this.form.get("enabled") as FormControl<boolean>;
  }

  get maxValueControl(): FormControl<number> {
    return this.form.get("maxValue") as FormControl<number>;
  }
}
```

### Pattern 2: Template Binding

**ALWAYS** use getters in templates, **NEVER** use `form.get()` directly.

```html
<!-- ❌ WRONG: Direct form.get() - causes type errors -->
<app-input
  [formControl]="form.get('email')"
  type="email"
  label="Email"
></app-input>

<!-- ✅ CORRECT: Use typed getter -->
<app-input [formControl]="emailControl" type="email" label="Email"></app-input>

<!-- ❌ WRONG: With null assertion - still causes errors -->
<app-toggle
  [formControl]="form.get('enabled')!"
  (changed)="onFieldChange()"
></app-toggle>

<!-- ✅ CORRECT: Use typed getter -->
<app-toggle
  [formControl]="enabledControl"
  (changed)="onFieldChange()"
></app-toggle>
```

### Pattern 3: Nullable Form Controls

For optional/nullable fields, explicitly type as `T | null`:

```typescript
form: FormGroup = new FormGroup({
  logo_url: new FormControl(null),
  default_method: new FormControl(null),
});

// Typed getters for nullable controls
get logoUrlControl(): FormControl<string | null> {
  return this.form.get('logo_url') as FormControl<string | null>;
}

get defaultMethodControl(): FormControl<string | null> {
  return this.form.get('default_method') as FormControl<string | null>;
}
```

### Pattern 4: Select Elements

Native `<select>` elements also require typed getters:

```html
<!-- ❌ WRONG -->
<select [formControl]="form.get('currency')">
  <option value="USD">USD</option>
</select>

<!-- ✅ CORRECT -->
<select [formControl]="currencyControl">
  <option value="USD">USD</option>
</select>
```

```typescript
get currencyControl(): FormControl<string> {
  return this.form.get('currency') as FormControl<string>;
}
```

## Decision Tree

```
Need to bind a FormControl in template?
├─→ Is it a new form?
│   ├─→ YES: Create FormGroup with all controls
│   │        Create typed getters for each control
│   │        Use getters in template
│   └─→ NO: Continue
│
├─→ Getting type error "AbstractControl | null is not assignable"?
│   └─→ YES: Create typed getter for that control
│            Replace form.get() with getter in template
│
└─→ Is the field nullable/optional?
    └─→ YES: Type getter as FormControl<T | null>
```

## Common Type Mappings

| Field Type      | FormControl Type              | Example                               |
| --------------- | ----------------------------- | ------------------------------------- |
| Text input      | `FormControl<string>`         | `name`, `email`, `description`        |
| Number input    | `FormControl<number>`         | `price`, `quantity`, `threshold`      |
| Boolean/Toggle  | `FormControl<boolean>`        | `enabled`, `active`, `tax_included`   |
| Nullable string | `FormControl<string \| null>` | `logo_url`, `notes`, `optional_field` |
| Select/enum     | `FormControl<string>`         | `currency`, `language`, `status`      |

## Code Examples

### Example 1: Complete Form Component

```typescript
import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ReactiveFormsModule, FormGroup, FormControl } from "@angular/forms";
import { InputComponent } from "@shared/components/input/input.component";
import { ToggleComponent } from "@shared/components/toggle/toggle.component";

@Component({
  selector: "app-settings-form",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, InputComponent, ToggleComponent],
  templateUrl: "./settings-form.component.html",
})
export class SettingsFormComponent implements OnInit {
  form: FormGroup = new FormGroup({
    store_name: new FormControl(""),
    enabled: new FormControl(true),
    max_items: new FormControl(100),
    logo_url: new FormControl(null),
  });

  // Typed getters for all controls
  get storeNameControl(): FormControl<string> {
    return this.form.get("store_name") as FormControl<string>;
  }

  get enabledControl(): FormControl<boolean> {
    return this.form.get("enabled") as FormControl<boolean>;
  }

  get maxItemsControl(): FormControl<number> {
    return this.form.get("max_items") as FormControl<number>;
  }

  get logoUrlControl(): FormControl<string | null> {
    return this.form.get("logo_url") as FormControl<string | null>;
  }

  ngOnInit() {
    // Form initialization logic
  }

  onSubmit() {
    if (this.form.valid) {
      console.log(this.form.value);
    }
  }
}
```

### Example 2: Template with Typed Controls

```html
<form [formGroup]="form" (ngSubmit)="onSubmit()">
  <!-- Text input -->
  <app-input
    [formControl]="storeNameControl"
    type="text"
    label="Store Name"
    placeholder="My Store"
  ></app-input>

  <!-- Toggle -->
  <app-toggle
    [formControl]="enabledControl"
    ariaLabel="Enable store"
  ></app-toggle>

  <!-- Number input -->
  <app-input
    [formControl]="maxItemsControl"
    type="number"
    label="Max Items"
    min="0"
  ></app-input>

  <!-- Nullable input -->
  <app-input
    [formControl]="logoUrlControl"
    type="url"
    label="Logo URL"
    placeholder="https://example.com/logo.png"
  ></app-input>

  <!-- Native select -->
  <select [formControl]="currencyControl">
    <option value="USD">USD</option>
    <option value="EUR">EUR</option>
  </select>
</form>
```

### Example 3: Fixing Existing Type Errors

**BEFORE (with errors):**

```typescript
// Component
form: FormGroup = new FormGroup({
  enabled: new FormControl(true),
});

// Template
<app-toggle [formControl]="form.get('enabled')"></app-toggle>
// ❌ ERROR: Type 'AbstractControl | null' is not assignable
```

**AFTER (fixed):**

```typescript
// Component - Add getter
form: FormGroup = new FormGroup({
  enabled: new FormControl(true),
});

get enabledControl(): FormControl<boolean> {
  return this.form.get('enabled') as FormControl<boolean>;
}

// Template - Use getter
<app-toggle [formControl]="enabledControl"></app-toggle>
// ✅ No errors
```

## Commands

```bash
# Generate new form component
ng generate component modules/settings/settings-form --standalone

# Run type check
npm run type-check -w apps/frontend

# Check build errors
docker logs --tail 60 vendix_frontend
```

## Best Practices

1. **Always create getters**: Don't use `form.get()` directly in templates
2. **Type correctly**: Use appropriate types (`string`, `number`, `boolean`, `T | null`)
3. **Consistent naming**: Use `{fieldName}Control` pattern for getters
4. **Group getters**: Place all getters together after form definition
5. **Document nullable**: Comment why a field is nullable if not obvious

## Anti-Patterns

❌ **DON'T** use `form.get()` in templates:

```html
<app-input [formControl]="form.get('email')"></app-input>
```

❌ **DON'T** use null assertions without getters:

```html
<app-toggle [formControl]="form.get('enabled')!"></app-toggle>
```

❌ **DON'T** cast to `any`:

```typescript
get emailControl(): any {
  return this.form.get('email');
}
```

❌ **DON'T** forget type parameters:

```typescript
// Wrong - no type specified
get emailControl(): FormControl {
  return this.form.get('email') as FormControl;
}

// Correct - with type
get emailControl(): FormControl<string> {
  return this.form.get('email') as FormControl<string>;
}
```

## Resources

- **Angular Forms Documentation**: https://angular.dev/guide/forms
- **TypeScript Strict Mode**: https://www.typescriptlang.org/tsconfig#strict
- **Related Skills**: `vendix-frontend-component`, `vendix-frontend`
