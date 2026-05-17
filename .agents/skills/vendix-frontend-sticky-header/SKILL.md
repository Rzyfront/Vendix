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

- Form/detail pages that need save/cancel actions, a back button, metadata, a status badge, or page-level tabs.
- Settings pages and create/edit pages where actions should remain visible while scrolling.
- Replacing custom sticky header markup with the shared `app-sticky-header` component.
- Replacing hardcoded module headers with compact route/state tabs.

For standard list modules, use sticky stats plus sticky search from `vendix-frontend-standard-module` instead.

## Source of Truth

- Component: `apps/frontend/src/app/shared/components/sticky-header/sticky-header.component.ts`
- Template: `apps/frontend/src/app/shared/components/sticky-header/sticky-header.component.html`
- README: `apps/frontend/src/app/shared/components/sticky-header/README.md`
- Real pages: product create/edit, general settings, super-admin monitoring, super-admin plan form, analytics shell, and super-admin subscription gateway pages.

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
- `tabs: StickyHeaderTab[] = []`.
- `activeTab: string = ''`.
- `tabsAriaLabel: string = 'Secciones'`.

Outputs:

- `actionClicked: output<string>()`, emitting the action `id`.
- `tabChanged: output<string>()`, emitting the tab `id`.

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

## Tabs

Use header tabs for page-level module views. Tabs can be local state tabs or route tabs:
The component renders tabs as a compact top row above the title/action row.

```typescript
readonly activeTab = signal('overview');

readonly tabs: StickyHeaderTab[] = [
  { id: 'overview', label: 'Resumen', icon: 'file-text' },
  { id: 'pricing', label: 'Precios', icon: 'credit-card' },
];
```

```html
<app-sticky-header
  title="Nuevo plan"
  subtitle="Crea un plan de suscripción"
  icon="credit-card"
  [tabs]="tabs"
  [activeTab]="activeTab()"
  (tabChanged)="activeTab.set($event)"
/>
```

Route tabs use `route` and rely on `RouterLinkActive`:

```typescript
readonly tabs: StickyHeaderTab[] = [
  { id: 'overview', route: 'overview', label: 'Overview', icon: 'layout-dashboard' },
  { id: 'health', route: 'health', label: 'Salud', icon: 'heart-pulse' },
];
```

`StickyHeaderTab` supports `id`, `label`, `shortLabel`, `icon`, `route`, `exact`, `disabled`, and `visible`.

## Form Scope

If a header action submits the form, keep the `<form>` around both `app-sticky-header` and the form body. Otherwise, the save action is disconnected from the form lifecycle.

## Rules

- Use `app-sticky-header` before custom markup unless the page has a documented exception.
- Put page-level tabs in `app-sticky-header` before creating custom tab bars or sibling `app-scrollable-tabs`.
- Keep page content padding below the header, not on the sticky parent.
- Verify every header icon exists in `icons.registry.ts`.
- Keep action arrays signal/computed-based when they depend on saving/loading/edit mode state.
- Keep state-tab arrays typed as `StickyHeaderTab[]` and update a signal from `(tabChanged)`.
- Use route tabs for sibling child routes and state tabs for in-page view switching.
- Do not use negative margins to compensate for parent padding; move padding to the content area.

## Related Skills

- `vendix-frontend-standard-module` - List-page sticky stats/search pattern
- `vendix-frontend-icons` - Icon registration
- `vendix-angular-forms` - Form binding patterns
- `vendix-zoneless-signals` - Signal/computed state
