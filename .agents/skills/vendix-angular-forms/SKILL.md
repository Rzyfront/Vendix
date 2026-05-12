---
name: vendix-angular-forms
description: >
  Angular Reactive Forms patterns with strict typing, shared CVA components, and Zoneless-safe
  form state. Trigger: When creating Angular forms, fixing FormControl type errors, binding
  form controls in templates, or implementing ControlValueAccessor components.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
  auto_invoke:
    - "Creating Angular Forms"
    - "Binding form controls in Angular templates"
    - "Implementing ControlValueAccessor in frontend components"
---

## When to Use

- Creating or refactoring Angular reactive forms.
- Fixing `AbstractControl | null` template binding errors.
- Choosing between `[formControl]` and `formControlName`.
- Working with shared CVA controls such as `app-input` and `app-toggle`.

Before using shared controls, check their READMEs under `apps/frontend/src/app/shared/components/{input,toggle}/` and verify current inputs in the component source.

## Current References

- Clean typed getter form: `apps/frontend/src/app/private/modules/store/settings/general/components/general-settings-form/`
- Typed `FormGroup` examples: `apps/frontend/src/app/private/modules/super-admin/subscriptions/pages/gateway/` and `plans/plan-form.component.ts`
- Large `formControlName` example: `apps/frontend/src/app/private/modules/store/products/pages/product-create-page/`
- Shared CVAs: `apps/frontend/src/app/shared/components/input/input.component.ts` and `toggle/toggle.component.ts`

## Binding Choice

| Template Pattern | Use When | Rule |
| --- | --- | --- |
| `formControlName="name"` inside `[formGroup]` | Standard form layout with static control names | Preferred for straightforward forms |
| `[formControl]="nameControl"` | Passing a specific control to a component or dynamic binding | Use a typed getter or typed property |
| `[control]="..."` | Component-specific extra input, not Angular Forms binding | Avoid `form.get()` directly unless the component explicitly needs `AbstractControl` |

Do not use `$any(form.get(...))` in new code. It exists in legacy pages only.

## Typed Getter Pattern

Use typed getters when binding to `[formControl]`.

```typescript
readonly form = new FormGroup({
  name: new FormControl('', { nonNullable: true }),
  enabled: new FormControl(false, { nonNullable: true }),
  logoUrl: new FormControl<string | null>(null),
});

get nameControl(): FormControl<string> {
  return this.form.get('name') as FormControl<string>;
}

get enabledControl(): FormControl<boolean> {
  return this.form.get('enabled') as FormControl<boolean>;
}

get logoUrlControl(): FormControl<string | null> {
  return this.form.get('logoUrl') as FormControl<string | null>;
}
```

```html
<app-input [formControl]="nameControl" label="Name" />
<app-toggle [formControl]="enabledControl" label="Enabled" />
```

## formControlName Pattern

Use `formControlName` when the control is inside the current `[formGroup]` and no explicit control reference is needed.

```html
<form [formGroup]="form" (ngSubmit)="onSubmit()">
  <app-input formControlName="name" label="Name" />
  <app-toggle formControlName="is_active" label="Active" />
</form>
```

This avoids repetitive getters for large static forms.

## Typed FormGroup Pattern

Prefer typed forms for new complex forms.

```typescript
interface GatewayFormControls {
  public_key: FormControl<string>;
  private_key: FormControl<string>;
  enabled: FormControl<boolean>;
}

readonly form = new FormGroup<GatewayFormControls>({
  public_key: new FormControl('', { nonNullable: true }),
  private_key: new FormControl('', { nonNullable: true }),
  enabled: new FormControl(false, { nonNullable: true }),
});
```

## Shared CVA Facts

`InputComponent` is a CVA and supports text-like types including `text`, `email`, `password`, `number`, `tel`, `url`, `search`, `date`, `time`, `datetime-local`, and `color`.

Important `InputComponent` features:

- `currency`, `currencyDecimals`, and `allowNegative` for money inputs.
- `prefixIcon`, `suffixIcon`, `suffixClickable`, and `suffixClick`.
- `tooltipText`, `tooltipPosition`, and `tooltipVisible`.
- CVA value and disabled state are stored in signals.

`ToggleComponent` is a CVA with `checked`, `disabled`, `label`, `ariaLabel`, and `styleVariant`. It emits both `toggled` and `changed`, and stores form-written state in signals.

## Zoneless CVA Rule

In any custom CVA, every field written by `writeValue` or `setDisabledState` and read by the template must be a `signal()`.

```typescript
readonly value = signal(false);
readonly disabledFromForm = signal(false);

writeValue(value: boolean): void {
  this.value.set(Boolean(value));
}

setDisabledState(disabled: boolean): void {
  this.disabledFromForm.set(disabled);
}
```

Plain mutable fields in CVA callbacks can leave the template stale in Zoneless mode.

## Anti-Patterns

- Do not bind `[formControl]="form.get('name')"` in templates.
- Do not use `[formControl]="form.get('name')!"`; use a typed getter.
- Do not use `$any(...)` in new form templates.
- Do not cast getters to `any`.
- Do not use plain template-read fields for CVA `value`, `disabled`, `checked`, or `selected` state.

## Related Skills

- `vendix-zoneless-signals` - Signals, CVA, and change detection rules
- `vendix-currency-formatting` - Money input/display patterns
- `vendix-date-timezone` - Date input and date-only handling
- `vendix-frontend-sticky-header` - Form page headers and save/cancel actions
