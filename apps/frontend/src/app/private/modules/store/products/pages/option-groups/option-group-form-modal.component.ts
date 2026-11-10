import { Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import {
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Subject, catchError, of, switchMap } from 'rxjs';

import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  InputsearchComponent,
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
import {
  OptionComponentProduct,
  OptionComponentSearchService,
  deduceComponentType,
} from './option-component-search.service';

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

const COMPONENT_TYPE_LABELS: Record<'ingredient' | 'recipe' | 'product', string> = {
  ingredient: 'Insumo',
  recipe: 'Preparación',
  product: 'Producto',
};

/**
 * Crear / editar un grupo de adiciones. Cada adición exige un componente
 * (insumo, preparación o producto): no existe adición de texto libre.
 * "Agregar adición" muestra solo un buscador; al elegir el producto la
 * adición aparece con nombre, unidad, cantidad y precio precargados.
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
    InputsearchComponent,
    SelectorComponent,
    MultiSelectorComponent,
    SettingToggleComponent,
  ],
  templateUrl: './option-group-form-modal.component.html',
})
export class OptionGroupFormModalComponent {
  private readonly groupsService = inject(OptionGroupsService);
  private readonly uomService = inject(UomService);
  private readonly searchService = inject(OptionComponentSearchService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = input(false);
  readonly group = input<ProductOptionGroup | null>(null);
  readonly isSubmitting = input(false);

  readonly cancel = output<void>();
  readonly save = output<SaveProductOptionGroupDto>();

  readonly scopeOptions = SCOPE_OPTIONS;

  /** Error de validación de las adiciones (cliente). */
  readonly optionsError = signal<string | null>(null);

  /** Catalog used for the "Productos" selector and to resolve images of saved add-ons. */
  private readonly products = toSignal(
    this.searchService.search('', 200).pipe(catchError(() => of([] as OptionComponentProduct[]))),
    { initialValue: [] as OptionComponentProduct[] },
  );

  /** True while the add-on search box is open (it replaces the new-row fields). */
  readonly adding = signal(false);
  readonly searchLoading = signal(false);
  readonly searchResults = signal<OptionComponentProduct[]>([]);
  /** Products picked during this session, kept so their image survives a later search. */
  private readonly picked = signal<Map<number, OptionComponentProduct>>(new Map());
  private readonly search$ = new Subject<string>();

  private readonly productById = computed(() => {
    const map = new Map<number, OptionComponentProduct>();
    for (const p of this.products()) map.set(p.id, p);
    for (const [id, p] of this.picked()) map.set(id, p);
    return map;
  });
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
      this.adding.set(false);
      this.patch(current);
    });

    this.search$
      .pipe(
        switchMap((term) => {
          this.searchLoading.set(true);
          return this.searchService
            .search(term)
            .pipe(catchError(() => of([] as OptionComponentProduct[])));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((rows) => {
        this.searchResults.set(rows);
        this.searchLoading.set(false);
      });
  }

  imageOf(row: OptionRowForm): string | null {
    const id = row.controls.component_product_id.value;
    return id == null ? null : (this.productById().get(id)?.image_url ?? null);
  }

  componentNameOf(row: OptionRowForm): string {
    const id = row.controls.component_product_id.value;
    return (id != null ? this.productById().get(id)?.name : null) ?? '';
  }

  typeLabelOf(row: OptionRowForm): string {
    return COMPONENT_TYPE_LABELS[row.controls.component_type.value];
  }

  openAdd(): void {
    this.adding.set(true);
    this.optionsError.set(null);
    this.searchResults.set([]);
    this.search$.next('');
  }

  closeAdd(): void {
    this.adding.set(false);
  }

  onSearch(term: string): void {
    this.search$.next(term ?? '');
  }

  /** Adds the add-on prefilled from the product; every field stays editable. */
  pickProduct(product: OptionComponentProduct): void {
    this.picked.update((m) => new Map(m).set(product.id, product));
    const row = this.newRow();
    row.patchValue({
      name: product.name,
      price_delta: String(Number(product.base_price) || 0),
      component_type: deduceComponentType(product),
      component_product_id: product.id,
      quantity: '1',
      uom: product.stock_uom?.code ?? '',
    });
    this.form.controls.options.push(row);
    this.adding.set(false);
    this.optionsError.set(null);
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
