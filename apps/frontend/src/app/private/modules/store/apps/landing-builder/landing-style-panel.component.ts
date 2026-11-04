import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import type {
  CrmLandingFont,
  CrmLandingTheme,
} from '../../../../../public/dynamic-landing/blocks/landing-blocks.types';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { APP_PAGE_FONTS } from '../templates/app-page.types';

/**
 * Color presets of the landing. Same set the former CRM editor offered
 * (`crm-editor.component.ts`), kept here so the builder does not pull that
 * editor into its bundle.
 */
export const LANDING_COLOR_PRESETS: readonly { name: string; primary: string; secondary: string }[] = [
  { name: 'Azul Tech', primary: '#1E40AF', secondary: '#0EA5E9' },
  { name: 'Esmeralda', primary: '#059669', secondary: '#10B981' },
  { name: 'Púrpura', primary: '#7C3AED', secondary: '#C084FC' },
  { name: 'Naranja', primary: '#EA580C', secondary: '#FB923C' },
  { name: 'Rojo', primary: '#DC2626', secondary: '#F87171' },
  { name: 'Dark Luxury', primary: '#0F172A', secondary: '#334155' },
];

const RADIUS_OPTIONS: readonly { value: NonNullable<CrmLandingTheme['border_radius']>; label: string }[] = [
  { value: 'rounded-lg', label: 'Suaves' },
  { value: 'rounded-2xl', label: 'Redondeadas' },
  { value: 'rounded-full', label: 'Píldora' },
];

const HEX = /^#[0-9a-f]{6}$/i;
const HTTPS = /^https:\/\/\S+$/i;

/**
 * F6-A — "Estilo" of the landing: brand colors, typography, corners, logo and
 * the WhatsApp button. Every change is a patch of `theme`; the page keeps the
 * draft and the preview updates on the spot.
 */
