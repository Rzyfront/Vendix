import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { borderContrast, contrastChecks } from '../../../../../public/app-page/app-page-theme';
import { whatsappHref } from '../../../../../public/app-page/app-page-view.util';
import {
  APP_PAGE_FONTS,
  APP_PAGE_VARIANTS,
  APP_THEME_BORDER_COLOR,
  APP_THEME_COLORS,
  APP_THEME_EXTENDED_OPTIONS,
  APP_THEME_MAX_IMAGE_OVERLAY,
  APP_THEME_OPTION_GROUPS,
  APP_THEME_OPTIONS,
  APP_THEME_PALETTES,
  AppPageBrand,
  AppPageTheme,
  AppThemeColorKey,
  AppThemeOptionGroup,
  PageAppKind,
} from '../templates';

const HEX = /^#[0-9a-f]{6}$/i;
const HTTPS = /^https:\/\/\S+$/i;

/** Brand keys the style panel edits. */
export type AppPageStyleBrandKey = 'logo_url' | 'cover_url' | 'whatsapp_number' | 'whatsapp_message' | 'whatsapp_floating';

/**
 * F6-B — "Estilo" of the app pages (store home, product page, service page,
 * booking): the closed style tokens of `page.theme` (colors, fonts, corners,
 * spacing, buttons, images, width) with their readability check, plus the
 * logo, the cover background and the WhatsApp button of `page.brand`.
 *
 * It owns no data: every change is a patch the view applies to the draft.
 * An empty value removes its key, so an untouched page keeps today's look.
 *
 * Apps F7: grouped in «Colores», «Tipografía», «Espaciado y tarjetas» and
 * «Imágenes y portada», with quick palettes, the border color and the
 * extended tokens (chips and the image veil slider). The Tienda en línea
 * (`store_home`) keeps only the F3 tokens.
 */
