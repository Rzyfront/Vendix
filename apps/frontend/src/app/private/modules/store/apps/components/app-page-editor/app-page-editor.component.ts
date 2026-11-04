import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { DialogService } from '../../../../../../shared/components/dialog/dialog.service';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { AppPageViewComponent } from '../../../../../../public/app-page/app-page-view.component';
import { contrastChecks } from '../../../../../../public/app-page/app-page-theme';
import type { StoreAppDetail } from '../../interfaces/store-app.interface';
import { StoreAppsService } from '../../services/store-apps.service';
import {
  APP_PAGE_FONTS,
  APP_PAGE_MODE_OPTIONS,
  APP_PAGE_TEMPLATES,
  APP_PAGE_VARIANTS,
  APP_THEME_COLORS,
  APP_THEME_OPTIONS,
  AppPageBlock,
  AppPageDocument,
  AppPageFont,
  AppPageMode,
  AppPageTheme,
  AppPageVariant,
  AppThemeColorKey,
  AppThemeOptionKey,
  BlockDef,
  HERO_FIELDS,
  PageAppKind,
  SEO_FIELDS,
  ScalarFieldDef,
  applyVariant,
  clonePage,
  effectiveMode,
  modeBooks,
  modeSells,
} from '../../templates';

export type AppPageEditorSection = 'content' | 'operation' | 'brand' | 'style' | 'preview';

/** Where a scalar field lives inside the draft page. */
type FieldTarget =
  | { g: 'hero' | 'seo' | 'brand' }
  | { g: 'block'; i: number }
  | { g: 'item'; i: number; list: string; idx: number };

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MAX_BLOCKS = 12;

const APP_LABEL: Record<PageAppKind, string> = {
  product_page: 'la página de producto',
  service_page: 'la página de servicios',
  booking: 'la página de reservas',
  store_home: 'el inicio de la tienda',
};

/**
 * Apps F2 — the ONE page editor shared by the product page, service page,
 * booking and store home (S6). It is driven by `APP_PAGE_TEMPLATES[kind]`:
 * each app brings its own blocks and its own base page; this component only
 * knows how to edit a `FieldDef`.
 *
 * It holds the draft in a signal and renders one section at a time
 * (`section`: Contenido, Operación, Marca y SEO, Estilo, Vista previa) so the
 * draft survives tab changes. Saving persists `config.page` and never publishes.
 *
 * Apps F3: Contenido opens with the template gallery (base + two variants
 * per app, `APP_PAGE_VARIANTS`) and Estilo edits `page.theme` next to a live
 * preview of the draft.
 */
