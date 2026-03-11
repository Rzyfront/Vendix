---
name: vendix-frontend-sticky-header
description: Guidelines for professional sticky headers in modules.
metadata:
  scope: [frontend]
  auto_invoke: "Implementing sticky headers or Refactoring module headers"
---
# Vendix Sticky Header Pattern

> **CRITICAL RULE** - Sticky headers must ALWAYS be at the root of the form or main container, and NEVER inside a container with internal padding.

## The Sticky Problem

When a header has `sticky top-0` and its parent container has `padding`, the header will stick to the start of the parent's padding, NOT to the top of the screen. This causes a visual "jump" or offset during scrolling.

### WRONG (The Padded Parent)
```html
<div class="p-4 md:p-6"> <!-- Padding here breaks sticky! -->
  <div class="sticky top-0 z-30 bg-white shadow-sm">
    <h1>Header Title</h1>
  </div>
  <div class="content">...</div>
</div>
```

### CORRECT (The Clean Parent)
```html
<div class="min-h-screen"> <!-- No padding on parent -->
  <div class="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b p-4 md:px-6 shadow-sm">
    <div class="max-w-[1600px] mx-auto flex items-center justify-between">
      <h1>Header Title</h1>
      <div class="actions">...</div>
    </div>
  </div>

  <div class="p-4 md:p-6"> <!-- Padding here is safe -->
    <div class="max-w-[1600px] mx-auto">
      <div class="content">...</div>
    </div>
  </div>
</div>
```

---

## Implementation Checklist

1.  **Sticky Container**: `sticky top-0 z-30`
2.  **Aesthetics**:
    -   `bg-white/80` + `backdrop-blur-md` (Premium glassmorphism)
    -   `border-b border-gray-200`
    -   `shadow-sm`
    -   `rounded-b-xl` (Optional, for floating card style)
3.  **Actions**: Move "Save" and "Cancel" buttons to the header (right side).
4.  **Badges**: Place status badges (Order Status, Edit Mode) next to the title.
5.  **Layout**: Use an inner container `max-w-[1600px] mx-auto` for consistency.

---

## Recommended Styles (Tailwind)

For a professional and "Premium" header:

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
          <span class="px-2 py-1 bg-green-100 text-green-700 text-[10px] font-bold uppercase rounded-lg">Active</span>
        </div>
        <p class="text-sm text-gray-500">Descriptive subtitle for the module</p>
      </div>
    </div>

    <!-- Right: Actions -->
    <div class="flex items-center gap-3">
      <app-button variant="outline" size="sm">Cancel</app-button>
      <app-button variant="primary" size="sm">Save Changes</app-button>
    </div>
  </div>
</div>
```

---

## Common Error Prevention

-   **Z-index**: Always use `z-30` or higher to prevent scroll content from overlapping the header.
-   **Form Scope**: If the header has buttons that trigger form `submit`, make sure the `<form>` wraps the entire header.
-   **Negative Margins**: AVOID using negative margins (`-mx-4`) to "compensate" for parent padding. It is better to move the parent's padding to the content children.

---

---

## Reusable Component Pattern

To avoid duplication and maintain consistency, use the `app-sticky-header` component available in `shared/components`.

### Component API

#### Inputs
| Input | Type | Required | Default |
|-------|------|----------|---------|
| `title` | `string` | Yes | - |
| `subtitle` | `string` | No | `''` |
| `icon` | `string` | No | `'box'` |
| `variant` | `'default' \| 'glass'` | No | `'glass'` |
| `showBackButton` | `boolean` | No | `false` |
| `backRoute` | `string \| string[]` | No | `'/'` |
| `badgeText` | `string` | No | `''` |
| `badgeColor` | `'green' \| 'blue' \| 'yellow' \| 'gray' \| 'red'` | No | `'blue'` |
| `actions` | `StickyHeaderActionButton[]` | No | `[]` |

#### Outputs
| Output | Payload |
|--------|---------|
| `actionClicked` | `string` (button ID) |

### Interfaces

```typescript
interface StickyHeaderActionButton {
  id: string;           // Unique ID to emit in actionClicked
  label: string;        // Button text
  variant: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  icon?: string;        // Optional Lucide icon
  loading?: boolean;    // Loading state
  disabled?: boolean;   // Disabled state
  visible?: boolean;    // Show/hide
}
```

### Usage Example

```html
<app-sticky-header
  [title]="isEditMode ? 'Edit Product' : 'New Product'"
  [subtitle]="isEditMode ? 'Manage the information...' : 'Register a new product...'"
  [icon]="isEditMode ? 'package' : 'plus-circle'"
  [showBackButton]="true"
  backRoute="/admin/products"
  [actions]="productHeaderActions()"
  (actionClicked)="onHeaderAction($event)">
</app-sticky-header>
```

```typescript
readonly productHeaderActions = computed<StickyHeaderActionButton[]>(() => [
  { id: 'cancel', label: 'Cancel', variant: 'outline' },
  { id: 'save', label: this.isEditMode() ? 'Save Changes' : 'Create Product', variant: 'primary', loading: this.isSubmitting() },
]);

onHeaderAction(actionId: string): void {
  if (actionId === 'cancel') this.onCancel();
  else if (actionId === 'save') this.onSubmit();
}
```

## Related Skills
- `vendix-frontend-component` - Basic component rules
- `vendix-frontend-theme` - Branding and color patterns
- `vendix-naming-conventions` - Proper naming for classes and files
