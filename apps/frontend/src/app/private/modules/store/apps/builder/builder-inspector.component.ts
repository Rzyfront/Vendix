import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import type { AppPageProductItem } from '../../../../../public/app-page/app-page-products.util';
import { AppMediaFieldComponent } from '../components/app-media-field/app-media-field.component';
import { AppMediaPickerComponent } from '../components/app-media-picker/app-media-picker.component';
import { AppProductSelectorComponent } from '../components/app-product-selector/app-product-selector.component';
import { AppServiceSelectorComponent } from '../components/app-service-selector/app-service-selector.component';
import type { AppMediaItem } from '../services/app-media.service';
import { APP_BLOCK_CONDITION_OPTIONS, AppBlockConditionKey, AppBlockConditions, PageAppKind } from '../templates/app-page.types';
import { BuilderListItem, blockDef, readListItems } from './builder-blocks';
import type {
  BuilderBlock,
  BuilderCatalog,
  BuilderFieldDef,
  BuilderListFieldDef,
  BuilderProductIdsFieldDef,
  BuilderScalarFieldDef,
  BuilderServiceIdsFieldDef,
} from './builder.types';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Edición de una prop de un bloque, aplicada por el editor con `setBlockProp`. */
export interface BuilderPropChange {
  blockId: string;
  key: string;
  value: unknown;
}

/**
 * Inspector de campos del constructor de páginas (motor genérico por catálogo).
 *
 * Renderiza los campos declarados para el bloque seleccionado:
 * texto/textarea con contador, enlaces https, medios conectados a la galería
 * (`app-media-field`), selectores cerrados (desplegables o chips), sliders de
 * rango, colores `#RRGGBB`, números enteros, interruptores y listas repetibles
 * (agregar, quitar y reordenar). Los campos con `group: 'appearance'` se
 * agrupan en un panel plegable «Apariencia de la sección».
 */
