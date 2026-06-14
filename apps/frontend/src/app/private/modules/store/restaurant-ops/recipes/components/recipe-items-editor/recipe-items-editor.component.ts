import {
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  SettingToggleComponent,
  ToastService,
} from '../../../../../../../shared/components/index';

import { RecipeIngredientOption, RecipeItemFormControls } from '../../interfaces';
import { RecipeIngredientsService } from '../../services';

/**
 * Editor for the `recipe_items` FormArray. Owns:
 *  - the product selector (ingredients for recipes, sellable products for
 *    combo components),
 *  - quantity + waste percent inputs,
 *  - the optional flag,
 *  - add / remove row actions.
 *
 * It is a presentational + minimal-logic component: it does not talk to the
 * backend directly. The parent form drives the network calls.
 */
@Component({
  selector: 'app-recipe-items-editor',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    SettingToggleComponent,
  ],
  templateUrl: './recipe-items-editor.component.html',
  styleUrl: './recipe-items-editor.component.scss',
})
export class RecipeItemsEditorComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly ingredientsService = inject(RecipeIngredientsService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  /** The FormArray<FormGroup<...>> owned by the parent form. */
  readonly items = input.required<FormArray<FormGroup<RecipeItemFormControls>>>();

  /** Emitted when a row is added/removed so the parent can recompute stats. */
  readonly itemsChanged = output<void>();

  readonly ingredients = signal<RecipeIngredientOption[]>([]);
  readonly isLoadingIngredients = signal(false);

  /** Options for the per-row inline component selector. */
  readonly componentOptions = computed<SelectorOption[]>(() =>
    this.ingredients().map((i) => ({
      value: i.id,
      label: i.name + (i.sku ? ` (${i.sku})` : ''),
      description: i.stock_unit ? `Unidad: ${i.stock_unit}` : undefined,
    })),
  );

  /** Placeholder shown by the inline selector, reactive to the loading state. */
  readonly selectorPlaceholder = computed(() =>
    this.isLoadingIngredients() ? 'Cargando insumos…' : 'Selecciona un componente',
  );

  ngOnInit(): void {
    this.loadIngredients();
  }

  private loadIngredients(): void {
    this.isLoadingIngredients.set(true);
    this.ingredientsService
      .listIngredients()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.ingredients.set(list);
          this.isLoadingIngredients.set(false);
        },
        error: () => {
          this.toastService.error('No se pudieron cargar los ingredientes');
          this.isLoadingIngredients.set(false);
        },
      });
  }

  addItem(): void {
    const items = this.items();
    items.push(
      this.fb.nonNullable.group<RecipeItemFormControls>({
        id: this.fb.nonNullable.control<number | null>(null),
        component_product_id: this.fb.nonNullable.control<number | null>(null, {
          validators: [Validators.required],
        }),
        quantity: this.fb.nonNullable.control<number | null>(0, {
          validators: [Validators.required, Validators.min(0)],
        }),
        waste_percent: this.fb.nonNullable.control<number | null>(0, {
          validators: [Validators.min(0), Validators.max(100)],
        }),
        is_optional: this.fb.nonNullable.control(false),
      }),
    );
    this.itemsChanged.emit();
  }

  removeItem(index: number): void {
    this.items().removeAt(index);
    this.itemsChanged.emit();
  }

  /**
   * Returns the option label for a given product_id without doing an extra
   * async lookup — uses the cached `ingredients()` signal.
   */
  productLabel(productId: number | null | undefined): string {
    if (productId == null) return 'Selecciona un componente';
    const found = this.ingredients().find((i) => i.id === productId);
    if (found) {
      return found.name + (found.sku ? ` (${found.sku})` : '');
    }
    return `Producto #${productId}`;
  }

  productUnit(productId: number | null | undefined): string {
    if (productId == null) return '';
    const found = this.ingredients().find((i) => i.id === productId);
    return found?.stock_unit ?? '';
  }

  /**
   * A row is "unsaved" when it has no persisted `id` yet. The parent form's
   * create/update/delete reconciliation relies on the same `id` field, so this
   * is an authoritative state (not a fragile heuristic).
   */
  isUnsaved(row: FormGroup<RecipeItemFormControls>): boolean {
    return row.get('id')?.value == null;
  }
}
