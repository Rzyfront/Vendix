---
name: vendix-frontend-sticky-header
description: >
  Reusable sticky header pattern for Vendix form/detail pages. Trigger: When implementing
  sticky headers, page-level save/cancel actions, badges, or back navigation in frontend modules.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
  auto_invoke: "Implementing sticky headers or refactoring module headers"
---

## When to Use

- Form/detail pages that need save/cancel actions, a back button, metadata, or a status badge.
- Settings pages and create/edit pages where actions should remain visible while scrolling.
- Replacing custom sticky header markup with the shared `app-sticky-header` component.

For standard list modules, use sticky stats plus sticky search from `vendix-frontend-standard-module` instead.

## Source of Truth

- Component: `apps/frontend/src/app/shared/components/sticky-header/sticky-header.component.ts`
- Template: `apps/frontend/src/app/shared/components/sticky-header/sticky-header.component.html`
- README: `apps/frontend/src/app/shared/components/sticky-header/README.md`
- Real pages: product create/edit, general settings, and super-admin subscription gateway pages.

## Critical Rule

Put the sticky header at the root of the page/form container. Do not place it inside a padded parent, because `sticky top-0` sticks relative to the padded container and creates offset/jump issues.

```html
<form [formGroup]="form" (ngSubmit)="onSubmit()" class="min-h-screen">
  <app-sticky-header
    title="General Settings"
    subtitle="Manage store identity"
    icon="settings"
    [actions]="headerActions()"
    (actionClicked)="onHeaderAction($event)"
  />

  <div class="p-4 md:p-6">
    <!-- form content -->
  </div>
</form>
```

## Component API

Inputs:

- `title: string` required.
- `subtitle: string = ''`.
- `icon: string = 'box'`.
- `variant: 'default' | 'glass' = 'glass'`.
- `showBackButton: boolean = false`.
- `backRoute: string | string[] = '/'`.
- `metadataContent: string = ''`.
- `badgePulse: boolean = false`.
- `badgeText: string = ''`.
- `badgeColor: 'green' | 'blue' | 'yellow' | 'gray' | 'red' = 'blue'`.
- `actions: StickyHeaderActionButton[] = []`.

Output:

- `actionClicked: output<string>()`, emitting the action `id`.

`metadataContent` is rendered as plain interpolated text in the current template, not `[innerHTML]`. The current template does not expose an `ng-content` slot.

## Action Buttons

```typescript
readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
  { id: 'cancel', label: 'Cancel', variant: 'outline', icon: 'x' },
  {
    id: 'save',
    label: 'Save Changes',
    variant: 'primary',
    icon: 'save',
    loading: this.saving(),
    disabled: this.form.invalid,
  },
]);

onHeaderAction(actionId: string): void {
  if (actionId === 'cancel') this.onCancel();
  if (actionId === 'save') this.onSubmit();
}
```

`StickyHeaderActionButton` supports `id`, `label`, `variant`, `icon`, `loading`, `disabled`, and `visible`.

## Form Scope

If a header action submits the form, keep the `<form>` around both `app-sticky-header` and the form body. Otherwise, the save action is disconnected from the form lifecycle.

## Rules

- Use `app-sticky-header` before custom markup unless the page has a documented exception.
- Keep page content padding below the header, not on the sticky parent.
- Verify every header icon exists in `icons.registry.ts`.
- Keep action arrays signal/computed-based when they depend on saving/loading/edit mode state.
- Do not use negative margins to compensate for parent padding; move padding to the content area.

## Related Skills

- `vendix-frontend-standard-module` - List-page sticky stats/search pattern
- `vendix-frontend-icons` - Icon registration
- `vendix-angular-forms` - Form binding patterns
- `vendix-zoneless-signals` - Signal/computed state
