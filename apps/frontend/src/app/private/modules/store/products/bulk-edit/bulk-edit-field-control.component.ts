/**
 * Renderiza UN campo del registro de edición masiva (QUI-567).
 *
 * Es el único sitio del módulo que traduce `BulkEditControlType` a un
 * componente compartido concreto. Se extrae del panel de cambios por una razón
 * práctica: si el `@switch` de los 8 tipos de control viviera dentro del `@for`
 * de grupos del panel, el template del panel sería ilegible y cada ajuste de un
 * control obligaría a releerlo entero.
 *
 * No tiene estado propio: el `FormGroup` y el conjunto de campos activados
 * viven en la página (`ProductsBulkEditPageComponent`), que es quien necesita
 * construir el payload final. Aquí solo se pinta el control y se emite el
 * toggle de activación.
 *
 * ## Activado ≠ tiene valor
 *
 * El contrato del backend es cerrado (`forbidNonWhitelisted: true`), pero eso
 * no es lo que hace peligroso mandar un campo de más: mandar `sale_price` sin
 * que el usuario lo haya pedido cambiaría 100 productos en silencio. Por eso la
 * casilla de activación es explícita por campo y el control solo se pinta
 * cuando está activada.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';

import {
  IconComponent,
  InputButtonsComponent,
  InputComponent,
  MultiSelectorComponent,
  SelectorComponent,
  SettingToggleComponent,
  TaxInclusiveChipComponent,
  TextareaComponent,
  type InputButtonOption,
  type MultiSelectorOption,
  type SelectorOption,
} from '../../../../../shared/components/index';
import { describeBulkEditIndustryRequirement } from './bulk-editable-fields.constant';
import type { BulkEditableField } from './bulk-edit.interface';
import type { TaxCategory } from '../interfaces';

@Component({
  selector: 'app-bulk-edit-field-control',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    IconComponent,
    InputComponent,
    SelectorComponent,
    MultiSelectorComponent,
    TaxInclusiveChipComponent,
    TextareaComponent,
    SettingToggleComponent,
    InputButtonsComponent,
  ],
  templateUrl: './bulk-edit-field-control.component.html',
})
export class BulkEditFieldControlComponent {
  /** Metadatos declarativos del campo. */
  readonly field = input.required<BulkEditableField>();
  /** `FormGroup` con un control por campo, creado una sola vez por la página. */
  readonly form = input.required<FormGroup>();
  /** `true` si el usuario marcó este campo para aplicarlo. */
  readonly active = input<boolean>(false);
  /** Opciones del catálogo dinámico que corresponda (`optionsRef`). */
  readonly dynamicOptions = input<readonly SelectorOption[]>([]);
  /** Catálogo completo de categorías de impuestos para chips interactivos. */
  readonly taxCategories = input<readonly TaxCategory[]>([]);
  /**
   * `true` cuando el campo del que este depende (`dependsOn`) no está activado.
   * No bloquea nada — el backend no valida la dependencia — pero se avisa para
   * que el operador no active `sale_price` creyendo que activó la oferta.
   */
  readonly dependencyPending = input<boolean>(false);

  /** IDs de impuestos actualmente seleccionados (reactivo para los chips). */
  readonly selectedTaxIds = signal<number[]>([]);
  /** Mapa local de conmutación de estado inclusivo (true = incluido, false = adicional). */
  readonly taxInclusiveMap = signal<Record<number, boolean>>({});

  constructor() {
    effect(() => {
      if (this.active() && this.field().key === 'tax_category_action') {
        const group = this.form().get(this.field().key) as FormGroup | null;
        const current = group?.get('ids')?.value;
        if (Array.isArray(current)) {
          untracked(() => this.selectedTaxIds.set(current.map(Number)));
        }
      }
    });
  }

  /** El usuario activó o desactivó el campo. */
  readonly activeChange = output<boolean>();

  /**
   * Opciones a pintar: estáticas del registro o del catálogo dinámico.
   *
   * Se copian a un arreglo mutable porque `app-selector` declara
   * `input<SelectorOption[]>` y un `readonly T[]` no es asignable a `T[]`; el
   * registro es `as const`, así que la copia es obligatoria, no cosmética.
   */
  readonly options = computed<SelectorOption[]>(() => {
    const field = this.field();
    if (field.optionsRef) {
      return [...this.dynamicOptions()];
    }
    return [...((field.options ?? []) as readonly SelectorOption[])];
  });

  /** `app-input-buttons` exige `value: string`, no `string | number`. */
  readonly buttonOptions = computed<InputButtonOption[]>(() =>
    this.options().map((option) => ({
      value: String(option.value),
      label: option.label,
    })),
  );

  /** Modos de operación para edición masiva de impuestos. */
  readonly taxActionModeOptions: InputButtonOption[] = [
    { value: 'add', label: 'Añadir' },
    { value: 'remove', label: 'Quitar' },
    { value: 'replace', label: 'Reemplazar' },
  ];

  /** Opciones de impuestos formateadas para `app-multi-selector`. */
  readonly multiSelectorTaxOptions = computed<MultiSelectorOption[]>(() =>
    this.options().map((option) => ({
      value: option.value,
      label: option.label,
    })),
  );

  /** Chips de impuestos seleccionados con estado de inclusión y botón de remoción rápida. */
  readonly selectedTaxChips = computed(() => {
    const ids = this.selectedTaxIds();
    const allTaxes = this.taxCategories();
    const map = this.taxInclusiveMap();

    return ids
      .map((id) => allTaxes.find((t) => t.id === id))
      .filter((t): t is TaxCategory => !!t)
      .map((tax) => {
        const rawRate = tax.rate ?? tax.tax_rates?.[0]?.rate ?? 0;
        const rate = parseFloat(String(rawRate));
        const finalRate = isNaN(rate) ? 0 : rate > 1 ? rate : rate * 100;
        const isInclusive =
          map[tax.id] !== undefined
            ? map[tax.id]
            : !!(tax.is_inclusive ?? tax.tax_rates?.[0]?.is_inclusive ?? false);

        return {
          id: tax.id,
          name: tax.name,
          rate: Math.round(finalRate * 100) / 100,
          inclusive: isInclusive,
          hint: isInclusive
            ? 'Impuesto configurado como incluido en el precio unitario.'
            : 'Impuesto configurado como adicional sobre el subtotal.',
        };
      });
  });

  onTaxIdsChange(values: (string | number)[]): void {
    this.selectedTaxIds.set(values.map(Number));
  }

  setTaxInclusive(taxId: number, isInclusive: boolean): void {
    this.taxInclusiveMap.update((m) => ({ ...m, [taxId]: isInclusive }));
  }

  removeTaxId(id: number): void {
    const next = this.selectedTaxIds().filter((val) => val !== id);
    this.selectedTaxIds.set(next);
    const group = this.form().get(this.field().key) as FormGroup | null;
    const idsCtrl = group?.get('ids');
    if (idsCtrl) {
      idsCtrl.setValue(next);
      idsCtrl.markAsDirty();
    }
  }

  /** Modo actual de la acción de impuestos para renderizado condicional del aviso. */
  get taxActionMode(): string {
    const group = this.form().get(this.field().key) as FormGroup | null;
    return group?.get('mode')?.value ?? 'add';
  }

  /** Etiqueta de la industria/capacidad que exige el campo (badge de motivo). */
  readonly industryRequirement = computed<string | null>(() =>
    describeBulkEditIndustryRequirement(this.field()),
  );

  /** Nombre del campo del que depende, ya humanizado para el aviso. */
  readonly dependsOnKey = computed<string>(() => this.field().dependsOn ?? '');

  onToggleActive(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.activeChange.emit(Boolean(target?.checked));
  }
}
