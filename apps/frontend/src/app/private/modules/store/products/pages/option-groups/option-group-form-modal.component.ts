import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import {
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';

import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  MultiSelectorComponent,
  SelectorComponent,
  SelectorOption,
  SettingToggleComponent,
} from '../../../../../../shared/components/index';
import { UomService } from '../../../inventory/services/uom.service';
import {
  OptionGroupsService,
  ProductOptionGroup,
  SaveProductOptionGroupDto,
} from '../../services/option-groups.service';

export const OPTION_COMPONENT_REQUIRED_MESSAGE =
  'Cada adición debe tener un insumo, una preparación o un producto asociado.';

type OptionRowForm = FormGroup<{
  id: FormControl<number | null>;
  name: FormControl<string>;
  price_delta: FormControl<string>;
  component_type: FormControl<'ingredient' | 'recipe' | 'product'>;
  component_product_id: FormControl<number | null>;
  quantity: FormControl<string>;
  uom: FormControl<string>;
  estimated_cost: FormControl<string | null>;
}>;

const SCOPE_OPTIONS: SelectorOption[] = [
  { value: 'per_unit', label: 'Por unidad', description: 'Se aplica a cada unidad de la línea.' },
  { value: 'per_line', label: 'Por línea', description: 'Se aplica una sola vez a toda la línea.' },
];

const COMPONENT_TYPE_OPTIONS: SelectorOption[] = [
  { value: 'ingredient', label: 'Insumo' },
  { value: 'recipe', label: 'Preparación' },
  { value: 'product', label: 'Producto' },
];

/**
 * Crear / editar un grupo de adiciones. Cada adición exige un componente
 * (insumo, preparación o producto): no existe adición de texto libre.
 */
@Component({
  selector: 'app-option-group-form-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    MultiSelectorComponent,
    SettingToggleComponent,
  ],
  templateUrl: './option-group-form-modal.component.html',
})
export class OptionGroupFormModalComponent {
  private readonly groupsService = inject(OptionGroupsService);
  private readonly uomService = inject(UomService);

  readonly isOpen = input(false);
  readonly group = input<ProductOptionGroup | null>(null);
  readonly isSubmitting = input(false);

  readonly cancel = output<void>();
  readonly save = output<SaveProductOptionGroupDto>();

  readonly scopeOptions = SCOPE_OPTIONS;
  readonly componentTypeOptions = COMPONENT_TYPE_OPTIONS;

  /** Error de validación de las adiciones (cliente). */
  readonly optionsError = signal<string | null>(null);

  private readonly products = toSignal(
    this.groupsService.listProducts().pipe(catchError(() => of([]))),
    { initialValue: [] },
  );
  private readonly categories = toSignal(
    this.groupsService.listCategories().pipe(catchError(() => of([]))),
    { initialValue: [] },
  );
  private readonly uoms = toSignal(
    this.uomService.getCatalog().pipe(catchError(() => of({ success: false, data: [] }))),
    { initialValue: { success: true, data: [] } },
  );

  readonly productOptions = computed<SelectorOption[]>(() =>
    this.products().map((p) => ({
      value: p.id,
      label: p.name + (p.sku ? ` (${p.sku})` : ''),
    })),
  );
  readonly categoryOptions = computed(() =>
    this.categories().map((c) => ({ value: c.id, label: c.name })),
  );
  readonly uomOptions = computed<SelectorOption[]>(() =>
    (this.uoms().data ?? []).map((u) => ({ value: u.code, label: `${u.name} (${u.code})` })),
  );

  readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(120)],
    }),
    description: new FormControl('', { nonNullable: true }),
    min_select: new FormControl('0', { nonNullable: true }),
    max_select: new FormControl('1', { nonNullable: true }),
    is_required: new FormControl(false, { nonNullable: true }),
    scope: new FormControl<'per_unit' | 'per_line'>('per_unit', { nonNullable: true }),
    is_active: new FormControl(true, { nonNullable: true }),
    options: new FormArray<OptionRowForm>([]),
    product_ids: new FormControl<Array<string | number>>([], { nonNullable: true }),
    category_ids: new FormControl<Array<string | number>>([], { nonNullable: true }),
  });

  get optionRows(): OptionRowForm[] {
    return this.form.controls.options.controls;
  }

  constructor() {
    effect(() => {
      const open = this.isOpen();
      const current = this.group();
      if (!open) return;
      this.optionsError.set(null);
      this.patch(current);
    });
  }

  private newRow(
    option?: ProductOptionGroup['options'][number],
  ): OptionRowForm {
    return new FormGroup({
      id: new FormControl<number | null>(option?.id ?? null),
      name: new FormControl(option?.name ?? '', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(120)],
      }),
      price_delta: new FormControl(String(option?.price_delta ?? '0'), { nonNullable: true }),
      component_type: new FormControl<'ingredient' | 'recipe' | 'product'>(
        option?.component_type ?? 'ingredient',
        { nonNullable: true },
      ),
      component_product_id: new FormControl<number | null>(option?.component_product_id ?? null),
      quantity: new FormControl(String(option?.quantity ?? '1'), { nonNullable: true }),
      uom: new FormControl(option?.uom ?? '', { nonNullable: true }),
      estimated_cost: new FormControl<string | null>(option?.estimated_cost ?? null),
    });
  }

  private patch(group: ProductOptionGroup | null): void {
    const options = this.form.controls.options;
    options.clear();
    if (group) {
      group.options
        .filter((o) => o.is_active !== false)
        .forEach((o) => options.push(this.newRow(o)));
      this.form.patchValue({
        name: group.name,
        description: group.description ?? '',
        min_select: String(group.min_select),
        max_select: String(group.max_select),
        is_required: group.is_required,
        scope: group.scope,
        is_active: group.is_active,
        product_ids: group.assignments.filter((a) => a.product_id != null).map((a) => a.product_id as number),
        category_ids: group.assignments.filter((a) => a.category_id != null).map((a) => a.category_id as number),
      });
    } else {
      options.push(this.newRow());
      this.form.reset({
        name: '',
        description: '',
        min_select: '0',
        max_select: '1',
        is_required: false,
        scope: 'per_unit',
        is_active: true,
        product_ids: [],
        category_ids: [],
      });
    }
  }

  addOption(): void {
    this.form.controls.options.push(this.newRow());
  }

  removeOption(index: number): void {
    this.form.controls.options.removeAt(index);
    this.optionsError.set(null);
  }

  submit(): void {
    this.form.markAllAsTouched();
    const v = this.form.getRawValue();
    if (this.form.controls.name.invalid || v.options.length === 0) {
      this.optionsError.set(v.options.length === 0 ? 'Agrega al menos una adición.' : null);
      return;
    }
    if (this.optionRows.some((r) => r.controls.name.invalid)) {
      this.optionsError.set('Cada adición necesita un nombre.');
      return;
    }
    if (v.options.some((o) => o.component_product_id == null)) {
      this.optionsError.set(OPTION_COMPONENT_REQUIRED_MESSAGE);
      return;
    }
    if (v.options.some((o) => !(Number(o.quantity) > 0))) {
      this.optionsError.set('La cantidad de cada adición debe ser mayor que cero.');
      return;
    }
    const min = Number(v.min_select);
    const max = Number(v.max_select);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < 1 || min > max) {
      this.optionsError.set('Revisa el mínimo y el máximo de selección.');
      return;
    }
    this.optionsError.set(null);

    const dto: SaveProductOptionGroupDto = {
      name: v.name.trim(),
      ...(v.description.trim() ? { description: v.description.trim() } : {}),
      min_select: min,
      max_select: max,
      is_required: v.is_required,
      scope: v.scope,
      is_active: v.is_active,
      options: v.options.map((o) => ({
        ...(o.id != null ? { id: o.id } : {}),
        name: o.name.trim(),
        price_delta: Number(o.price_delta) || 0,
        component_type: o.component_type,
        component_product_id: o.component_product_id as number,
        quantity: Number(o.quantity),
        ...(o.uom ? { uom: o.uom } : {}),
      })),
      assignments: [
        ...v.product_ids.map((id) => ({ product_id: Number(id) })),
        ...v.category_ids.map((id) => ({ category_id: Number(id) })),
      ],
    };
    this.save.emit(dto);
  }
}
