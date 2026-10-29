# Vendix Soft UI — design language

The base visual language for every new Vendix screen and shared component. It is distilled from the
POS (`/admin/pos`), whose small controls set the target look: soft, clean, tinted, symmetric.
Existing screens migrate to it over time; new UI starts here.

## 1. Non-negotiables

1. **Tokens only, never hardcoded CSS.** No hex, `rgb()/rgba()`, raw `px`, or Tailwind arbitrary
   values (`text-[11px]`, `rounded-[10px]`, `shadow-[…]`, `bg-[#…]`). Use Tailwind classes from
   `apps/frontend/tailwind.config.js` or `var(--…)` from `apps/frontend/src/styles.scss`. If the value
   you need has no token, add the token (and say so in the change), never inline it.
2. **Multibrand.** Every store brings its own primary color (`ThemeService.applyBranding`). Brand
   accents use `primary` with an alpha step (`bg-primary/10`) — never a fixed hue (`green-*`,
   `emerald-*`) and never the default green as a literal. Assume any brand color: light, dark,
   saturated or muted.
3. **Modes and presets.** Light/dark mode and presets (`default | aura | monocromo | glass`) work only
   through tokens: no `#fff`/`bg-white` for surfaces (use `bg-surface`), no `dark:` utilities.
4. **Calm by default.** Tint, don't fill. Solid color is for the one primary action of a screen and
   for hover on tiny add buttons — not for everything that is "important".

## 2. Token scales (the only allowed values)

### Radius

| Use | Tailwind | SCSS |
| --- | --- | --- |
| Icon buttons 24–28px | `rounded-md` (10px) | *no token yet — add one before using in SCSS* |
| Controls: buttons, inputs, dropdown triggers, pills with text, chips | `rounded-xl` (12px) | `var(--radius-lg)` (12px) |
| Cards, panels, modals | `rounded-2xl` (16px) | `var(--radius-xl)` (16px) |
| Status pills, dots, avatars | `rounded-full` | `9999px` via `rounded-pill` |

Do not use `rounded-lg` (overridden to 14px, off-scale), `rounded` (4px) or `rounded-sm` (6px) on
new controls. Beware the name clash: Tailwind `rounded-md` = 10px but `--radius-md` = 8px, and
`rounded-lg` = 14px but `--radius-lg` = 12px.

### Alpha steps for tints (one meaning each)

| Step | Meaning |
| --- | --- |
| `/5` | resting background of a very quiet tinted control (inline edit, ghost) |
| `/10` | resting background of a tinted control or badge |
| `/15` | hover background of a tinted control |
| `/20` | strong hover / "active" tinted state; focus ring |
| `/25` | border of a tinted control |
| `/60` | disabled-looking or de-emphasized foreground (prefer `opacity-50` for disabled) |

Stick to these six. The POS drifts (5/8/10, 20/24/25/30, 14/15/20); do not copy the drift.

### Height (symmetry grid)

| Height | Tailwind | Use |
| --- | --- | --- |
| 24 / 28px | `h-6 w-6` / `sm:h-7 sm:w-7` | icon-only buttons inside rows and cards |
| 32px | `h-8` / `min-h-8` | pills, compact header buttons (Nota, Vaciar) |
| 40px mobile / 44px desktop | `h-10 sm:h-11` | toolbar controls, inputs, primary and secondary buttons |

Controls that sit in the same row share one height. Touch-first screens (POS, mobile) keep tappable
areas ≥40px; a 24px icon button gets its hit area from row padding, not from a bigger icon.

### Type, icons, weight

- Text: `text-xs` (12px) for labels in pills/compact buttons; `text-sm` (14px) for control text;
  bigger sizes only for headings, totals and KPIs. There is no 11px or 13px token: don't invent one
  inline.
- Weight: `font-semibold` (`--fw-semibold`) for control labels; `font-bold` only for numbers, totals
  and headings; `font-medium` for neutral dropdown triggers.
- Icons (`app-icon`, Lucide): 12–14 in 24–32px controls, 16 in 40–44px controls, 18–20 in headers.

### Elevation and motion

- No shadow at rest on controls. Cards: no shadow at rest, `shadow-sm` on hover. Floating layers
  (dropdowns, popovers): `shadow-md`. Modals: `shadow-lg`. Only the config shadows (`xs sm md lg`).
  **`shadow-2xs` does not exist in our Tailwind v3** — it compiles to nothing.
- Transitions: `transition-colors` (or `transition` for transform) with the default duration
  (160ms, configured). No custom durations.
- Press feedback: `active:scale-95` (a scale token; arbitrary `active:scale-[0.97]` is not
  allowed). Wrap looping or large motion in `motion-safe:`.

## 3. Recipes

Copy these class sets; adjust only height and spacing within the scales above.

### Tinted (brand) button — secondary actions with brand presence
`Ítem libre`, `+ Cliente` (mobile), add-to-cart.

```html
<button class="h-10 sm:h-11 px-3.5 inline-flex items-center justify-center gap-1.5 rounded-xl
               border border-primary/25 bg-primary/10 text-primary text-xs font-semibold
               hover:bg-primary/15 active:scale-95 transition
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20
               disabled:opacity-50 disabled:cursor-not-allowed">
```