@Component({
  selector: 'app-app-page-editor',
  standalone: true,
  imports: [NgTemplateOutlet, IconComponent, AppPageViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-4" data-testid="app-page-editor">
      <!-- Barra de guardado -->
      <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <div class="min-w-0 text-sm">
          @if (usingBase()) {
            <p class="text-[var(--color-text-primary)]" data-testid="base-note">
              Esta es la base sugerida para {{ appLabel() }}; no se publica nada hasta que guardes.
            </p>
          } @else if (changed()) {
            <p class="text-[var(--color-text-primary)]" data-testid="dirty-note">Tienes cambios sin guardar.</p>
          } @else {
            <p class="text-[var(--color-text-secondary)]" data-testid="saved-note">Todo guardado.</p>
          }
          <p class="text-xs text-[var(--color-text-secondary)]">Guardar no publica la app ni cambia su dominio.</p>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" data-testid="reset-base" (click)="resetToBase()"
                  class="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-background)]">
            <app-icon name="rotate-ccw" [size]="14" />
            Restaurar base
          </button>
          <button type="button" data-testid="save-page" [disabled]="!canSave()" (click)="save()"
                  class="inline-flex items-center gap-1 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-text-on-primary,#fff)] disabled:cursor-not-allowed disabled:opacity-50">
            <app-icon name="save" [size]="14" />
            {{ saving() ? 'Guardando…' : 'Guardar' }}
          </button>
        </div>
      </div>

      @switch (section()) {
        @case ('content') {
          <div class="space-y-4" data-section="content">
            <p class="text-sm text-[var(--color-text-secondary)]">{{ template().summary }}</p>

            <!-- Plantillas (apps-f3 S2) -->
            <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4" data-testid="template-gallery">
              <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Plantillas</h3>
              <p class="mb-3 text-xs text-[var(--color-text-secondary)]">
                Cambian el orden de las secciones, sus textos y el estilo. No publican ni tocan tu producto, tus servicios, tu dominio ni la tienda en línea.
              </p>
              <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
                @for (variant of variants(); track variant.id) {
                  <article class="flex flex-col rounded-lg border border-[var(--color-border)] p-3" [attr.data-template]="variant.id">
                    <div class="mb-2 flex h-6 items-center gap-1" aria-hidden="true">
                      @for (color of swatches(variant); track $index) {
                        <span class="h-5 w-5 rounded-full border border-[var(--color-border)]" [style.background-color]="color"></span>
                      } @empty {
                        <span class="text-[11px] text-[var(--color-text-secondary)]">Colores de tu marca</span>
                      }
                    </div>
                    <h4 class="text-sm font-semibold text-[var(--color-text-primary)]">{{ variant.name }}</h4>
                    <p class="mt-0.5 text-xs text-[var(--color-text-secondary)]">{{ variant.description }}</p>
                    <ol class="mt-2 flex-1 space-y-0.5 text-[11px] text-[var(--color-text-secondary)]" data-testid="template-sample">
                      @for (label of sample(variant); track $index) {
                        <li>{{ $index + 1 }}. {{ label }}</li>
                      }
                    </ol>
                    <button type="button" (click)="useVariant(variant)" [attr.data-testid]="'use-template-' + variant.id"
                            class="mt-3 inline-flex items-center justify-center gap-1 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-background)]">
                      <app-icon name="layout-template" [size]="14" />
                      Usar plantilla
                    </button>
                  </article>
                }
              </div>
            </div>

            <!-- Portada -->
            <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h3 class="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">Portada</h3>
              <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                @for (def of heroFields; track def.key) {
                  <ng-container *ngTemplateOutlet="scalar; context: { def: def, target: heroTarget }" />
                }
              </div>
            </div>

            <!-- Bloques en el orden de la página -->
            @for (block of blocks(); track block.id; let i = $index; let first = $first; let last = $last) {
              <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
                   [attr.data-block]="block.type" [class.opacity-60]="!block.enabled">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="min-w-0">
                    <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">{{ defOf(block.type)?.label ?? block.type }}</h3>
                    <p class="text-xs text-[var(--color-text-secondary)]">{{ defOf(block.type)?.description }}</p>
                  </div>
                  <div class="flex items-center gap-1">
                    <label class="mr-2 inline-flex items-center gap-2 text-xs text-[var(--color-text-primary)]">
                      <input type="checkbox" [checked]="block.enabled" (change)="toggleBlock(i)"
                             [attr.aria-label]="'Mostrar ' + (defOf(block.type)?.label ?? block.type)" data-testid="block-toggle" />
                      Visible
                    </label>
                    <button type="button" class="rounded-md p-1.5 hover:bg-[var(--color-background)] disabled:opacity-30"
                            [disabled]="first" (click)="moveBlock(i, -1)" aria-label="Subir sección" data-testid="block-up">
                      <app-icon name="chevron-up" [size]="16" />
                    </button>
                    <button type="button" class="rounded-md p-1.5 hover:bg-[var(--color-background)] disabled:opacity-30"
                            [disabled]="last" (click)="moveBlock(i, 1)" aria-label="Bajar sección" data-testid="block-down">
                      <app-icon name="chevron-down" [size]="16" />
                    </button>
                    <button type="button" class="rounded-md p-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-background)]"
                            (click)="removeBlock(i)" aria-label="Quitar sección" data-testid="block-remove">
                      <app-icon name="trash-2" [size]="16" />
                    </button>
                  </div>
                </div>

                @if (defOf(block.type); as def) {
                  @if (def.existing) {
                    <p class="mt-3 rounded-lg bg-[var(--color-background)] px-3 py-2 text-xs text-[var(--color-text-secondary)]"
                       data-testid="existing-note">
                      Esta sección ya la muestra la página pública ({{ def.description }}). Aquí solo puedes ponerle título o apagarla.
                    </p>
                  }
                  <div class="mt-3 space-y-3">
                    @for (field of def.fields; track field.key) {
                      <ng-container *ngTemplateOutlet="fieldTpl; context: { field: field, i: i }" />
                    }
                  </div>
                }
              </div>
            }

            @if (missingBlocks().length) {
              <div class="rounded-xl border border-dashed border-[var(--color-border)] p-4">
                <p class="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">Secciones que puedes agregar</p>
                <div class="flex flex-wrap gap-2">
                  @for (def of missingBlocks(); track def.type) {
                    <button type="button" (click)="addBlock(def.type)" [disabled]="blocks().length >= maxBlocks"
                            class="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-background)] disabled:opacity-50"
                            data-testid="add-block">
                      <app-icon name="plus" [size]="14" />
                      {{ def.label }}
                    </button>
                  }
                </div>
              </div>
            }
          </div>
        }

        @case ('operation') {
          <div class="space-y-4" data-section="operation">
            <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h3 class="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">¿Qué hace esta página?</h3>
              <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Modo de operación">
                @for (opt of modeOptions; track opt.value) {
                  <label [class]="modeClass(opt.value)">
                    <input type="radio" name="page-mode" class="mt-1" [checked]="mode() === opt.value"
                           (change)="setMode(opt.value)" [attr.data-testid]="'mode-' + opt.value" />
                    <span>
                      <span class="block font-medium text-[var(--color-text-primary)]">{{ opt.label }}</span>
                      <span class="block text-xs text-[var(--color-text-secondary)]">{{ opt.hint }}</span>
                    </span>
                  </label>
                }
              </div>
            </div>

            @if (sells()) {
              <div class="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4" data-testid="sales-fields">
                <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Venta</h3>
                @if (kind() === 'product_page') {
                  <fieldset class="space-y-2" data-testid="product-mode">
                    <legend class="text-xs font-medium text-[var(--color-text-secondary)]">Qué vende</legend>
                    <label class="flex items-center gap-2 text-sm">
                      <input type="radio" name="product-mode" [checked]="productMode() === 'single'" (change)="setSales('product_mode', 'single')" />
                      Un solo producto con variantes
                    </label>
                    <label class="flex items-center gap-2 text-sm">
                      <input type="radio" name="product-mode" [checked]="productMode() === 'catalog'" (change)="setSales('product_mode', 'catalog')" />
                      Catálogo
                    </label>
                  </fieldset>
                }
                <label class="flex items-center gap-2 text-sm">
                  <input type="checkbox" [checked]="showCart()" (change)="setShowCart($event)" data-testid="show-cart" />
                  Mostrar el carrito en el encabezado
                </label>
                <div>
                  <p class="text-xs font-medium text-[var(--color-text-secondary)]">Checkout</p>
                  <p class="text-sm text-[var(--color-text-primary)]" data-testid="checkout-fixed">Checkout de la tienda en línea</p>
                </div>
              </div>
            }

            @if (books()) {
              <div class="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4" data-testid="booking-fields">
                <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Reserva</h3>
                <fieldset class="space-y-2">
                  <legend class="text-xs font-medium text-[var(--color-text-secondary)]">Qué se reserva</legend>
                  <label class="flex items-center gap-2 text-sm">
                    <input type="radio" name="booking-source" [checked]="bookingSource() === 'agenda'" (change)="setBookingSource('agenda')" />
                    Agenda (citas y servicios)
                  </label>
                  <label class="flex items-center gap-2 text-sm">
                    <input type="radio" name="booking-source" [checked]="bookingSource() === 'rooms'" (change)="setBookingSource('rooms')" />
                    Habitaciones
                  </label>
                </fieldset>
                <p class="text-xs text-[var(--color-text-secondary)]">La reserva no exige crear cuenta.</p>
              </div>
            }

            @if (!sells() && !books()) {
              <p class="text-sm text-[var(--color-text-secondary)]">
                Una página informativa no muestra carrito, checkout ni agenda.
              </p>
            }
          </div>
        }

        @case ('brand') {
          <div class="space-y-4" data-section="brand">
            <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h3 class="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">Marca</h3>
              <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                <ng-container *ngTemplateOutlet="scalar; context: { def: logoField, target: brandTarget }" />
                <ng-container *ngTemplateOutlet="scalar; context: { def: coverField, target: brandTarget }" />
                <ng-container *ngTemplateOutlet="colorTpl; context: { key: 'primary_color', label: 'Color principal' }" />
                <ng-container *ngTemplateOutlet="colorTpl; context: { key: 'secondary_color', label: 'Color secundario' }" />
                <label class="block text-sm">
                  <span class="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">Tipografía</span>
                  <select [class]="inputClass" [value]="brand().font_family ?? ''" (change)="setFont($event)" data-testid="brand-font">
                    <option value="">Predeterminada</option>
                    @for (font of fonts; track font.value) {
                      <option [value]="font.value" [selected]="brand().font_family === font.value">{{ font.label }}</option>
                    }
                  </select>
                </label>
              </div>
            </div>

            <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <h3 class="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">SEO</h3>
              <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div class="md:col-span-2">
                  <p class="mb-1 text-xs font-medium text-[var(--color-text-secondary)]">Dominio</p>
                  <p class="text-sm text-[var(--color-text-primary)]" data-testid="seo-hostname">{{ detail().domain?.hostname ?? 'Sin dominio' }}</p>
                  <p class="text-xs text-[var(--color-text-secondary)]">El dominio se cambia en la pestaña de dominio de esta app.</p>
                </div>
                @for (def of seoFields; track def.key) {
                  <ng-container *ngTemplateOutlet="scalar; context: { def: def, target: seoTarget }" />
                }
              </div>
            </div>
          </div>
        }

        @case ('style') {
          <div class="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]" data-section="style">
            <div class="space-y-4">
              <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Estilos rápidos</h3>
                <p class="mb-3 text-xs text-[var(--color-text-secondary)]">Solo cambian el aspecto; tus secciones y textos se quedan igual.</p>
                <div class="flex flex-wrap gap-2">
                  @for (variant of styledVariants(); track variant.id) {
                    <button type="button" (click)="applyThemePreset(variant)" [attr.data-testid]="'theme-preset-' + variant.id"
                            class="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-background)]">
                      <span class="h-3 w-3 rounded-full" [style.background-color]="variant.page.theme?.primary_color" aria-hidden="true"></span>
                      {{ variant.name }}
                    </button>
                  }
                  <button type="button" (click)="clearTheme()" [disabled]="!hasThemeDraft()" data-testid="theme-clear"
                          class="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-background)] disabled:opacity-50">
                    <app-icon name="rotate-ccw" [size]="14" />
                    Quitar estilo
                  </button>
                </div>
                @if (!hasThemeDraft()) {
                  <p class="mt-2 text-xs text-[var(--color-text-secondary)]" data-testid="theme-none">Sin estilo propio: la página se ve como hoy.</p>
                }
              </div>

              <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <h3 class="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">Colores</h3>
                <div class="space-y-3">
                  @for (color of themeColors; track color.key) {
                    <div class="text-sm">
                      <span class="block text-xs font-medium text-[var(--color-text-secondary)]">{{ color.label }} · {{ color.hint }}</span>
                      <div class="mt-1 flex items-center gap-2">
                        <input type="color" class="h-9 w-12 cursor-pointer rounded border border-[var(--color-border)] bg-transparent p-0.5"
                               [value]="themeColor(color.key) || '#000000'" (input)="onThemeColor(color.key, $event)" [attr.aria-label]="'Color ' + color.label" />
                        <input type="text" [class]="inputClass" maxlength="7" placeholder="Como hoy"
                               [value]="themeColor(color.key)" (input)="onThemeColor(color.key, $event)" [attr.data-testid]="'theme-' + color.key" />
                      </div>
                    </div>
                  }
                </div>
              </div>

              <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <h3 class="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">Tipografía y forma</h3>
                <div class="space-y-3">
                  <label class="block text-sm">
                    <span class="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">Títulos</span>
                    <select [class]="inputClass" (change)="onThemeSelect('heading_font', $event)" data-testid="theme-heading_font">
                      <option value="" [selected]="!theme().heading_font">Como hoy</option>
                      @for (font of fonts; track font.value) {
                        <option [value]="font.value" [selected]="theme().heading_font === font.value">{{ font.label }}</option>
                      }
                    </select>
                  </label>
                  <label class="block text-sm">
                    <span class="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">Texto</span>
                    <select [class]="inputClass" (change)="onThemeSelect('body_font', $event)" data-testid="theme-body_font">
                      <option value="" [selected]="!theme().body_font">Como hoy</option>
                      @for (font of fonts; track font.value) {
                        <option [value]="font.value" [selected]="theme().body_font === font.value">{{ font.label }}</option>
                      }
                    </select>
                  </label>
                  @for (option of themeOptions; track option.key) {
                    <label class="block text-sm">
                      <span class="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">{{ option.label }}</span>
                      <select [class]="inputClass" (change)="onThemeSelect(option.key, $event)" [attr.data-testid]="'theme-' + option.key">
                        <option value="" [selected]="!themeValue(option.key)">Como hoy</option>
                        @for (choice of option.values; track choice.value) {
                          <option [value]="choice.value" [selected]="themeValue(option.key) === choice.value">{{ choice.label }}</option>
                        }
                      </select>
                    </label>
                  }
                </div>
              </div>

              @if (contrast().length) {
                <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4" data-testid="theme-contrast">
                  <h3 class="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">Legibilidad</h3>
                  <ul class="space-y-1 text-xs">
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
                    <p class="mt-2 text-xs text-[var(--color-error)]" data-testid="theme-contrast-warning">
                      Algunos textos pueden leerse mal. Recomendamos al menos 4.5:1.
                    </p>
                  }
                </div>
              }
            </div>

            <div class="space-y-2">
              <p class="text-xs text-[var(--color-text-secondary)]">Vista previa en vivo: así se verá al guardar.</p>
              <div class="max-h-[75vh] overflow-auto rounded-xl border border-[var(--color-border)] bg-white" data-testid="style-preview">
                <app-app-page-view [kind]="kind()" [page]="draft()" [preview]="true" />
              </div>
            </div>
          </div>
        }

        @case ('preview') {
          <div class="space-y-3" data-section="preview">
            @if (detail().public_url; as url) {
              @if (detail().status === 'published') {
                <a [href]="url" target="_blank" rel="noopener noreferrer"
                   class="inline-block text-sm font-semibold text-[var(--color-primary)] hover:underline" data-testid="open-published">
                  Abrir la página publicada
                </a>
              }
            }
            @if (changed() || usingBase()) {
              <p class="text-xs text-[var(--color-text-secondary)]">La vista previa muestra tus cambios aunque todavía no estén guardados.</p>
            }
            <div class="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white">
              <app-app-page-view [kind]="kind()" [page]="draft()" [preview]="true" />
            </div>
          </div>
        }
      }
    </section>

    <!-- Campo escalar: texto, URL, sí/no o entero -->
    <ng-template #scalar let-def="def" let-target="target">
      <label [class]="def.multiline ? 'block text-sm md:col-span-2' : 'block text-sm'">
        @if (def.kind !== 'bool') {
          <span class="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">{{ def.label }}</span>
        }
        @switch (def.kind) {
          @case ('bool') {
            <span class="inline-flex items-center gap-2">
              <input type="checkbox" [checked]="read(target, def.key) === true" (change)="onBool(target, def.key, $event)" />
              {{ def.label }}
            </span>
          }
          @case ('int') {
            <input type="number" [class]="inputClass" [attr.min]="def.min" [attr.max]="def.max"
                   [value]="read(target, def.key) ?? ''" (input)="onInt(target, def.key, $event)" />
          }
          @case ('url') {
            <input type="url" [class]="inputClass" [attr.placeholder]="def.placeholder ?? 'https://'"
                   [value]="read(target, def.key) ?? ''" (input)="onText(target, def.key, $event)" />
          }
          @default {
            @if (def.multiline) {
              <textarea rows="3" [class]="inputClass" [attr.maxlength]="def.max" [attr.placeholder]="def.placeholder"
                        [value]="read(target, def.key) ?? ''" (input)="onText(target, def.key, $event)"></textarea>
            } @else {
              <input type="text" [class]="inputClass" [attr.maxlength]="def.max" [attr.placeholder]="def.placeholder"
                     [value]="read(target, def.key) ?? ''" (input)="onText(target, def.key, $event)" />
            }
            <span class="mt-0.5 block text-right text-[11px] text-[var(--color-text-secondary)]">
              {{ textLength(target, def.key) }}/{{ def.max }}
            </span>
          }
        }
      </label>
    </ng-template>

    <!-- Campo de un bloque: escalar, lista de tarjetas, o listas de texto/URL -->
    <ng-template #fieldTpl let-field="field" let-i="i">
      @switch (field.kind) {
        @case ('list') {
          <div class="space-y-2" [attr.data-list]="field.key">
            <p class="text-xs font-medium text-[var(--color-text-secondary)]">{{ field.label }}</p>
            @for (item of listOf(i, field.key); track $index; let idx = $index) {
              <div class="rounded-lg border border-[var(--color-border)] p-3">
                <div class="mb-2 flex items-center justify-between">
                  <span class="text-xs font-semibold text-[var(--color-text-primary)]">{{ field.itemLabel }} {{ idx + 1 }}</span>
                  <button type="button" class="rounded-md p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-background)]"
                          (click)="removeListItem(i, field.key, idx)" [attr.aria-label]="'Quitar ' + field.itemLabel" data-testid="item-remove">
                    <app-icon name="trash-2" [size]="14" />
                  </button>
                </div>
                <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                  @for (sub of field.item; track sub.key) {
                    <ng-container *ngTemplateOutlet="scalar; context: { def: sub, target: itemTarget(i, field.key, idx) }" />
                  }
                </div>
              </div>
            }
            <button type="button" (click)="addListItem(i, field.key, field.max)" [disabled]="listOf(i, field.key).length >= field.max"
                    class="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-background)] disabled:opacity-50"
                    data-testid="item-add">
              <app-icon name="plus" [size]="14" />
              Agregar {{ field.itemLabel.toLowerCase() }}
            </button>
          </div>
        }
        @case ('text_list') {
          <ng-container *ngTemplateOutlet="stringList; context: { field: field, i: i, url: false }" />
        }
        @case ('url_list') {
          <ng-container *ngTemplateOutlet="stringList; context: { field: field, i: i, url: true }" />
        }
        @default {
          <ng-container *ngTemplateOutlet="scalar; context: { def: field, target: blockTarget(i) }" />
        }
      }
    </ng-template>

    <ng-template #stringList let-field="field" let-i="i" let-url="url">
      <div class="space-y-2" [attr.data-list]="field.key">
        <p class="text-xs font-medium text-[var(--color-text-secondary)]">{{ field.label }}</p>
        @for (value of stringsOf(i, field.key); track $index; let idx = $index) {
          <div class="flex items-center gap-2">
            <input [type]="url ? 'url' : 'text'" [class]="inputClass" [attr.maxlength]="field.itemMax ?? null"
                   [value]="value" (input)="onStringItem(i, field.key, idx, $event)" />
            <button type="button" class="rounded-md p-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-background)]"
                    (click)="removeStringItem(i, field.key, idx)" aria-label="Quitar" data-testid="string-remove">
              <app-icon name="trash-2" [size]="14" />
            </button>
          </div>
        }
        <button type="button" (click)="addStringItem(i, field.key)" [disabled]="stringsOf(i, field.key).length >= field.max"
                class="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-background)] disabled:opacity-50"
                data-testid="string-add">
          <app-icon name="plus" [size]="14" />
          Agregar
        </button>
      </div>
    </ng-template>

    <!-- Color: selector nativo + hex -->
    <ng-template #colorTpl let-key="key" let-label="label">
      <div class="text-sm">
        <span class="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">{{ label }}</span>
        <div class="flex items-center gap-2">
          <input type="color" class="h-9 w-12 cursor-pointer rounded border border-[var(--color-border)] bg-transparent p-0.5"
                 [value]="colorOf(key) || '#000000'" (input)="onColor(key, $event)" [attr.aria-label]="label" />
          <input type="text" [class]="inputClass" maxlength="7" placeholder="#RRGGBB"
                 [value]="colorOf(key)" (input)="onColor(key, $event)" [attr.data-testid]="'hex-' + key" />
        </div>
      </div>
    </ng-template>
  `,
})
export class AppPageEditorComponent {
  private readonly appsService = inject(StoreAppsService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly kind = input.required<PageAppKind>();
  readonly detail = input.required<StoreAppDetail>();
  readonly section = input<AppPageEditorSection>('content');

  protected readonly inputClass =
    'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-primary)] focus:outline-none';
  protected readonly heroFields = HERO_FIELDS;
  protected readonly seoFields = SEO_FIELDS;
  protected readonly modeOptions = APP_PAGE_MODE_OPTIONS;
  protected readonly fonts = APP_PAGE_FONTS;
  protected readonly themeColors = APP_THEME_COLORS;
  protected readonly themeOptions = APP_THEME_OPTIONS;
  protected readonly maxBlocks = MAX_BLOCKS;
  protected readonly heroTarget: FieldTarget = { g: 'hero' };
  protected readonly seoTarget: FieldTarget = { g: 'seo' };
  protected readonly brandTarget: FieldTarget = { g: 'brand' };
  protected readonly logoField: ScalarFieldDef = { key: 'logo_url', label: 'Logo (URL https)', kind: 'url' };
  protected readonly coverField: ScalarFieldDef = { key: 'cover_url', label: 'Portada (URL https)', kind: 'url' };

  /** The page as last saved (`null` = the owner never saved one). */
  readonly baseline = signal<AppPageDocument | null>(null);
  readonly draft = signal<AppPageDocument>({ schema_version: 1, blocks: [] });
  readonly saving = signal(false);
  private loadedKind: PageAppKind | null = null;

  readonly template = computed(() => APP_PAGE_TEMPLATES[this.kind()]);
  readonly appLabel = computed(() => APP_LABEL[this.kind()]);
  readonly blocks = computed(() => this.draft().blocks);
  readonly usingBase = computed(() => this.baseline() === null);
  readonly changed = computed(() => {
    const reference = this.baseline() ?? this.template().page;
    return JSON.stringify(this.draft()) !== JSON.stringify(reference);
  });
  /** An unsaved base can be saved as it is; a saved page only when it changed. */
  readonly canSave = computed(() => !this.saving() && (this.usingBase() || this.changed()));

  readonly mode = computed<AppPageMode>(() => effectiveMode(this.kind(), this.draft()));
  readonly sells = computed(() => modeSells(this.mode()));
  readonly books = computed(() => modeBooks(this.mode()));
  readonly productMode = computed(() => this.draft().sales?.product_mode ?? 'single');
  readonly showCart = computed(() => this.draft().sales?.show_cart !== false);
  readonly bookingSource = computed(
    () => this.draft().booking?.source ?? (this.kind() === 'booking' ? 'rooms' : 'agenda'),
  );
  readonly brand = computed(() => this.draft().brand ?? {});

  // ---- Apps F3: templates and style --------------------------------------
  readonly variants = computed(() => APP_PAGE_VARIANTS[this.kind()]);
  /** Variants that bring a style (every one but the base). */
  readonly styledVariants = computed(() => this.variants().filter((v) => !!v.page.theme));
  readonly theme = computed<AppPageTheme>(() => this.draft().theme ?? {});
  readonly hasThemeDraft = computed(() => Object.keys(this.theme()).length > 0);
  readonly contrast = computed(() => contrastChecks(this.draft().theme, this.draft().brand));
  readonly lowContrast = computed(() => this.contrast().some((c) => !c.ok));
  readonly missingBlocks = computed<BlockDef[]>(() => {
    const present = new Set(this.blocks().map((b) => b.type));
    return this.template().blocks.filter((def) => !present.has(def.type));
  });

  constructor() {
    effect(() => {
      const kind = this.kind();
      const detail = this.detail();
      untracked(() => this.sync(kind, detail));
    });
  }

  defOf(type: string): BlockDef | undefined {
    return this.template().blocks.find((def) => def.type === type);
  }

  // ---- load / save ------------------------------------------------------

  private sync(kind: PageAppKind, detail: StoreAppDetail): void {
    // A detail reload (e.g. after the settings panel saved) never drops edits.
    if (this.loadedKind === kind && this.changed()) return;
    this.loadedKind = kind;
    const saved = (detail.config?.['page'] as AppPageDocument | undefined) ?? null;
    this.baseline.set(saved ? clonePage(saved) : null);
    this.draft.set(clonePage(saved ?? APP_PAGE_TEMPLATES[kind].page));
  }

  async resetToBase(): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Restaurar la base',
      message: `Se reemplazará lo que editaste por la base sugerida para ${this.appLabel()}. Sigue sin guardarse hasta que pulses Guardar.`,
      confirmText: 'Restaurar',
      cancelText: 'Cancelar',
    });
    if (ok) this.draft.set(clonePage(this.template().page));
  }

  // ---- templates (apps-f3 S2) -------------------------------------------

  /** Palette of a template; empty for the base (it uses the brand colors). */
  swatches(variant: AppPageVariant): string[] {
    const t = variant.page.theme;
    if (!t) return [];
    return [t.primary_color, t.secondary_color, t.accent_color, t.surface_color, t.text_color].filter(
      (c): c is string => !!c,
    );
  }

  /** Visible sections of a template, in its order (the gallery's preview). */
  sample(variant: AppPageVariant): string[] {
    return variant.page.blocks
      .filter((b) => b.enabled)
      .map((b) => this.defOf(b.type)?.label ?? b.type);
  }

  async useVariant(variant: AppPageVariant): Promise<void> {
    const ok = await this.dialog.confirm({
      title: `Usar la plantilla «${variant.name}»`,
      message:
        'Reemplaza la portada, las secciones y el estilo que tienes ahora en el editor. ' +
        'Conserva el modo de operación, la marca y el SEO. No publica ni cambia tu producto, tus servicios, tu dominio ni la tienda en línea, ' +
        'y no se guarda hasta que pulses Guardar.',
      confirmText: 'Usar plantilla',
      cancelText: 'Cancelar',
    });
    if (ok) this.draft.set(applyVariant(this.draft(), variant));
  }

  // ---- style (apps-f3 S1) ----------------------------------------------

  private setTheme(key: keyof AppPageTheme, value: string | undefined): void {
    this.update((page) => {
      const theme: Record<string, unknown> = { ...(page.theme ?? {}) };
      if (value === undefined) delete theme[key];
      else theme[key] = value;
      if (Object.keys(theme).length) page.theme = theme as AppPageTheme;
      else delete page.theme;
    });
  }

  themeColor(key: AppThemeColorKey): string {
    return this.theme()[key] ?? '';
  }

  themeValue(key: AppThemeOptionKey): string {
    return this.theme()[key] ?? '';
  }

  /** Only a valid `#RRGGBB` (or an empty box, "como hoy") reaches the draft. */
  onThemeColor(key: AppThemeColorKey, event: Event): void {
    const value = (event.target as HTMLInputElement).value.trim();
    if (!value) this.setTheme(key, undefined);
    else if (HEX_COLOR.test(value)) this.setTheme(key, value);
  }

  onThemeSelect(key: AppThemeOptionKey | 'heading_font' | 'body_font', event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.setTheme(key, value || undefined);
  }

  /** The style of a template, without touching sections or texts. */
  applyThemePreset(variant: AppPageVariant): void {
    const theme = variant.page.theme;
    if (!theme) return;
    this.update((page) => (page.theme = { ...theme }));
  }

  clearTheme(): void {
    this.update((page) => delete page.theme);
  }

  save(): void {
    if (!this.canSave()) return;
    this.saving.set(true);
    this.appsService
      .savePage(this.kind(), this.draft())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          // The server returns the cleaned page: it becomes the new baseline.
          const page = res?.data?.page ?? this.draft();
          this.baseline.set(clonePage(page));
          this.draft.set(clonePage(page));
          this.saving.set(false);
          this.toast.success('Contenido guardado. La página no se publica por guardar.');
        },
        error: (err) => {
          this.saving.set(false);
          this.toast.error(this.errorMessage(err));
        },
      });
  }

  /** Field-by-field validation messages when the API sends them; otherwise the parsed one. */
  private errorMessage(err: unknown): string {
    const parsed = parseApiError(err);
    const list: unknown = parsed.details?.validationErrors;
    if (Array.isArray(list)) {
      const lines = list.filter((line): line is string => typeof line === 'string' && line.trim() !== '');
      if (lines.length) return lines.join(' ');
    }
    return parsed.userMessage || 'No se pudo guardar el contenido.';
  }

  // ---- draft mutation ---------------------------------------------------

  private update(mutate: (page: AppPageDocument) => void): void {
    const next = clonePage(this.draft());
    mutate(next);
    this.draft.set(next);
  }

  modeClass(value: AppPageMode): string {
    const base = 'flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ';
    return base + (this.mode() === value ? 'border-[var(--color-primary)]' : 'border-[var(--color-border)]');
  }

  setMode(mode: AppPageMode): void {
    this.update((page) => (page.mode = mode));
  }

  setSales(key: 'product_mode', value: 'single' | 'catalog'): void {
    this.update((page) => (page.sales = { ...page.sales, [key]: value }));
  }

  setShowCart(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.update((page) => (page.sales = { ...page.sales, show_cart: checked }));
  }

  setBookingSource(source: 'agenda' | 'rooms'): void {
    this.update((page) => (page.booking = { ...page.booking, source }));
  }

  setFont(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as AppPageFont | '';
    this.write({ g: 'brand' }, 'font_family', value || undefined);
  }

  colorOf(key: string): string {
    return (this.brand() as Record<string, string | undefined>)[key] ?? '';
  }

  /** Only a valid `#RRGGBB` (or an empty box) reaches the draft. */
  onColor(key: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value.trim();
    if (!value) this.write({ g: 'brand' }, key, undefined);
    else if (HEX_COLOR.test(value)) this.write({ g: 'brand' }, key, value);
  }

  blockTarget(i: number): FieldTarget {
    return { g: 'block', i };
  }

  itemTarget(i: number, list: string, idx: number): FieldTarget {
    return { g: 'item', i, list, idx };
  }

  toggleBlock(i: number): void {
    this.update((page) => (page.blocks[i].enabled = !page.blocks[i].enabled));
  }

  moveBlock(i: number, delta: -1 | 1): void {
    const j = i + delta;
    if (j < 0 || j >= this.blocks().length) return;
    this.update((page) => {
      [page.blocks[i], page.blocks[j]] = [page.blocks[j], page.blocks[i]];
    });
  }

  removeBlock(i: number): void {
    this.update((page) => page.blocks.splice(i, 1));
  }

  addBlock(type: string): void {
    if (this.blocks().length >= MAX_BLOCKS) return;
    const taken = new Set(this.blocks().map((b) => b.id));
    let id = type.replace(/_/g, '-');
    for (let n = 2; taken.has(id); n++) id = `${type.replace(/_/g, '-')}-${n}`;
    const block: AppPageBlock = { id, type, enabled: true, props: {} };
    this.update((page) => page.blocks.push(block));
  }

  // ---- scalar read / write ---------------------------------------------

  private container(page: AppPageDocument, target: FieldTarget): Record<string, unknown> | undefined {
    switch (target.g) {
      case 'hero':
      case 'seo':
      case 'brand':
        return (page[target.g] ??= {}) as Record<string, unknown>;
      case 'block':
        return page.blocks[target.i]?.props;
      case 'item': {
        const list = page.blocks[target.i]?.props[target.list];
        return Array.isArray(list) ? (list[target.idx] as Record<string, unknown>) : undefined;
      }
    }
  }

  read(target: FieldTarget, key: string): unknown {
    const page = this.draft();
    switch (target.g) {
      case 'hero':
      case 'seo':
      case 'brand':
        return (page[target.g] as Record<string, unknown> | undefined)?.[key];
      case 'block':
        return page.blocks[target.i]?.props[key];
      case 'item': {
        const list = page.blocks[target.i]?.props[target.list];
        return Array.isArray(list) ? (list[target.idx] as Record<string, unknown> | undefined)?.[key] : undefined;
      }
    }
  }

  textLength(target: FieldTarget, key: string): number {
    const value = this.read(target, key);
    return typeof value === 'string' ? value.length : 0;
  }

  /** `undefined` removes the key; empty hero/seo/brand groups are dropped. */
  private write(target: FieldTarget, key: string, value: unknown): void {
    this.update((page) => {
      const box = this.container(page, target);
      if (!box) return;
      if (value === undefined) delete box[key];
      else box[key] = value;
      if ((target.g === 'hero' || target.g === 'seo' || target.g === 'brand') && !Object.keys(box).length) {
        delete page[target.g];
      }
    });
  }

  onText(target: FieldTarget, key: string, event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    const group = target.g === 'hero' || target.g === 'seo' || target.g === 'brand';
    // Group fields drop empty strings (an empty URL or color would not validate).
    this.write(target, key, group && value.trim() === '' ? undefined : value);
  }

  onBool(target: FieldTarget, key: string, event: Event): void {
    this.write(target, key, (event.target as HTMLInputElement).checked);
  }

  onInt(target: FieldTarget, key: string, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const n = Number(raw);
    this.write(target, key, raw.trim() === '' || !Number.isInteger(n) ? undefined : n);
  }

  // ---- lists ------------------------------------------------------------

  listOf(i: number, key: string): Record<string, unknown>[] {
    const value = this.blocks()[i]?.props[key];
    return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  }

  addListItem(i: number, key: string, max: number): void {
    if (this.listOf(i, key).length >= max) return;
    this.update((page) => {
      const props = page.blocks[i].props;
      props[key] = [...((props[key] as unknown[]) ?? []), {}];
    });
  }

  removeListItem(i: number, key: string, idx: number): void {
    this.update((page) => (page.blocks[i].props[key] as unknown[]).splice(idx, 1));
  }

  stringsOf(i: number, key: string): string[] {
    const value = this.blocks()[i]?.props[key];
    return Array.isArray(value) ? (value as string[]) : [];
  }

  addStringItem(i: number, key: string): void {
    this.update((page) => {
      const props = page.blocks[i].props;
      props[key] = [...((props[key] as string[]) ?? []), ''];
    });
  }

  removeStringItem(i: number, key: string, idx: number): void {
    this.update((page) => (page.blocks[i].props[key] as string[]).splice(idx, 1));
  }

  onStringItem(i: number, key: string, idx: number, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.update((page) => ((page.blocks[i].props[key] as string[])[idx] = value));
  }
}