@Component({
  selector: 'app-app-page-style-panel',
  standalone: true,
  imports: [IconComponent, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6" data-testid="app-page-style-panel">
      <section>
        <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Estilos rápidos</h3>
        <p class="mt-1 text-xs text-[var(--color-text-secondary)]">Solo cambian el aspecto; tus secciones y textos se quedan igual.</p>
        <div class="mt-3 flex flex-wrap gap-2">
          @for (preset of presets(); track preset.id) {
            <button type="button" (click)="themeChange.emit(preset.theme)" [attr.data-testid]="'style-preset-' + preset.id"
                    class="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-background)]">
              <span class="h-3 w-3 rounded-full" [style.background-color]="preset.theme.primary_color" aria-hidden="true"></span>
              {{ preset.name }}
            </button>
          }
          @if (hasTheme()) {
            <button type="button" (click)="themeChange.emit({})" data-testid="style-clear"
                    class="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-background)]">
              <app-icon name="rotate-ccw" [size]="14" /> Quitar estilo
            </button>
          }
        </div>
        @if (!hasTheme()) {
          <p class="mt-2 text-xs text-[var(--color-text-secondary)]" data-testid="style-none">Sin estilo propio: la página se ve como hoy.</p>
        }
      </section>

      <section data-testid="style-group-colors">
        <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Colores</h3>
        @if (extended()) {
          <p class="mt-1 text-xs text-[var(--color-text-secondary)]">Paletas rápidas: cambian los cinco colores de una vez.</p>
          <div class="mt-2 flex flex-wrap gap-2">
            @for (palette of palettes; track palette.id) {
              <button type="button" (click)="applyPalette(palette.colors)" [attr.data-testid]="'style-palette-' + palette.id"
                      class="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-background)]">
                <span class="flex" aria-hidden="true">
                  <span class="h-3 w-3 rounded-full" [style.background-color]="palette.colors.primary_color"></span>
                  <span class="-ml-1 h-3 w-3 rounded-full" [style.background-color]="palette.colors.secondary_color"></span>
                  <span class="-ml-1 h-3 w-3 rounded-full border border-[var(--color-border)]" [style.background-color]="palette.colors.surface_color"></span>
                </span>
                {{ palette.name }}
              </button>
            }
          </div>
        }
        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          @for (color of colorFields(); track color.key) {
            <div>
              <span class="block text-xs font-medium text-[var(--color-text-primary)]">{{ color.label }}</span>
              <span class="block text-[11px] text-[var(--color-text-secondary)]">{{ color.hint }}</span>
              <div class="mt-1 flex items-center gap-2">
                <input type="color" class="h-9 w-11 cursor-pointer rounded border border-[var(--color-border)] bg-transparent p-0.5"
                       [value]="colorValue(color.key) || '#000000'" (input)="setColor(color.key, $any($event.target).value)"
                       [attr.aria-label]="'Color ' + color.label" />
                <input type="text" maxlength="7" placeholder="Como hoy" [attr.data-testid]="'style-' + color.key"
                       class="w-full rounded-lg border bg-[var(--color-surface)] px-3 py-2 text-sm"
                       [class]="colorError(color.key) ? 'border-[var(--color-error,#dc2626)]' : 'border-[var(--color-border)]'"
                       [value]="colorValue(color.key)" (input)="setColor(color.key, $any($event.target).value)" />
              </div>
            </div>
          }
        </div>
        @if (borderCheck(); as border) {
          @if (!border.ok) {
            <p class="mt-2 text-xs text-[var(--color-error)]" data-testid="style-border-warning">
              El color de los bordes casi no se distingue del fondo ({{ border.ratio }}:1); las tarjetas pueden perder su contorno.
            </p>
          }
        }
      </section>

      <section data-testid="style-group-typography">
        <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Tipografía</h3>
        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-[var(--color-text-primary)]">Títulos</span>
            <select class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                    data-testid="style-heading_font" (change)="setToken('heading_font', $any($event.target).value)">
              <option value="" [selected]="!theme().heading_font">Como hoy</option>
              @for (font of fonts; track font.value) {
                <option [value]="font.value" [selected]="theme().heading_font === font.value">{{ font.label }}</option>
              }
            </select>
          </label>
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-[var(--color-text-primary)]">Texto</span>
            <select class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                    data-testid="style-body_font" (change)="setToken('body_font', $any($event.target).value)">
              <option value="" [selected]="!theme().body_font">Como hoy</option>
              @for (font of fonts; track font.value) {
                <option [value]="font.value" [selected]="theme().body_font === font.value">{{ font.label }}</option>
              }
            </select>
          </label>
        </div>
        <ng-container *ngTemplateOutlet="groupOptions; context: { group: 'typography' }" />
      </section>

      <section data-testid="style-group-spacing">
        <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Espaciado y tarjetas</h3>
        <ng-container *ngTemplateOutlet="groupOptions; context: { group: 'spacing' }" />
      </section>

      <section data-testid="style-group-images">
        <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Imágenes y portada</h3>
        <ng-container *ngTemplateOutlet="groupOptions; context: { group: 'images' }" />
        @if (extended()) {
          <div class="mt-3">
            <div class="flex items-center justify-between gap-2">
              <label for="style-image-overlay" class="text-xs font-medium text-[var(--color-text-primary)]">Velo sobre las imágenes</label>
              <span class="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                <span data-testid="style-image_overlay-value">{{ theme().image_overlay === undefined ? 'Como hoy' : theme().image_overlay + ' %' }}</span>
                @if (theme().image_overlay !== undefined) {
                  <button type="button" class="font-semibold text-[var(--color-text-primary)] underline" data-testid="style-image_overlay-clear"
                          (click)="setOverlay('')">Quitar</button>
                }
              </span>
            </div>
            <input id="style-image-overlay" type="range" min="0" [max]="maxOverlay" step="5" class="mt-1 w-full accent-[var(--color-primary)]"
                   data-testid="style-image_overlay" [value]="theme().image_overlay ?? 0"
                   (input)="setOverlay($any($event.target).value)" />
            <span class="block text-[11px] text-[var(--color-text-secondary)]">Oscurece la portada y la galería para que el texto se lea mejor.</span>
          </div>
        }
      </section>

      <ng-template #groupOptions let-group="group">
        @if (selectOptions(group).length) {
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            @for (option of selectOptions(group); track option.key) {
              <label class="block">
                <span class="mb-1 block text-xs font-medium text-[var(--color-text-primary)]">{{ option.label }}</span>
                <select class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                        [attr.data-testid]="'style-' + option.key" (change)="setToken(option.key, $any($event.target).value)">
                  <option value="" [selected]="!tokenValue(option.key)">Como hoy</option>
                  @for (choice of option.values; track choice.value) {
                    <option [value]="choice.value" [selected]="tokenValue(option.key) === choice.value">{{ choice.label }}</option>
                  }
                </select>
              </label>
            }
          </div>
        }
        @for (option of chipOptions(group); track option.key) {
          <div class="mt-3" role="group" [attr.aria-label]="option.label" [attr.data-testid]="'style-' + option.key">
            <span class="mb-1 block text-xs font-medium text-[var(--color-text-primary)]">{{ option.label }}</span>
            <div class="flex flex-wrap gap-1.5">
              <button type="button" [class]="chipClass(!tokenValue(option.key))" [attr.aria-pressed]="!tokenValue(option.key)"
                      [attr.data-testid]="'style-' + option.key + '-default'" (click)="setToken(option.key, '')">Como hoy</button>
              @for (choice of option.values; track choice.value) {
                <button type="button" [class]="chipClass(tokenValue(option.key) === choice.value)"
                        [attr.aria-pressed]="tokenValue(option.key) === choice.value"
                        [attr.data-testid]="'style-' + option.key + '-' + choice.value"
                        (click)="setToken(option.key, choice.value)">{{ choice.label }}</button>
              }
            </div>
          </div>
        }
      </ng-template>

      @if (contrast().length) {
        <section data-testid="style-contrast">
          <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Legibilidad</h3>
          <ul class="mt-2 space-y-1 text-xs">
            @for (check of contrast(); track check.id) {
              <li class="flex items-center justify-between gap-2" [attr.data-contrast]="check.id" [attr.data-ok]="check.ok">
                <span class="text-[var(--color-text-primary)]">{{ check.label }}</span>
                <span [class]="check.ok ? 'text-[var(--color-success)]' : 'font-semibold text-[var(--color-error)]'">
                  {{ check.ratio }}:1 {{ check.ok ? '· Bien' : '· Poco contraste' }}
                </span>
              </li>
            }
          </ul>
          @if (lowContrast()) {
            <p class="mt-2 text-xs text-[var(--color-error)]" data-testid="style-contrast-warning">
              Algunos textos pueden leerse mal. Recomendamos al menos 4.5:1.
            </p>
          }
        </section>
      }

      <section>
        <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Logo e imagen de portada</h3>
        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-[var(--color-text-primary)]">Logo</span>
            <div class="flex items-center gap-2">
              <input type="url" placeholder="https://…/logo.png" data-testid="style-logo"
                     class="w-full rounded-lg border bg-[var(--color-surface)] px-3 py-2 text-sm"
                     [class]="urlError(brand().logo_url) ? 'border-[var(--color-error,#dc2626)]' : 'border-[var(--color-border)]'"
                     [value]="brand().logo_url ?? ''" (input)="setBrand('logo_url', $any($event.target).value)" />
              <button type="button" class="whitespace-nowrap rounded-lg border border-[var(--color-border)] px-2.5 py-2 text-xs font-semibold text-[var(--color-text-primary)]"
                      data-testid="style-logo-gallery" (click)="mediaRequested.emit('logo_url')">
                Galería
              </button>
            </div>
            <span class="mt-1 block text-[11px]" [class]="urlError(brand().logo_url) ? 'text-[var(--color-error,#dc2626)]' : 'text-[var(--color-text-secondary)]'">
              {{ urlError(brand().logo_url) ? 'Usa un enlace que empiece por https://' : 'Vacío: el logo de tu tienda.' }}
            </span>
          </label>
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-[var(--color-text-primary)]">Fondo de la portada</span>
            <div class="flex items-center gap-2">
              <input type="url" placeholder="https://…/fondo.jpg" data-testid="style-cover"
                     class="w-full rounded-lg border bg-[var(--color-surface)] px-3 py-2 text-sm"
                     [class]="urlError(brand().cover_url) ? 'border-[var(--color-error,#dc2626)]' : 'border-[var(--color-border)]'"
                     [value]="brand().cover_url ?? ''" (input)="setBrand('cover_url', $any($event.target).value)" />
              <button type="button" class="whitespace-nowrap rounded-lg border border-[var(--color-border)] px-2.5 py-2 text-xs font-semibold text-[var(--color-text-primary)]"
                      data-testid="style-cover-gallery" (click)="mediaRequested.emit('cover_url')">
                Galería
              </button>
            </div>
            <span class="mt-1 block text-[11px]" [class]="urlError(brand().cover_url) ? 'text-[var(--color-error,#dc2626)]' : 'text-[var(--color-text-secondary)]'">
              {{ urlError(brand().cover_url) ? 'Usa un enlace que empiece por https://' : 'Se ve detrás de la portada cuando no tiene imagen propia.' }}
            </span>
          </label>
        </div>
      </section>

      <section data-testid="style-whatsapp">
        <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">WhatsApp</h3>
        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-[var(--color-text-primary)]">Número con indicativo</span>
            <input type="tel" maxlength="20" placeholder="+57 300 123 4567" data-testid="style-whatsapp-number"
                   class="w-full rounded-lg border bg-[var(--color-surface)] px-3 py-2 text-sm"
                   [class]="whatsappError() ? 'border-[var(--color-error,#dc2626)]' : 'border-[var(--color-border)]'"
                   [value]="brand().whatsapp_number ?? ''" (input)="setBrand('whatsapp_number', $any($event.target).value)" />
            @if (whatsappError()) {
              <span class="mt-1 block text-[11px] text-[var(--color-error,#dc2626)]">Escribe el número completo, con el indicativo del país.</span>
            }
          </label>
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-[var(--color-text-primary)]">Mensaje inicial</span>
            <input type="text" maxlength="200" placeholder="Hola, quiero más información" data-testid="style-whatsapp-message"
                   class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                   [value]="brand().whatsapp_message ?? ''" (input)="setBrand('whatsapp_message', $any($event.target).value)" />
          </label>
        </div>
        <label class="mt-3 flex items-start gap-2.5" [class.opacity-50]="!whatsappReady()">
          <input type="checkbox" class="mt-0.5 h-4 w-4 accent-[var(--color-primary)]" data-testid="style-whatsapp-floating"
                 [disabled]="!whatsappReady()" [checked]="!!brand().whatsapp_floating && whatsappReady()"
                 (change)="setBrand('whatsapp_floating', $any($event.target).checked)" />
          <span>
            <span class="block text-xs font-semibold text-[var(--color-text-primary)]">Botón flotante de WhatsApp</span>
            <span class="block text-[11px] text-[var(--color-text-secondary)]">
              {{ whatsappReady() ? 'Queda fijo en la esquina de la página.' : 'Escribe primero un número válido.' }}
            </span>
          </span>
        </label>
      </section>

    </div>
  `,
})
export class AppPageStylePanelComponent {
  readonly kind = input.required<PageAppKind>();
  readonly theme = input.required<AppPageTheme>();
  readonly brand = input.required<AppPageBrand>();
  /** The whole new theme (a preset, a token change, or `{}` to clear it). */
  readonly themeChange = output<AppPageTheme>();
  /** One brand key; `undefined` removes it. */
  readonly brandChange = output<{ key: AppPageStyleBrandKey; value: string | boolean | undefined }>();

  /** Pide abrir la galería de medios para ese campo; la vista monta la galería. */
  readonly mediaRequested = output<'logo_url' | 'cover_url'>();

  readonly fonts = APP_PAGE_FONTS;
  readonly palettes = APP_THEME_PALETTES;
  readonly maxOverlay = APP_THEME_MAX_IMAGE_OVERLAY;

  /** Apps F7: the extended tokens are for product, service and booking pages, not the store home. */
  readonly extended = computed(() => this.kind() !== 'store_home');
  readonly colorFields = computed(() =>
    this.extended() ? [...APP_THEME_COLORS, APP_THEME_BORDER_COLOR] : APP_THEME_COLORS,
  );
  readonly borderCheck = computed(() => (this.extended() ? borderContrast(this.theme()) : null));

  /** The styled variants of the app's templates, as one-click looks. */
  readonly presets = computed(() =>
    APP_PAGE_VARIANTS[this.kind()]
      .filter((v) => !!v.page.theme && Object.keys(v.page.theme).length > 0)
      .map((v) => ({ id: v.id, name: v.name, theme: { ...v.page.theme! } })),
  );
  readonly hasTheme = computed(() => Object.keys(this.theme()).length > 0);
  readonly contrast = computed(() => contrastChecks(this.theme(), this.brand()));
  readonly lowContrast = computed(() => this.contrast().some((c) => !c.ok));
  readonly whatsappReady = computed(() => !!whatsappHref(this.brand().whatsapp_number));
  readonly whatsappError = computed(() => !!this.brand().whatsapp_number?.trim() && !this.whatsappReady());

  colorValue(key: AppThemeColorKey): string {
    return this.theme()[key] ?? '';
  }

  colorError(key: AppThemeColorKey): boolean {
    const value = this.theme()[key];
    return !!value && !HEX.test(value);
  }

  tokenValue(key: string): string {
    return ((this.theme() as Record<string, unknown>)[key] as string | undefined) ?? '';
  }

  /** F3 tokens of a group, as selects. */
  selectOptions(group: AppThemeOptionGroup) {
    return APP_THEME_OPTIONS.filter((o) => APP_THEME_OPTION_GROUPS[o.key] === group);
  }

  /** F7 tokens of a group, as chips (none for the store home). */
  chipOptions(group: AppThemeOptionGroup) {
    return this.extended() ? APP_THEME_EXTENDED_OPTIONS.filter((o) => o.group === group) : [];
  }

  chipClass(active: boolean): string {
    return active
      ? 'rounded-full border border-[var(--color-primary)] bg-[var(--color-primary)] px-3 py-1 text-xs font-semibold text-[var(--color-text-on-primary,#fff)]'
      : 'rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-background)]';
  }

  /** Sets the five palette colors at once; the other tokens stay. */
  applyPalette(colors: Record<string, string>): void {
    this.themeChange.emit({ ...this.theme(), ...colors } as AppPageTheme);
  }

  /** The image veil (0..80 %); an empty value removes it («Como hoy»). */
  setOverlay(value: string): void {
    const next: AppPageTheme = { ...this.theme() };
    const n = Number.parseInt(value, 10);
    if (value === '' || Number.isNaN(n)) delete next.image_overlay;
    else next.image_overlay = Math.min(APP_THEME_MAX_IMAGE_OVERLAY, Math.max(0, n));
    this.themeChange.emit(next);
  }

  urlError(value: string | undefined): boolean {
    return !!value?.trim() && !HTTPS.test(value.trim());
  }

  setColor(key: AppThemeColorKey, value: string): void {
    this.setToken(key, value.trim());
  }

  /** Sets one token; an empty value removes it («Como hoy»). */
  setToken(key: string, value: string): void {
    const next: Record<string, unknown> = { ...this.theme() };
    if (value) next[key] = value;
    else delete next[key];
    this.themeChange.emit(next as AppPageTheme);
  }

  setBrand(key: AppPageStyleBrandKey, value: string | boolean): void {
    const empty = typeof value === 'string' ? !value.trim() : !value;
    this.brandChange.emit({ key, value: empty ? undefined : value });
  }
}