Outline variant (lighter, for toolbars): `bg-surface border-primary/25 hover:bg-primary/10`.

### Neutral button / dropdown trigger
`Filtros`, cart `Cliente`.

```html
<button class="h-10 sm:h-11 px-3 inline-flex items-center gap-2 rounded-xl
               border border-border bg-surface text-text-primary text-sm font-medium
               hover:border-text-secondary hover:bg-text-secondary/10 active:scale-95 transition
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
```

### Destructive button
`Vaciar`, delete. Use the `error` token, not `rose-*`/`red-*` (fixed palettes ignore dark mode).

```html
<button class="h-8 px-2.5 inline-flex items-center gap-1 rounded-xl
               border border-error/25 bg-error/10 text-error text-xs font-semibold
               hover:bg-error/15 transition-colors">
```

### Compact header button
`Nota`: same as destructive with neutral tokens; switches to the tinted brand recipe when it holds
a value (e.g. a note exists) — state shown by tint, not by a new shape.

### Icon-only button (in rows and cards)
`+` on product cards, trash/edit on cart lines.

```html
<button aria-label="…" class="h-6 w-6 sm:h-7 sm:w-7 inline-flex items-center justify-center
               rounded-md border border-primary/25 bg-primary/10 text-primary
               hover:bg-primary hover:text-surface transition-colors">
  <app-icon name="plus" [size]="14" />
</button>
```

Destructive variant: swap `primary` for `error` and keep the hover tinted (`hover:bg-error/15`),
never solid red. Sibling icon buttons share radius and size.

### Pill (status / toggle)
`Turno Activo`.

```html
<button class="min-h-8 px-3 inline-flex items-center gap-1.5 rounded-full
               border border-primary/25 bg-primary/10 text-primary text-xs font-semibold
               hover:bg-primary/15 active:scale-95 transition">
  <span class="h-1.5 w-1.5 rounded-full bg-success motion-safe:animate-pulse"></span>
```

### Info pill (read-only context)
`Caja · hora` in the session strip: `min-h-9 px-2 py-1.5 rounded-xl border border-border bg-surface
shadow-xs`, name `text-xs font-bold text-text-primary`, meta `text-xs text-text-secondary`.

### Card (selectable item)
POS product card.

```html
<div class="rounded-2xl border border-border bg-surface overflow-hidden transition
            hover:border-primary hover:shadow-sm active:scale-95
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
            focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
```

- Selected: `border-primary ring-2 ring-primary ring-offset-2 ring-offset-surface`.
- Already added / secondary selection: `border-primary ring-1 ring-primary/25`.
- Unavailable: `opacity-60`, image `grayscale`.

### Badges
Use `<app-badge>` (`shared/components/badge`) with semantic variants (success / warning / error /
info) — never hand-built badges. Stock: "N disponibles" success, "Últimas N" / "Sobreventa" warning,
"Agotado" error.

## 4. Composition rules

- One solid primary action per view (e.g. `Cobrar`). Everything else is tinted, neutral or ghost.
- Same row ⇒ same height, same radius. Icon-only siblings share size and radius.
- Meaning by color is always backed by text or icon (accessibility).
- Text on a tint uses the matching token (`text-primary` on `bg-primary/10`, `text-error` on
  `bg-error/10`). Known gap: there is no contrast-safe "on-tint" token for very light brand colors;
  don't patch it per component — raise it as a token change.
- `info` is mapped without alpha in Tailwind (`bg-info/10` emits nothing); use `bg-info-light` until
  the token gains an RGB channel.

## 5. Do not copy (known drift in the POS)

| Drift | Use instead |
| --- | --- |
| `shadow-2xs` (no CSS emitted) | no shadow, or `shadow-xs` |
| `rounded-lg` on Nota/Vaciar (14px) | `rounded-xl` |
| `rounded` on the cart-line edit button (4px) | `rounded-md` like its trash sibling |
| `rose-*` for destructive | `error` token |
| `#ffffff` in cart `.cart-btn` | `var(--color-surface)` / `bg-surface` |
| 11px / 13px labels | `text-xs` |
| 38px mobile footer buttons | `h-10` |
| `.15s` / `.2s` custom transitions | default `transition` (160ms) |

## 6. Reference implementations

- `apps/frontend/src/app/private/modules/store/pos/components/pos-product-selection.component.ts`
  — Ítem libre, product card, card add button, Filtros override.
- `apps/frontend/src/app/private/modules/store/pos/cart/pos-cart.component.ts` — cart buttons
  (Cliente, Nota, Vaciar, line icon buttons).
- `apps/frontend/src/app/private/modules/store/pos/components/pos-header-dropdown.component.ts`
  — Turno Activo pill.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-session-status-bar.component.ts`
  — info pill.
- `apps/frontend/src/app/private/modules/store/pos/components/pos-mobile-footer.component.ts`
  — mobile `+ Cliente`.
- `apps/frontend/src/app/shared/components/options-dropdown/` — neutral dropdown trigger.

Copy the look from them, but apply the canonical tokens above (section 5 lists where they differ).
