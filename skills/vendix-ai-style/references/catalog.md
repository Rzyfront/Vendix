# Vendix AI Style — tokens, classes and examples

Source: `apps/frontend/src/styles/vendix-ai-style.scss`.

## Tokens (`:root`, dark overrides in `[data-theme='dark']`)

| Token | Use |
| --- | --- |
| `--vx-ai-c1` | Gradient start: primary darkened (white text readable) |
| `--vx-ai-c2` | Gradient middle: info darkened |
| `--vx-ai-c3` | Third hue (success) for halos/borders only, never under text |
| `--vx-ai-accent` / `--vx-ai-accent-2` | Pure primary / info for glows, rings, scans, sparkles |
| `--vx-ai-on` | Text on AI gradients (`#fff`) |
| `--vx-ai-gradient` | Button/badge fill (200 % wide; shifts on hover) |
| `--vx-ai-gradient-text` | Gradient for `vx-ai-text` (lighter stops in dark) |
| `--vx-ai-gradient-border` | Animated border gradient |
| `--vx-ai-surface-bg` / `--vx-ai-surface-border` | Radial tint + border of AI sections |
| `--vx-ai-glow` / `--vx-ai-glow-strong` | Resting / hover glow |
| `--vx-ai-shimmer` / `--vx-ai-shimmer-tint` | White sweep (over gradients/images) / tinted sweep (over surfaces) |
| `--vx-ai-duration-fast` / `--vx-ai-duration` / `--vx-ai-duration-slow` | 1.6 s / 2.4 s / 6 s |
| `--vx-ai-border-width` | Animated border thickness (1.5 px) |
| `--vx-ai-scan-distance` | Vertical scanner travel (300 px stage, 280 px result stage) |
| `--vx-ai-halo-size` | Conic halo diameter (280 px) |

All tokens derive from `--color-primary`, `--color-info`, `--color-success`, so
they follow tenant branding and dark mode. Override a token locally (e.g.
`style="--vx-ai-halo-size: 320px"`) instead of copying a rule.

## Classes

| Class | What it does |
| --- | --- |
| `vx-ai-surface` | AI section/card: radial primary+info tint over `--color-surface`, tinted border |
| `vx-ai-button` | AI CTA: gradient + glow; hover shifts gradient, grows glow, shimmer sweep; focus ring; no glow when disabled |
| `vx-ai-badge` / `vx-ai-badge--soft` | Solid gradient "IA" pill / soft tinted pill |
| `vx-ai-border` | Animated gradient border via mask (element needs its own radius) |
| `vx-ai-text` | Gradient text (falls back to `--vx-ai-c1`) |
| `vx-ai-shimmer` | Wrapper with tinted shimmer overlay for loading content |
| `vx-ai-skeleton-line` | 10 px rounded skeleton line (width via Tailwind) |
| `vx-ai-icon` | 72 px glowing icon disc that breathes |
| `vx-ai-soft-pulse` | Soft pulse + drop-shadow glow for "thinking" icons |
| `vx-ai-dot-pulse` | 6 px pulsing dot ("writing…") |
| `vx-ai-orbit` (+ `__core`, `__ring`, `__ring--delayed`) | Compact orbit loader |
| `vx-ai-holo-grid` / `vx-ai-holo-aurora` | Holographic background layers |
| `vx-ai-sparkle` (+ `--a` … `--e`) | Five twinkling sparkles at fixed positions |
| `vx-ai-stage` `.is-analyzing` (+ `__icon`, `__caption`, `__halo`, `__scan`, `__shimmer`) | Full "AI is analyzing" scene (scanners) |
| `vx-ai-result-stage` `.is-generating` / `.is-error` (+ `__placeholder`, `__idle`, `__error-state`, `__icon`, `__error-icon`, `__caption`, `__error-title`, `__error-text`, `__halo`, `__scan`, `__shimmer`, `__prism`) | Canvas where a generated result appears |

## Examples

```html
<!-- AI section -->
<section class="vx-ai-surface rounded-2xl p-4">
  <span class="vx-ai-badge">IA</span>
  <h3 class="text-base font-semibold">Factur<span class="vx-ai-text">IA</span></h3>
</section>

<!-- AI CTA (preferred over a raw <button>) -->
<app-button variant="ai" (clicked)="scan()">
  <app-icon name="sparkles" [size]="16" slot="icon"></app-icon>
  Escanear con IA
</app-button>

<!-- Analyzing scene -->
<div class="vx-ai-stage is-analyzing relative overflow-hidden rounded-2xl border border-border min-h-[320px] flex flex-col items-center justify-center gap-4 p-6">
  <div class="vx-ai-holo-aurora"></div>
  <div class="vx-ai-holo-grid"></div>
  <div class="vx-ai-stage__halo"></div>
  <div class="vx-ai-stage__scan"></div>
  <div class="vx-ai-stage__shimmer"></div>
  <span class="vx-ai-sparkle vx-ai-sparkle--a"></span>
  <!-- … --b, --c, --d, --e -->
  <div class="vx-ai-stage__icon"><app-icon name="sparkles" [size]="32"></app-icon></div>
  <p class="vx-ai-stage__caption text-sm">Analizando con IA…</p>
</div>

<!-- Pending text -->
<div class="space-y-2">
  <div class="vx-ai-skeleton-line w-2/3"></div>
  <div class="vx-ai-skeleton-line w-full"></div>
</div>
```
