---
name: vendix-frontend-stats-cards
description: >
  Responsive stats/KPI card pattern using StatsComponent and the global stats-container.
  Trigger: When implementing stats cards, dashboard metrics, KPI summaries, or sticky
  stats sections in admin modules.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
  auto_invoke: "Implementing stats cards or dashboard metrics with mobile scroll"
---

## When to Use

- Adding stats/KPI cards above admin lists.
- Implementing mobile horizontal scroll plus desktop grid metrics.
- Making stats sticky above a sticky search section.

## Source of Truth

- Component: `apps/frontend/src/app/shared/components/stats/stats.component.ts`
- README: `apps/frontend/src/app/shared/components/stats/README.md`
- Global container CSS: `apps/frontend/src/styles.scss`
- References: products, customers, and store roles modules under `apps/frontend/src/app/private/modules/store/`

## StatsComponent API

`app-stats` uses Angular signal inputs:

| Input | Type | Default |
| --- | --- | --- |
| `title` | `string` | required |
| `value` | `string | number` | `''` |
| `smallText` | `string | undefined` | `undefined` |
| `iconName` | `string` | `'info'` |
| `iconBgColor` | `string` | `'bg-primary/10'` |
| `iconColor` | `string` | `'text-primary'` |
| `clickable` | `boolean` | `false` |
| `loading` | `boolean` | `false` |

There are no outputs. `smallText` is optional in code, but current store modules commonly provide it for context. Prefer including it when the text is meaningful.

## Container Pattern

Use the global `stats-container` class instead of hand-written grid classes.

```html
<div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
  <app-stats
    title="Orders"
    [value]="stats().totalOrders"
    smallText="Orders in the selected period"
    iconName="shopping-cart"
    iconBgColor="bg-blue-100"
    iconColor="text-blue-500"
  />
</div>
```

Real global behavior:

- Desktop default: CSS grid with four columns and `1rem` gap.
- Mobile `<640px`: horizontal flex scroll with fixed-width cards.
- Scrollbars are hidden for the mobile strip.

Do not duplicate the global CSS in components.

## Sticky Stats Rules

- Standard list modules commonly use `sticky top-0 z-20 bg-background` on the stats container.
- Pair sticky stats with sticky search at `top-[99px]` only when the stats strip height matches the current standard layout.
- Use `md:static md:bg-transparent` to restore normal desktop flow.

## Color Guidance

| Meaning | Background | Icon Color | Common Icons |
| --- | --- | --- | --- |
| Total/primary | `bg-blue-100` | `text-blue-500` | `shopping-cart`, `users`, `package` |
| Pending/warning | `bg-amber-100` | `text-amber-500` | `clock`, `alert-circle` |
| Success/active | `bg-emerald-100` | `text-emerald-500` | `check-circle`, `check` |
| Money/revenue | `bg-purple-100` | `text-purple-500` | `dollar-sign`, `credit-card` |
| Critical | `bg-red-100` | `text-red-500` | `x-circle`, `alert-triangle` |
| Neutral | `bg-gray-100` | `text-gray-500` | `info`, `help-circle` |

Always verify icon names against `icons.registry.ts` before using them.

## Signals Example

```typescript
readonly stats = signal({
  totalOrders: 0,
  pendingOrders: 0,
  completedOrders: 0,
  totalRevenue: 0,
});
```

```html
<app-stats
  title="Revenue"
  [value]="formatCurrency(stats().totalRevenue)"
  smallText="Confirmed sales"
  iconName="dollar-sign"
  iconBgColor="bg-purple-100"
  iconColor="text-purple-500"
/>
```

## Anti-Patterns

- Do not use raw `grid grid-cols-*` classes for standard stats sections.
- Do not assume `clickable` is enabled; set `[clickable]="true"` explicitly if needed.
- Do not claim `smallText` is required by the component; it is a usage recommendation, not a type requirement.
- Do not use old super-admin roles as the responsive stats reference; it is an older non-sticky layout.

## Related Skills

- `vendix-frontend-standard-module` - Standard admin list layout
- `vendix-frontend-icons` - Icon registry and `app-icon`
- `vendix-zoneless-signals` - Signal state for stats data