@Component({
  selector: 'app-builder-inspector',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    IconComponent,
    AppMediaFieldComponent,
    AppMediaPickerComponent,
    AppProductSelectorComponent,
    AppServiceSelectorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (block(); as b) {
      @if (def(); as d) {
        <div class="space-y-4 p-4" data-testid="builder-inspector">
          <header class="flex items-start gap-2.5">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-background)] text-[var(--color-primary)]">
              <app-icon [name]="d.icon" [size]="18" />
            </span>
            <div class="min-w-0">
              <h2 class="text-sm font-semibold text-[var(--color-text-primary)]">{{ d.label }}</h2>
              <p class="text-xs text-[var(--color-text-secondary)]">{{ d.description }}</p>
            </div>
          </header>

          @if (b.hidden) {
            <p class="flex items-center gap-2 rounded-lg bg-[var(--color-background)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
              <app-icon name="eye-off" [size]="14" /> Sección oculta: se guarda en el borrador pero no se publica.
            </p>
          }
          @if (d.liveData) {
            <p class="flex items-start gap-2 rounded-lg bg-[var(--color-background)] px-3 py-2 text-xs text-[var(--color-text-secondary)]" data-testid="builder-live-data">
              <app-icon name="info" [size]="14" class="mt-0.5 shrink-0" /> {{ d.liveData }}
            </p>
          }

          @for (field of mainFields(); track field.key) {
            @if (isFieldVisible(b, field)) {
              <ng-container *ngTemplateOutlet="fieldTpl; context: { b: b, field: field }" />
            }
          }

          @if (appearanceFields().length > 0) {
            <details
              class="rounded-xl border border-[var(--color-border)] bg-[var(--color-background)]/40 p-3"
              [open]="hasCustomAppearance()"
              data-testid="builder-appearance-group"
            >
              <summary class="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-[var(--color-text-primary)]">
                <span class="inline-flex items-center gap-1.5">
                  <app-icon name="sliders-horizontal" [size]="14" class="text-[var(--color-primary)]" />
                  Apariencia de la sección
                </span>
                @if (hasCustomAppearance()) {
                  <span class="rounded-full bg-[var(--color-primary)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--color-primary)]">
                    Personalizada
                  </span>
                }
              </summary>
              <div class="mt-3 space-y-3.5 border-t border-[var(--color-border)] pt-3">
                @for (field of appearanceFields(); track field.key) {
                  <ng-container *ngTemplateOutlet="fieldTpl; context: { b: b, field: field }" />
                }
              </div>
            </details>
          }
        </div>
      } @else {
        <p class="p-4 text-sm text-[var(--color-text-secondary)]">Esta sección no tiene campos editables aquí.</p>
      }
    } @else {
      <div class="flex h-full flex-col items-center justify-center p-6 text-center" data-testid="builder-inspector-empty">
        <app-icon name="pencil" [size]="22" class="text-[var(--color-text-secondary)]" />
        <p class="mt-2 text-sm font-medium text-[var(--color-text-primary)]">Elige una sección para editarla</p>
        <p class="mt-1 text-xs text-[var(--color-text-secondary)]">Haz clic en una sección de la lista o directamente en la vista previa.</p>
      </div>
    }

    <!-- Plantilla de un campo del bloque -->
    <ng-template #fieldTpl let-b="b" let-field="field">
      @if (isProductIds(field)) {
        <div class="block" [attr.data-field]="field.key">
          <app-product-selector
            [selectedIds]="productIds(b, field.key)"
            [max]="field.max"
            [label]="field.label"
            [excludeServices]="appKind() === 'service_page'"
            (selectedIdsChange)="setProductIds(b, field.key, $event)"
            (productsResolved)="productsResolved.emit($event)"
          />
          @if (field.hint) {
            <span class="mt-1 block text-[11px] text-[var(--color-text-secondary)]">{{ field.hint }}</span>
          }
        </div>
      } @else if (isServiceIds(field)) {
        <div class="block" [attr.data-field]="field.key">
          <app-service-selector
            [selectedIds]="productIds(b, field.key)"
            [max]="field.max"
            [label]="field.label"
            (selectedIdsChange)="setProductIds(b, field.key, $event)"
          />
          @if (field.hint) {
            <span class="mt-1 block text-[11px] text-[var(--color-text-secondary)]">{{ field.hint }}</span>
          }
        </div>
      } @else if (field.kind === 'conditions') {
        <fieldset class="space-y-2 rounded-xl border border-[var(--color-border)] p-3" [attr.data-field]="field.key" data-testid="builder-conditions">
          <legend class="px-1 text-xs font-semibold text-[var(--color-text-primary)]">{{ field.label }}</legend>
          @for (option of conditionOptions; track option.key) {
            <label class="flex items-center justify-between gap-2 text-xs">
              <span class="text-[var(--color-text-primary)]">{{ option.label }}</span>
              <select
                class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs"
                [attr.data-condition]="option.key"
                [attr.aria-label]="field.label + ': ' + option.label"
                [value]="conditionValue(b, field.key, option.key)"
                (change)="setCondition(b, field.key, option.key, $any($event.target).value)"
              >
                <option value="">Siempre</option>
                <option value="true">{{ option.yes }}</option>
                <option value="false">{{ option.no }}</option>
              </select>
            </label>
          }
          @if (field.hint) {
            <p class="text-[11px] text-[var(--color-text-secondary)]">{{ field.hint }}</p>
          }
        </fieldset>
      } @else if (isList(field)) {
        <fieldset class="space-y-2" [attr.data-field]="field.key">
          <legend class="flex w-full items-center justify-between text-xs font-semibold text-[var(--color-text-primary)]">
            <span>{{ field.label }}</span>
            <span class="font-normal text-[var(--color-text-secondary)]">{{ items(b, field).length }} / {{ field.max }}</span>
          </legend>
          @for (item of items(b, field); track $index; let i = $index; let first = $first; let last = $last) {
            <div class="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5" data-testid="builder-list-item">
              <div class="flex items-center justify-between">
                <span class="text-[11px] font-medium text-[var(--color-text-secondary)]">{{ field.itemLabel }} {{ i + 1 }}</span>
                <div class="flex items-center">
                  <button type="button" class="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-background)] disabled:opacity-30"
                          [disabled]="first" (click)="moveItem(b, field, i, i - 1)" [attr.aria-label]="'Subir ' + field.itemLabel">
                    <app-icon name="chevron-up" [size]="13" />
                  </button>
                  <button type="button" class="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-background)] disabled:opacity-30"
                          [disabled]="last" (click)="moveItem(b, field, i, i + 1)" [attr.aria-label]="'Bajar ' + field.itemLabel">
                    <app-icon name="chevron-down" [size]="13" />
                  </button>
                  <button type="button" class="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-background)] hover:text-[var(--color-error,#dc2626)]"
                          (click)="removeItem(b, field, i)" [attr.aria-label]="'Quitar ' + field.itemLabel" data-testid="builder-list-remove">
                    <app-icon name="trash-2" [size]="13" />
                  </button>
                </div>
              </div>
              @for (sub of field.item; track sub.key) {
                @if (sub.kind === 'media') {
                  <div class="block" [attr.data-subfield]="sub.key">
                    <span class="mb-1 block text-[11px] text-[var(--color-text-secondary)]">{{ sub.label }}</span>
                    <app-media-field
                      [value]="item[sub.key] ?? ''"
                      [appKind]="appKind()"
                      [compact]="true"
                      [ariaLabel]="sub.label"
                      (valueChange)="setItem(b, field, i, sub.key, $event)"
                    />
                  </div>
                } @else if (sub.kind === 'select') {
                  <label class="block" [attr.data-subfield]="sub.key">
                    <span class="mb-1 block text-[11px] text-[var(--color-text-secondary)]">{{ sub.label }}</span>
                    <select class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm"
                            (change)="setItem(b, field, i, sub.key, $any($event.target).value)">
                      <option value="" [selected]="!(item[sub.key] ?? '')">{{ sub.emptyLabel ?? 'Por defecto' }}</option>
                      @for (opt of sub.options; track opt.value) {
                        <option [value]="opt.value" [selected]="(item[sub.key] ?? '') === opt.value">{{ opt.label }}</option>
                      }
                    </select>
                  </label>
                } @else {
                  <label class="block" [attr.data-subfield]="sub.key">
                    <span class="mb-1 flex justify-between text-[11px] text-[var(--color-text-secondary)]">
                      <span>{{ sub.label }}</span>
                      @if (counter(sub); as max) { <span>{{ (item[sub.key] ?? '').length }}/{{ max }}</span> }
                    </span>
                    @if (sub.kind === 'textarea') {
                      <textarea rows="2" [attr.maxlength]="sub.max" [attr.placeholder]="sub.placeholder ?? null"
                                class="w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm"
                                [value]="item[sub.key] ?? ''" (input)="setItem(b, field, i, sub.key, $any($event.target).value)"></textarea>
                    } @else if (sub.kind === 'number') {
                      <input type="number" step="1" [attr.min]="sub.min" [attr.max]="sub.max"
                             class="w-24 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm"
                             [value]="item[sub.key] ?? ''" (input)="setItem(b, field, i, sub.key, $any($event.target).value)" />
                    } @else {
                      <input [type]="sub.kind === 'url' ? 'url' : 'text'" [attr.maxlength]="counter(sub)"
                             [attr.placeholder]="placeholder(sub)"
                             class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm"
                             [class.border-[var(--color-error,#dc2626)]]="urlError(item[sub.key], sub)"
                             [value]="item[sub.key] ?? ''" (input)="setItem(b, field, i, sub.key, $any($event.target).value)" />
                      @if (urlError(item[sub.key], sub)) {
                        <span class="mt-1 block text-[11px] text-[var(--color-error,#dc2626)]">Usa un enlace que empiece por https://</span>
                      }
                    }
                  </label>
                }
              }
            </div>
          } @empty {
            @if (field.emptyHint) {
              <p class="rounded-lg border border-dashed border-[var(--color-border)] px-3 py-2.5 text-xs text-[var(--color-text-secondary)]">{{ field.emptyHint }}</p>
            }
          }
          <div class="flex flex-wrap items-center gap-3">
            @if (isPureMediaList(field)) {
              <button type="button" class="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-primary)] hover:bg-[var(--color-background)] disabled:opacity-40"
                      [disabled]="items(b, field).length >= field.max"
                      (click)="openListMediaPicker(b, field)"
                      data-testid="builder-list-add-media">
                <app-icon name="images" [size]="13" /> Agregar desde galería
              </button>
            }
            <button type="button" class="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-primary)] disabled:opacity-40"
                    [disabled]="items(b, field).length >= field.max" (click)="addItem(b, field)" data-testid="builder-list-add">
              <app-icon name="plus" [size]="13" /> Agregar {{ field.itemLabel.toLowerCase() }}
            </button>
          </div>
        </fieldset>
      } @else if (field.kind === 'toggle') {
        <label class="flex items-start gap-2.5" [attr.data-field]="field.key">
          <input type="checkbox" class="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
                 [checked]="flag(b, field.key)" (change)="setValue(b, field.key, $any($event.target).checked)" />
          <span>
            <span class="block text-xs font-semibold text-[var(--color-text-primary)]">{{ field.label }}</span>
            @if (field.hint) {
              <span class="block text-[11px] text-[var(--color-text-secondary)]">{{ field.hint }}</span>
            }
          </span>
        </label>
      } @else if (field.kind === 'media') {
        <div class="block" [attr.data-field]="field.key">
          <span class="mb-1 block text-xs font-semibold text-[var(--color-text-primary)]">{{ field.label }}</span>
          <app-media-field
            [value]="text(b, field.key)"
            [appKind]="appKind()"
            [ariaLabel]="field.label"
            (valueChange)="setOptionalText(b, field.key, $event)"
          />
          @if (field.hint) {
            <span class="mt-1 block text-[11px] text-[var(--color-text-secondary)]">{{ field.hint }}</span>
          }
        </div>
      } @else if (field.kind === 'chips') {
        <div class="block" [attr.data-field]="field.key">
          <span class="mb-1.5 block text-xs font-semibold text-[var(--color-text-primary)]">{{ field.label }}</span>
          <div class="flex flex-wrap gap-1.5" role="group" [attr.aria-label]="field.label">
            <button
              type="button"
              class="rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors"
              [class]="!text(b, field.key)
                ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background)]'"
              [attr.aria-pressed]="!text(b, field.key)"
              data-testid="builder-chip-default"
              (click)="setValue(b, field.key, undefined)"
            >
              {{ field.emptyLabel ?? 'Por defecto' }}
            </button>
            @for (opt of field.options; track opt.value) {
              <button
                type="button"
                class="rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors"
                [class]="text(b, field.key) === opt.value
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-background)]'"
                [attr.aria-pressed]="text(b, field.key) === opt.value"
                [attr.data-testid]="'builder-chip-' + opt.value"
                (click)="setValue(b, field.key, opt.value)"
              >
                {{ opt.label }}
              </button>
            }
          </div>
          @if (field.hint) {
            <span class="mt-1 block text-[11px] text-[var(--color-text-secondary)]">{{ field.hint }}</span>
          }
        </div>
      } @else if (field.kind === 'select') {
        <label class="block" [attr.data-field]="field.key">
          <span class="mb-1 block text-xs font-semibold text-[var(--color-text-primary)]">{{ field.label }}</span>
          <select class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                  (change)="setOptionalText(b, field.key, $any($event.target).value)">
            <option value="" [selected]="!text(b, field.key)">{{ field.emptyLabel ?? 'Por defecto' }}</option>
            @for (opt of field.options; track opt.value) {
              <option [value]="opt.value" [selected]="text(b, field.key) === opt.value">{{ opt.label }}</option>
            }
          </select>
          @if (field.hint) {
            <span class="mt-1 block text-[11px] text-[var(--color-text-secondary)]">{{ field.hint }}</span>
          }
        </label>
      } @else if (field.kind === 'range') {
        <div class="block" [attr.data-field]="field.key">
          <div class="mb-1 flex items-center justify-between gap-2">
            <span class="text-xs font-semibold text-[var(--color-text-primary)]">{{ field.label }}</span>
            <div class="flex items-center gap-2">
              <span class="text-xs font-medium text-[var(--color-text-secondary)]" data-testid="builder-range-value">
                {{ rangeValueText(b, field) }}
              </span>
              @if (hasNumber(b, field.key)) {
                <button type="button" class="text-[11px] font-medium text-[var(--color-primary)] hover:underline"
                        data-testid="builder-range-reset"
                        (click)="setValue(b, field.key, undefined)">
                  Restablecer
                </button>
              }
            </div>
          </div>
          <input
            type="range"
            class="w-full cursor-pointer accent-[var(--color-primary)]"
            [attr.min]="field.min"
            [attr.max]="field.max"
            [attr.step]="field.step ?? 1"
            [value]="rangeValue(b, field)"
            [attr.aria-label]="field.label"
            [attr.aria-valuetext]="rangeValueText(b, field)"
            (input)="setNumber(b, field.key, $any($event.target).value)"
          />
          @if (field.hint) {
            <span class="mt-1 block text-[11px] text-[var(--color-text-secondary)]">{{ field.hint }}</span>
          }
        </div>
      } @else if (field.kind === 'color') {
        <div class="block" [attr.data-field]="field.key">
          <span class="mb-1 block text-xs font-semibold text-[var(--color-text-primary)]">{{ field.label }}</span>
          <div class="flex items-center gap-2">
            <input
              type="color"
              class="h-9 w-11 shrink-0 cursor-pointer rounded border border-[var(--color-border)] bg-transparent p-0.5"
              [value]="validHex(b, field.key) || '#ffffff'"
              [attr.aria-label]="field.label"
              (input)="setOptionalText(b, field.key, $any($event.target).value)"
            />
            <input
              type="text"
              maxlength="7"
              [attr.placeholder]="field.placeholder ?? '#RRGGBB'"
              class="w-full rounded-lg border bg-[var(--color-surface)] px-3 py-2 text-sm"
              [class]="colorError(b, field.key) ? 'border-[var(--color-error,#dc2626)]' : 'border-[var(--color-border)]'"
              [value]="text(b, field.key)"
              (input)="setOptionalText(b, field.key, $any($event.target).value)"
            />
            @if (text(b, field.key)) {
              <button type="button" class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background)]"
                      aria-label="Quitar color" title="Quitar color" data-testid="builder-color-clear"
                      (click)="setValue(b, field.key, undefined)">
                <app-icon name="x" [size]="14" />
              </button>
            }
          </div>
          @if (colorError(b, field.key)) {
            <span class="mt-1 block text-[11px] text-[var(--color-error,#dc2626)]">Usa un color hexadecimal #RRGGBB</span>
          } @else if (field.hint) {
            <span class="mt-1 block text-[11px] text-[var(--color-text-secondary)]">{{ field.hint }}</span>
          }
        </div>
      } @else {
        <label class="block" [attr.data-field]="field.key">
          <span class="mb-1 flex justify-between text-xs font-semibold text-[var(--color-text-primary)]">
            <span>{{ field.label }}</span>
            @if (counter(field); as max) {
              <span class="font-normal text-[var(--color-text-secondary)]">{{ text(b, field.key).length }}/{{ max }}</span>
            }
          </span>
          @if (field.kind === 'textarea') {
            <textarea rows="4" [attr.maxlength]="field.max" [attr.placeholder]="field.placeholder ?? null"
                      class="w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                      [value]="text(b, field.key)" (input)="setText(b, field.key, $any($event.target).value)"></textarea>
          } @else if (field.kind === 'number') {
            <input type="number" step="1" [attr.min]="field.min" [attr.max]="field.max"
                   class="w-28 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                   [value]="text(b, field.key)" (input)="setNumber(b, field.key, $any($event.target).value)" />
          } @else {
            <input [type]="field.kind === 'url' ? 'url' : 'text'" [attr.maxlength]="counter(field)"
                   [attr.placeholder]="placeholder(field)"
                   class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                   [class.border-[var(--color-error,#dc2626)]]="urlError(text(b, field.key), field)"
                   [value]="text(b, field.key)" (input)="setText(b, field.key, $any($event.target).value)" />
          }
          @if (urlError(text(b, field.key), field)) {
            <span class="mt-1 block text-[11px] text-[var(--color-error,#dc2626)]">Usa un enlace que empiece por https://</span>
          } @else if (field.hint) {
            <span class="mt-1 block text-[11px] text-[var(--color-text-secondary)]">{{ field.hint }}</span>
          }
        </label>
      }
    </ng-template>

    @if (pendingMediaList(); as target) {
      <app-app-media-picker
        [open]="true"
        [appKind]="appKind()"
        (close)="pendingMediaList.set(null)"
        (picked)="onListMediaPicked(target, $event)"
      />
    }
  `,
})
export class BuilderInspectorComponent {
  readonly catalog = input.required<BuilderCatalog>();
  readonly block = input<BuilderBlock | null>(null);
  readonly appKind = input<PageAppKind | null>(null);

  readonly propChange = output<BuilderPropChange>();
  /** Propaga productos resueltos por `app-product-selector` hacia el constructor para vista previa en vivo. */
  readonly productsResolved = output<AppPageProductItem[]>();

  /** Lista de imágenes esperando una nueva foto elegida desde la galería. */
  readonly pendingMediaList = signal<{ block: BuilderBlock; field: BuilderListFieldDef } | null>(null);

  readonly def = computed(() => {
    const b = this.block();
    return b ? blockDef(this.catalog(), b.type) ?? null : null;
  });

  readonly mainFields = computed<BuilderFieldDef[]>(() =>
    (this.def()?.fields ?? []).filter((f) => !('group' in f) || f.group !== 'appearance'),
  );

  readonly appearanceFields = computed<BuilderFieldDef[]>(() =>
    (this.def()?.fields ?? []).filter((f) => 'group' in f && f.group === 'appearance'),
  );

  readonly hasCustomAppearance = computed(() => {
    const b = this.block();
    if (!b) return false;
    return this.appearanceFields().some((f) => {
      const v = b.props[f.key];
      return v !== undefined && v !== null && v !== '';
    });
  });

  isList(field: BuilderFieldDef): field is BuilderListFieldDef {
    return field.kind === 'list';
  }

  isProductIds(field: BuilderFieldDef): field is BuilderProductIdsFieldDef {
    return field.kind === 'product_ids';
  }

  isServiceIds(field: BuilderFieldDef): field is BuilderServiceIdsFieldDef {
    return field.kind === 'service_ids';
  }

  readonly conditionOptions = APP_BLOCK_CONDITION_OPTIONS;

  /** `''` (siempre), `'true'` o `'false'` de una condición de `visible_when`. */
  conditionValue(block: BuilderBlock, key: string, condition: AppBlockConditionKey): string {
    const value = this.conditions(block, key)[condition];
    return typeof value === 'boolean' ? String(value) : '';
  }

  /** Cambia una condición; sin ninguna, la prop se quita (bloque siempre visible). */
  setCondition(block: BuilderBlock, key: string, condition: AppBlockConditionKey, raw: string): void {
    const next: AppBlockConditions = { ...this.conditions(block, key) };
    if (raw === 'true' || raw === 'false') next[condition] = raw === 'true';
    else delete next[condition];
    this.propChange.emit({ blockId: block.id, key, value: Object.keys(next).length ? next : undefined });
  }

  private conditions(block: BuilderBlock, key: string): AppBlockConditions {
    const raw = block.props[key];
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as AppBlockConditions) : {};
  }

  isFieldVisible(block: BuilderBlock, field: BuilderFieldDef): boolean {
    if (!('visibleWhen' in field) || !field.visibleWhen) return true;
    return block.props[field.visibleWhen.key] === field.visibleWhen.value;
  }

  productIds(block: BuilderBlock, key: string): number[] {
    const raw = block.props[key];
    return Array.isArray(raw)
      ? raw.filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1)
      : [];
  }

  setProductIds(block: BuilderBlock, key: string, ids: number[]): void {
    this.propChange.emit({ blockId: block.id, key, value: ids.length > 0 ? ids : undefined });
  }

  isPureMediaList(field: BuilderListFieldDef): boolean {
    return field.item.length === 1 && field.item[0].kind === 'media';
  }

  text(block: BuilderBlock, key: string): string {
    const value = block.props[key];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  }

  hasNumber(block: BuilderBlock, key: string): boolean {
    const value = block.props[key];
    return typeof value === 'number' && Number.isFinite(value);
  }

  numeric(block: BuilderBlock, key: string): number {
    const value = block.props[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  /** Valor por defecto real de un control deslizante cuando la prop no está definida. */
  rangeDefault(block: BuilderBlock, field: Extract<BuilderScalarFieldDef, { kind: 'range' }>): number {
    if (field.defaultByProp) {
      const propVal = block.props[field.defaultByProp.key];
      if (typeof propVal === 'string' && propVal in field.defaultByProp.values) {
        return field.defaultByProp.values[propVal];
      }
    }
    return field.defaultValue ?? field.min;
  }

  rangeValue(block: BuilderBlock, field: Extract<BuilderScalarFieldDef, { kind: 'range' }>): number {
    return this.hasNumber(block, field.key) ? this.numeric(block, field.key) : this.rangeDefault(block, field);
  }

  /** Texto legible para etiqueta y `aria-valuetext` (p. ej. "Por defecto (40 %)" o "40 %"). */
  rangeValueText(block: BuilderBlock, field: Extract<BuilderScalarFieldDef, { kind: 'range' }>): string {
    const val = this.rangeValue(block, field);
    const unit = field.unit ?? '';
    const formatted = unit === '%' ? `${val} %` : `${val}${unit}`;
    return this.hasNumber(block, field.key) ? formatted : `Por defecto (${formatted})`;
  }

  validHex(block: BuilderBlock, key: string): string | null {
    const value = this.text(block, key).trim();
    return HEX_COLOR_RE.test(value) ? value : null;
  }

  colorError(block: BuilderBlock, key: string): boolean {
    const value = this.text(block, key).trim();
    return value.length > 0 && !HEX_COLOR_RE.test(value);
  }

  items(block: BuilderBlock, field: BuilderListFieldDef): BuilderListItem[] {
    return readListItems(field, block.props[field.key]);
  }

  /** Character limit shown next to a text field; `null` for links, numbers and switches. */
  counter(field: BuilderScalarFieldDef): number | null {
    return field.kind === 'text' || field.kind === 'textarea' ? field.max : null;
  }

  placeholder(field: BuilderScalarFieldDef): string | null {
    return 'placeholder' in field ? (field.placeholder ?? null) : null;
  }

  flag(block: BuilderBlock, key: string): boolean {
    return block.props[key] === true;
  }

  urlError(value: string | undefined, field: BuilderScalarFieldDef): boolean {
    if (field.kind !== 'url') return false;
    const v = (value ?? '').trim();
    return v.length > 0 && !/^https:\/\/\S+$/i.test(v);
  }

  setText(block: BuilderBlock, key: string, value: string): void {
    this.propChange.emit({ blockId: block.id, key, value });
  }

  /** Emite `undefined` cuando el campo opcional se vacía para conservar el comportamiento por defecto. */
  setOptionalText(block: BuilderBlock, key: string, value: string): void {
    const trimmed = value.trim();
    this.propChange.emit({ blockId: block.id, key, value: trimmed ? value : undefined });
  }

  setValue(block: BuilderBlock, key: string, value: unknown): void {
    this.propChange.emit({ blockId: block.id, key, value });
  }

  /** A whole number, or the key removed when the field is emptied. */
  setNumber(block: BuilderBlock, key: string, raw: string): void {
    const n = Number(raw);
    this.propChange.emit({ blockId: block.id, key, value: raw.trim() === '' || !Number.isFinite(n) ? undefined : Math.trunc(n) });
  }

  setItem(block: BuilderBlock, field: BuilderListFieldDef, index: number, key: string, value: string): void {
    const items = this.items(block, field);
    items[index] = { ...items[index], [key]: value };
    this.writeItems(block, field, items);
  }

  addItem(block: BuilderBlock, field: BuilderListFieldDef): void {
    const items = this.items(block, field);
    if (items.length >= field.max) return;
    items.push(Object.fromEntries(field.item.map((f) => [f.key, ''])));
    this.writeItems(block, field, items);
  }

  openListMediaPicker(block: BuilderBlock, field: BuilderListFieldDef): void {
    if (this.items(block, field).length >= field.max) return;
    this.pendingMediaList.set({ block, field });
  }

  onListMediaPicked(target: { block: BuilderBlock; field: BuilderListFieldDef }, item: AppMediaItem): void {
    this.pendingMediaList.set(null);
    if (!item.url) return;
    const items = this.items(target.block, target.field);
    if (items.length >= target.field.max) return;
    const key = target.field.item[0]?.key ?? 'value';
    items.push({ [key]: item.url });
    this.writeItems(target.block, target.field, items);
  }

  removeItem(block: BuilderBlock, field: BuilderListFieldDef, index: number): void {
    const items = this.items(block, field);
    items.splice(index, 1);
    this.writeItems(block, field, items);
  }

  moveItem(block: BuilderBlock, field: BuilderListFieldDef, from: number, to: number): void {
    const items = this.items(block, field);
    if (to < 0 || to >= items.length) return;
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item);
    this.writeItems(block, field, items);
  }

  /**
   * Items are written as typed: an item being filled in must not vanish. The
   * editor drops blank items on save (`cleanBlockLists`).
   */
  private writeItems(block: BuilderBlock, field: BuilderListFieldDef, items: BuilderListItem[]): void {
    this.propChange.emit({ blockId: block.id, key: field.key, value: items });
  }
}
