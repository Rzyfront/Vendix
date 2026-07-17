import {
  Component,
  computed,
  DestroyRef,
  effect,
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
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';

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
import { UomService, UnitOfMeasure } from '../../../../inventory/services/uom.service';
import { ProductsService } from '../../../../products/services/products.service';

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
  private readonly productsService = inject(ProductsService);
  private readonly uomService = inject(UomService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  /** Cached UoM catalog (signal so the template can resolve stock_uom_id → code). */
  private readonly uomCatalog = toSignal(this.uomService.getCatalog(), {
    initialValue: { success: true, data: [] as UnitOfMeasure[] },
  });

  /** The FormArray<FormGroup<...>> owned by the parent form. */
  readonly items = input.required<FormArray<FormGroup<RecipeItemFormControls>>>();

  /** Emitted when a row is added/removed so the parent can recompute stats. */
  readonly itemsChanged = output<void>();

  readonly ingredients = signal<RecipeIngredientOption[]>([]);
  readonly isLoadingIngredients = signal(false);

  /**
   * Cache of `product_id` → stock unit label. Populated on selection (and
   * prefetched for already-persisted rows). `unitCacheTick` is a signal the
   * template reads so the view re-renders when the cache mutates.
   */
  private readonly unitCache = new Map<number, string>();
  private readonly unitCacheTick = signal(0);

  /**
   * Tracks the most recently added row to drive the 0.3s halo animation.
   * Cleared by `setTimeout(..., 350)` after the CSS animation finishes.
   */
  readonly justAddedRow = signal<FormGroup<RecipeItemFormControls> | null>(null);

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

  constructor() {
    // Prefetch units for already-persisted rows whenever the items input
    // reference changes (covers edit-mode load + late-binds by the parent).
    effect(() => {
      const items = this.items();
      // Touch the array so the effect re-runs when the parent's @for mutates
      // the FormArray (push/insert/removeAt do not change the reference, but
      // the first effect run is enough for edit-mode prefetch; new rows call
      // onComponentSelected on selection).
      void items.controls.length;
      this.prefetchUnits();
    });
  }

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
          // Now that we have the list, try to satisfy any prefetch misses
          // for rows whose list-side stock_unit is null.
          this.prefetchUnits();
        },
        error: () => {
          this.toastService.error('No se pudieron cargar los ingredientes');
          this.isLoadingIngredients.set(false);
        },
      });
  }

  addItem(): void {
    const items = this.items();
    const group = this.fb.nonNullable.group<RecipeItemFormControls>({
      id: this.fb.nonNullable.control<number | null>(null),
      component_product_id: this.fb.nonNullable.control<number | null>(null, {
        validators: [Validators.required],
      }),
      quantity: this.fb.nonNullable.control<number | null>(1, {
        validators: [Validators.required, Validators.min(0.0001)],
      }),
      waste_percent: this.fb.nonNullable.control<number | null>(0, {
        validators: [Validators.min(0), Validators.max(100)],
      }),
      // ===== Waste mode (Fase UoM) =====
      // The control stays in the model so the parent's `syncItems()` DTO
      // mapping keeps working unchanged. The UI no longer exposes the mode
      // switch — only `waste_percent` is editable from the form.
      waste_mode: this.fb.nonNullable.control<'percent' | 'absolute'>(
        'percent',
      ),
      waste_absolute: this.fb.nonNullable.control<number | null>(0, {
        validators: [Validators.min(0)],
      }),
      is_optional: this.fb.nonNullable.control(false),
    });
    // Insert at the TOP so the new row is visible immediately, then trigger
    // a halo animation to draw the eye (handled in template + scss).
    items.insert(0, group);
    this.justAddedRow.set(group);
    setTimeout(() => {
      if (this.justAddedRow() === group) {
        this.justAddedRow.set(null);
      }
    }, 350);
    this.itemsChanged.emit();
  }

  removeItem(index: number): void {
    this.items().removeAt(index);
    this.itemsChanged.emit();
  }

  productLabel(productId: number | null | undefined): string {
    if (productId == null) return 'Selecciona un componente';
    const found = this.ingredients().find((i) => i.id === productId);
    if (found) {
      return found.name + (found.sku ? ` (${found.sku})` : '');
    }
    return `Producto #${productId}`;
  }

  /**
   * Returns the stock unit label (e.g. "g", "ml", "unidad") for the given
   * component product id. Prefetched for already-persisted rows by
   * `prefetchUnits()`; lazily fetched on `(valueChange)` for new rows.
   */
  productUnit(productId: number | null | undefined): string {
    if (productId == null) return '';
    // Touch the tick so the template re-runs when the cache mutates.
    this.unitCacheTick();
    return this.unitCache.get(productId) ?? '';
  }

  /**
   * Fired by the per-row `app-selector` whenever a component product is
   * chosen. Caches the unit label so the Cantidad input can show it as a
   * suffix and so the recipe save reuses it without an extra lookup.
   */
  onComponentSelected(
    productId: string | number | null,
    _row: FormGroup<RecipeItemFormControls>,
  ): void {
    if (productId == null) return;
    const id = Number(productId);
    if (!Number.isFinite(id)) return;
    if (this.unitCache.has(id)) {
      // Force a re-read so the template re-renders with the cached label.
      this.unitCacheTick.update((v) => v + 1);
      return;
    }
    this.fetchAndCacheUnit(id);
  }

  /**
   * Prefetch the unit for every component already present in the editor
   * (edit mode). Uses the in-memory `ingredients()` cache first; if the
   * list endpoint did not return a label, hits the product detail endpoint.
   */
  prefetchUnits(): void {
    const items = this.items().controls;
    for (const row of items) {
      const raw = row.getRawValue();
      const id = raw.component_product_id;
      if (id == null) continue;
      if (this.unitCache.has(id)) continue;
      const fromList = this.ingredients().find((i) => i.id === id)?.stock_unit;
      if (fromList) {
        this.unitCache.set(id, fromList);
      } else {
        this.fetchAndCacheUnit(id);
      }
    }
    if (this.unitCache.size > 0) {
      this.unitCacheTick.update((v) => v + 1);
    }
  }

  private fetchAndCacheUnit(id: number): void {
    this.productsService
      .getProductById(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (product: any) => {
          const label = this.resolveProductUnitLabel(product);
          this.unitCache.set(id, label);
          this.unitCacheTick.update((v) => v + 1);
        },
        error: () => {
          // Swallow: missing unit must not block the form; the input simply
          // shows no suffix.
          this.unitCache.set(id, '');
          this.unitCacheTick.update((v) => v + 1);
        },
      });
  }

  private resolveProductUnitLabel(product: any): string {
    const legacy = (product?.stock_unit ?? '').toString().trim();
    if (legacy) return legacy;
    const uomId = product?.stock_uom_id;
    if (uomId == null) return '';
    const found = (this.uomCatalog()?.data ?? []).find(
      (u) => Number(u.id) === Number(uomId),
    );
    return found?.code ?? '';
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
