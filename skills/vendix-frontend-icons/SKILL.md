---
name: vendix-frontend-icons
description: >
  Protocol for using and registering Lucide icons in the Vendix frontend. Trigger: When
  adding icons to components, buttons, menus, stats, tables, cards, or using app-icon.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
  auto_invoke: "When adding icons to components, buttons, menus, or using <app-icon>"
---

## When to Use

- Adding `app-icon` to a template.
- Adding `iconName`, action `icon`, `avatarFallbackIcon`, detail `icon`, or menu/sidebar icons.
- Registering a missing Lucide icon.

## Source of Truth

- Component: `apps/frontend/src/app/shared/components/icon/icon.component.ts`
- Registry: `apps/frontend/src/app/shared/components/icon/icons.registry.ts`
- README: `apps/frontend/src/app/shared/components/icon/README.md`

## Critical Rules

- Never assume a Lucide icon is available globally.
- Check `icons.registry.ts` before using an icon key.
- If missing, import the Lucide symbol and add it to `ICON_REGISTRY`.
- Use the exact registered key. Aliases exist, but only the registry is authoritative.
- For Tailwind color classes, pass classes through `class`, not `color`. The `color` input is forwarded to Lucide as a color value.

## app-icon API

`IconComponent` inputs:

- `name: IconName` required.
- `size: number | string = 16`.
- `color?: string`.
- `class` alias stored as `cls`.
- `spin: boolean = false`.

If a name is not found, the component falls back to the registry `default` icon, currently `HelpCircle`. A fallback prevents crashes but still means the icon key is wrong.

```html
<app-icon name="package" [size]="20" class="text-blue-500" />
<app-icon name="loader-2" [size]="18" class="text-primary" [spin]="true" />
```

## Registering an Icon

```typescript
import {
  Fingerprint,
  // existing imports
} from 'lucide-angular';

export const ICON_REGISTRY = {
  // existing icons
  fingerprint: Fingerprint,
} as const;
```

Use a stable key that matches existing naming style. Kebab aliases such as `trash-2` and simple aliases such as `trash` may both exist; do not add duplicates unless there is a clear compatibility/use reason.

## Common Consumers

- `app-stats`: `iconName="shopping-cart"`.
- `TableAction`: `{ icon: 'trash-2', ... }`.
- `ItemListCardConfig`: `avatarFallbackIcon`, detail field `icon`, and info icons.
- `app-sticky-header`: `icon="settings"` and action `icon` values.
- Sidebar/menu config: `icon` keys.

## Checklist

- Check `icons.registry.ts` for the key.
- Register missing icons in the registry source file.
- Use `class="text-*"` for Tailwind color.
- Use `[spin]="true"` only for loading/spinner icons.
- Keep icon additions minimal to preserve bundle optimization.

## Related Skills

- `vendix-frontend-standard-module` - Icons in admin list modules
- `vendix-frontend-data-display` - Action/card icons
- `vendix-panel-ui` - Sidebar/menu icons