@Component({
  selector: 'app-landing-style-panel',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6" data-testid="landing-style-panel">
      <section>
        <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Colores de marca</h3>
        <div class="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
          @for (p of presets; track p.name) {
            <button type="button" class="rounded-lg border p-2 text-left text-[11px]"
                    [class]="isPreset(p) ? 'border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]' : 'border-[var(--color-border)]'"
                    (click)="patch({ primary_color: p.primary, secondary_color: p.secondary })" [attr.aria-pressed]="isPreset(p)">
              <span class="flex gap-1">
                <span class="h-5 w-5 rounded-full" [style.background]="p.primary"></span>
                <span class="h-5 w-5 rounded-full" [style.background]="p.secondary"></span>
              </span>
              <span class="mt-1 block truncate text-[var(--color-text-secondary)]">{{ p.name }}</span>
            </button>
          }
        </div>
        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          @for (c of colorFields; track c.key) {
            <label class="block">
              <span class="mb-1 block text-xs font-semibold text-[var(--color-text-primary)]">{{ c.label }}</span>
              <span class="flex items-center gap-2">
                <input type="color" class="h-9 w-11 cursor-pointer rounded border border-[var(--color-border)]"
                       [value]="color(c.key, c.fallback)" (input)="setColor(c.key, $any($event.target).value)"
                       [attr.aria-label]="c.label" />
                <input type="text" maxlength="7" class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm uppercase"
                       [value]="color(c.key, c.fallback)" (change)="setHex(c.key, $any($event.target).value, $event)" />
              </span>
            </label>
          }
        </div>
      </section>

      <section>
        <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Tipografía</h3>
        <div class="mt-2 grid gap-3 sm:grid-cols-2">
          @for (f of fontFields; track f.key) {
            <label class="block">
              <span class="mb-1 block text-xs font-semibold text-[var(--color-text-primary)]">{{ f.label }}</span>
              <select class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                      [attr.data-testid]="'landing-' + f.key" (change)="setFont(f.key, $any($event.target).value)">
                <option value="" [selected]="!theme()[f.key]">Como hasta ahora</option>
                @for (o of fonts; track o.value) {
                  <option [value]="o.value" [selected]="theme()[f.key] === o.value">{{ o.label }}</option>
                }
              </select>
            </label>
          }
        </div>
      </section>

      <section>
        <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Esquinas de botones y tarjetas</h3>
        <div class="mt-2 inline-flex rounded-lg border border-[var(--color-border)] p-0.5" role="radiogroup" aria-label="Esquinas">
          @for (r of radii; track r.value) {
            <button type="button" role="radio" class="rounded-md px-3 py-1.5 text-xs font-medium"
                    [attr.aria-checked]="radius() === r.value"
                    [class]="radius() === r.value ? 'bg-[var(--color-primary)] text-[var(--color-text-on-primary,#fff)]' : 'text-[var(--color-text-secondary)]'"
                    (click)="patch({ border_radius: r.value })">{{ r.label }}</button>
          }
        </div>
      </section>

      <section>
        <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Logo de la landing</h3>
        <p class="mt-1 text-xs text-[var(--color-text-secondary)]">Vacío: se usa el logo de tu tienda.</p>
        <div class="mt-2 flex items-center gap-3">
          <span class="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-background)]">
            @if (logoValid()) {
              <img [src]="theme().logo_url" alt="" class="h-full w-full object-contain" />
            } @else {
              <app-icon name="image" [size]="18" class="text-[var(--color-text-secondary)]" />
            }
          </span>
          <label class="block flex-1">
            <input type="url" placeholder="https://…/logo.png" data-testid="landing-logo-url"
                   class="w-full rounded-lg border bg-[var(--color-surface)] px-3 py-2 text-sm"
                   [class]="logoError() ? 'border-[var(--color-error,#dc2626)]' : 'border-[var(--color-border)]'"
                   [value]="theme().logo_url ?? ''" (input)="setOptional('logo_url', $any($event.target).value)" />
            @if (logoError()) {
              <span class="mt-1 block text-[11px] text-[var(--color-error,#dc2626)]">Usa un enlace que empiece por https://</span>
            }
          </label>
        </div>
      </section>

      <section>
        <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">WhatsApp</h3>
        <div class="mt-2 grid gap-3 sm:grid-cols-2">
          <label class="block">
            <span class="mb-1 block text-xs font-semibold text-[var(--color-text-primary)]">Número</span>
            <input type="tel" maxlength="20" placeholder="+57 300 123 4567"
                   class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                   [value]="theme().whatsapp_number ?? ''" (input)="setOptional('whatsapp_number', $any($event.target).value)" />
          </label>
          <label class="block">
            <span class="mb-1 block text-xs font-semibold text-[var(--color-text-primary)]">Mensaje inicial</span>
            <input type="text" maxlength="200" placeholder="Hola, quiero más información"
                   class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                   [value]="theme().whatsapp_message ?? ''" (input)="setOptional('whatsapp_message', $any($event.target).value)" />
          </label>
        </div>
        <label class="mt-3 flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
          <input type="checkbox" [checked]="theme().enable_whatsapp_float !== false" [disabled]="!theme().whatsapp_number"
                 (change)="patch({ enable_whatsapp_float: $any($event.target).checked })" />
          Botón flotante de WhatsApp
          @if (!theme().whatsapp_number) {
            <span class="text-xs text-[var(--color-text-secondary)]">(agrega un número primero)</span>
          }
        </label>
      </section>
    </div>
  `,
})
export class LandingStylePanelComponent {
  readonly theme = input.required<CrmLandingTheme>();
  readonly themeChange = output<Partial<CrmLandingTheme>>();

  readonly presets = LANDING_COLOR_PRESETS;
  readonly fonts = APP_PAGE_FONTS;
  readonly radii = RADIUS_OPTIONS;
  readonly colorFields = [
    { key: 'primary_color', label: 'Color principal', fallback: '#1E40AF' },
    { key: 'secondary_color', label: 'Color secundario', fallback: '#0F172A' },
  ] as const;
  readonly fontFields = [
    { key: 'font_heading', label: 'Títulos' },
    { key: 'font_body', label: 'Textos' },
  ] as const;

  readonly radius = computed(() => this.theme().border_radius ?? 'rounded-2xl');
  readonly logoValid = computed(() => HTTPS.test(this.theme().logo_url ?? ''));
  readonly logoError = computed(() => !!this.theme().logo_url && !this.logoValid());

  color(key: 'primary_color' | 'secondary_color', fallback: string): string {
    const value = this.theme()[key];
    return value && HEX.test(value) ? value.toUpperCase() : fallback;
  }

  isPreset(p: { primary: string; secondary: string }): boolean {
    const t = this.theme();
    return t.primary_color?.toUpperCase() === p.primary && t.secondary_color?.toUpperCase() === p.secondary;
  }

  patch(change: Partial<CrmLandingTheme>): void {
    this.themeChange.emit(change);
  }

  setColor(key: 'primary_color' | 'secondary_color', value: string): void {
    this.patch({ [key]: value.toUpperCase() });
  }

  /** A typed hex applies only when valid; otherwise the field shows the current color again. */
  setHex(key: 'primary_color' | 'secondary_color', raw: string, event: Event): void {
    const value = raw.trim().startsWith('#') ? raw.trim() : `#${raw.trim()}`;
    if (HEX.test(value)) this.setColor(key, value);
    else (event.target as HTMLInputElement).value = this.color(key, this.colorFields.find((c) => c.key === key)!.fallback);
  }

  setFont(key: 'font_heading' | 'font_body', value: string): void {
    this.patch({ [key]: (value || undefined) as CrmLandingFont | undefined });
  }

  /** Empty text removes the key, so the document stays as it was before the field existed. */
  setOptional(key: 'logo_url' | 'whatsapp_number' | 'whatsapp_message', value: string): void {
    this.patch({ [key]: value.trim() ? value : undefined });
  }
}
