/**
 * Renderiza UN campo del registro de edición masiva de clientes.
 *
 * Es el único sitio del módulo que traduce `BulkCustomerControlType` a un
 * componente compartido concreto, igual que en el masivo de productos: si el
 * `@switch` viviera dentro del `@for` de grupos del panel, el template del panel
 * sería ilegible y cada ajuste de un control obligaría a releerlo entero.
 *
 * ## Activado ≠ tiene valor
 *
 * El contrato del backend es cerrado (`forbidNonWhitelisted`), pero eso no es lo
 * que hace peligroso mandar un campo de más: mandar `price_tier_id` sin que el
 * usuario lo pidiera cambiaría la tarifa de 100 clientes en silencio. Por eso la
 * casilla de activación es explícita por campo y el control solo se pinta cuando
 * está activada.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';

import {
  IconComponent,
  InputButtonsComponent,
  InputComponent,
  MultiSelectorComponent,
  SelectorComponent,
  SettingToggleComponent,
  type InputButtonOption,
  type MultiSelectorOption,
  type SelectorOption,
} from '../../../../../shared/components/index';
import type { BulkCustomerField } from './bulk-editable-customer-fields.constant';

@Component({
  selector: 'app-bulk-customer-field-control',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    IconComponent,
    InputComponent,
    InputButtonsComponent,
    MultiSelectorComponent,
    SelectorComponent,
    SettingToggleComponent,
  ],
  template: `
    <div
      class="rounded-xl border transition-colors"
      [class.border-border]="!active()"
      [class.bg-surface]="!active()"
      [class.border-primary]="active()"
      [class.bg-primary-50]="active()"
    >
      <label class="flex cursor-pointer items-start gap-2.5 p-3">
        <input
          type="checkbox"
          class="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
          [checked]="active()"
          (change)="onToggleActive($event)"
          [attr.aria-label]="'Aplicar ' + field().label"
        />

        <span class="min-w-0 flex-1">
          <span class="block text-xs font-semibold text-text-primary">
            {{ field().label }}
          </span>
          @if (field().description) {
            <span class="mt-0.5 block text-[10px] leading-tight text-text-secondary">
              {{ field().description }}
            </span>
          }
        </span>
      </label>

      @if (active()) {
        <div class="border-t border-border/60 p-3" [formGroup]="form()">
          @switch (field().control) {
            @case ('toggle') {
              <app-setting-toggle
                [formControlName]="field().key"
                label="Nuevo valor"
                description="Activado: se marca en todos los seleccionados. Desactivado: se desmarca en todos."
              />
            }

            @case ('selector') {
              <app-selector
                [formControlName]="field().key"
                [options]="options()"
                placeholder="Selecciona un valor"
                size="sm"
              />
            }

            @case ('price-tier') {
              <app-selector
                [formControlName]="field().key"
                [options]="options()"
                placeholder="Elige una tarifa"
                size="sm"
              />
              <p class="mt-1.5 text-[10px] leading-tight text-text-secondary">
                «Sin tarifa» deja al cliente sin tarifa preferencial en esta
                tienda. Un cliente tiene UNA sola tarifa: asignar sobrescribe la
                que tuviera.
              </p>
            }

            @case ('multiselect') {
              <app-multi-selector
                [formControlName]="field().key"
                [options]="multiOptions()"
                placeholder="Selecciona una o varias"
                size="sm"
              />
            }

            @case ('tag-action') {
              <div class="flex flex-col gap-2" [formGroupName]="field().key">
                <app-input-buttons
                  formControlName="mode"
                  [options]="tagModeOptions"
                />
                <app-multi-selector
                  formControlName="ids"
                  [options]="multiOptions()"
                  placeholder="Etiquetas a aplicar"
                  size="sm"
                />
                <p class="text-[10px] leading-tight text-text-secondary">
                  Añadir no quita nada y quitar no añade nada: cada cliente
                  conserva sus otras etiquetas.
                </p>
              </div>
            }

            @default {
              <app-input
                [formControlName]="field().key"
                size="sm"
                [maxlength]="field().maxLength ?? null"
                placeholder="Nuevo valor"
              />
            }
          }
        </div>
      }
    </div>
  `,
})
export class BulkCustomerFieldControlComponent {
  readonly field = input.required<BulkCustomerField>();
  readonly form = input.required<FormGroup>();
  readonly active = input<boolean>(false);
  /** Catálogo dinámico ya resuelto por la página (`optionsRef`). */
  readonly dynamicOptions = input<readonly SelectorOption[]>([]);

  readonly activeChange = output<boolean>();

  /** Modos de la acción de etiquetas. */
  readonly tagModeOptions: InputButtonOption[] = [
    { value: 'add', label: 'Añadir' },
    { value: 'remove', label: 'Quitar' },
  ];

  /**
   * Opciones a pintar.
   *
   * Se copian a un arreglo mutable porque los inputs de los componentes
   * compartidos declaran `T[]` y el registro es `readonly`.
   */
  readonly options = computed<SelectorOption[]>(() => {
    const field = this.field();
    if (field.optionsRef) {
      return [...this.dynamicOptions()];
    }
    return [...((field.options ?? []) as readonly SelectorOption[])];
  });

  readonly multiOptions = computed<MultiSelectorOption[]>(() =>
    this.options().map((option) => ({
      value: option.value,
      label: option.label,
    })),
  );

  onToggleActive(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.activeChange.emit(Boolean(target?.checked));
  }
}
