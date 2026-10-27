import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  StickyHeaderComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../../shared/components/index';

import { ProductionOrdersService } from '../../services';
import { CreateProductionOrderDto } from '../../interfaces';
import { ProductsService } from '../../../../products/services/products.service';
import {
  Product,
  ProductState,
} from '../../../../products/interfaces/product.interface';
import { RecipesService } from '../../../recipes/services';
import { Recipe } from '../../../recipes/interfaces';

interface ProductionFormControls {
  product_id: FormControl<number | null>;
  recipe_id: FormControl<number | null>;
  planned_qty: FormControl<number | null>;
  notes: FormControl<string>;
}

@Component({
  selector: 'app-production-order-form-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    StickyHeaderComponent,
    CardComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    ButtonComponent,
  ],
  templateUrl: './production-order-form-page.component.html',
  styleUrl: './production-order-form-page.component.scss',
})
export class ProductionOrderFormPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly productionService = inject(ProductionOrdersService);
  private readonly productsService = inject(ProductsService);
  private readonly recipesService = inject(RecipesService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly isSubmitting = signal(false);

  /** Productos producibles por lote como opciones del selector (todas habilitadas). */
  readonly productOptions = signal<SelectorOption[]>([]);
  /** True cuando no hay productos producibles por lote — muestra la nota guía. */
  readonly noEligibleProducts = signal(false);
  /** Active recipes for the currently selected product. */
  readonly recipeOptions = signal<SelectorOption[]>([]);
  readonly isLoadingProducts = signal(false);
  readonly isLoadingRecipes = signal(false);
  /** stock_unit of the selected product — surfaced as the planned_qty unit hint. */
  readonly selectedProductUnit = signal<string | null>(null);
  /** Recipes loaded for the selected product, to resolve the chosen one's yield. */
  private readonly loadedRecipes = signal<Recipe[]>([]);
  readonly selectedRecipe = signal<Recipe | null>(null);
  /** Whole recipe batches typed by the user (the form's planned_qty control). */
  readonly batches = signal<number | null>(null);
  /**
   * Units that will be produced: batches × recipe yield. Production always
   * runs whole batches (QUI-965) — a recipe that yields 10 run 3 times gives 30.
   */
  /** Recipe yield per batch; invalid or <= 0 falls back to 1, as the backend does. */
  private readonly recipeYield = computed<number>(() => {
    const value = Number(this.selectedRecipe()?.yield_quantity);
    return Number.isFinite(value) && value > 0 ? value : 1;
  });
  readonly plannedUnits = computed<number | null>(() => {
    const batches = this.batches();
    if (batches == null || !this.selectedRecipe()) return null;
    return batches * this.recipeYield();
  });
  readonly batchesHelperText = computed(() => {
    const recipe = this.selectedRecipe();
    if (!recipe) {
      return 'Cuántas veces vas a preparar la receta. Elige una receta para ver cuánto produce.';
    }
    const units = this.plannedUnits();
    const unit = recipe.yield_unit || 'unidades';
    const perBatch = `La receta rinde ${this.recipeYield()} ${unit} por tanda`;
    return units == null
      ? `${perBatch}.`
      : `${perBatch} · se producirán ${units} ${unit}.`;
  });

  readonly form: FormGroup<ProductionFormControls> = this.fb.group<ProductionFormControls>({
    product_id: this.fb.nonNullable.control<number | null>(null, [
      Validators.required,
      Validators.min(1),
    ]),
    // Arranca deshabilitado: se habilita al elegir un producto con recetas.
    // El estado disabled se gestiona vía control (disable/enable), NO con
    // [disabled] en el template (evita NG01052 + ExpressionChanged en reactive forms).
    recipe_id: this.fb.nonNullable.control<number | null>(
      { value: null, disabled: true },
      [Validators.required, Validators.min(1)],
    ),
    // Whole recipe batches (1, 2, 3…), not units: see plannedUnits.
    planned_qty: this.fb.nonNullable.control<number | null>(null, [
      Validators.required,
      Validators.min(1),
      Validators.pattern(/^\d+$/),
    ]),
    notes: this.fb.nonNullable.control(''),
  });

  get productIdControl(): FormControl<number | null> {
    return this.form.controls.product_id;
  }

  get recipeIdControl(): FormControl<number | null> {
    return this.form.controls.recipe_id;
  }

  get plannedQtyControl(): FormControl<number | null> {
    return this.form.controls.planned_qty;
  }

  get notesControl(): FormControl<string> {
    return this.form.controls.notes;
  }

  /** Productos producibles por lote cargados, para resolver stock_unit al seleccionar. */
  private preparedProducts: Product[] = [];

  ngOnInit(): void {
    this.loadPreparedProducts();

    // Chained picker: when the product changes, reset + reload its recipes.
    this.form.controls.product_id.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((productId) => this.onProductChange(productId));

    this.recipeIdControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((recipeId) => {
        const id = recipeId != null ? Number(recipeId) : null;
        this.selectedRecipe.set(
          this.loadedRecipes().find((r) => r.id === id) ?? null,
        );
      });

    this.plannedQtyControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        const n = value != null ? Number(value) : NaN;
        this.batches.set(Number.isInteger(n) && n >= 1 ? n : null);
      });
  }

  private loadPreparedProducts(): void {
    this.isLoadingProducts.set(true);
    this.productIdControl.disable({ emitEvent: false });
    // El backend filtra is_batch_produced=true server-side: todos los productos
    // devueltos ya son producibles por lote (un insumo es physical, no prepared),
    // así que todas las opciones quedan habilitadas.
    this.productsService
      .getProducts({
        limit: 200,
        state: ProductState.ACTIVE,
        is_batch_produced: true,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const rows = response.data ?? [];
          this.preparedProducts = rows;
          this.productOptions.set(
            rows.map((p: Product) => {
              const base = p.sku
                ? `${p.sku} · ${p.stock_unit ?? ''}`.trim()
                : (p.stock_unit ?? '');
              return {
                value: p.id,
                label: p.name,
                description: base || undefined,
              } as SelectorOption;
            }),
          );
          // Sin productos producibles por lote disponibles para producir.
          this.noEligibleProducts.set(rows.length === 0);
          this.productIdControl.enable({ emitEvent: false });
          this.isLoadingProducts.set(false);
        },
        error: () => {
          this.toastService.error(
            'No se pudieron cargar los productos producibles por lote',
          );
          this.productIdControl.enable({ emitEvent: false });
          this.isLoadingProducts.set(false);
        },
      });
  }

  private onProductChange(productId: number | null): void {
    // Reset the dependent recipe selection whenever the product changes.
    // emitEvent:false: no re-disparar valueChanges ni warnings de reactive forms.
    this.recipeIdControl.setValue(null, { emitEvent: false });
    this.recipeIdControl.disable({ emitEvent: false });
    this.recipeOptions.set([]);
    this.loadedRecipes.set([]);
    this.selectedRecipe.set(null);

    const id = productId != null ? Number(productId) : null;
    if (id == null || Number.isNaN(id) || id < 1) {
      this.selectedProductUnit.set(null);
      return;
    }

    const product = this.preparedProducts.find((p) => p.id === id);
    this.selectedProductUnit.set(product?.stock_unit ?? null);

    this.isLoadingRecipes.set(true);
    this.recipesService
      .listPaginated({ product_id: id, is_active: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const rows = response.data ?? [];
          this.loadedRecipes.set(rows);
          this.recipeOptions.set(
            rows.map((r: Recipe) => ({
              value: r.id,
              label: `Receta #${r.id} · rinde ${r.yield_quantity} ${r.yield_unit}`,
            })),
          );
          // Solo habilitar si hay recetas que elegir.
          if (rows.length > 0) {
            this.recipeIdControl.enable({ emitEvent: false });
          }
          this.isLoadingRecipes.set(false);
        },
        error: () => {
          this.toastService.error(
            'No se pudieron cargar las recetas de este producto',
          );
          this.recipeOptions.set([]);
          this.recipeIdControl.disable({ emitEvent: false });
          this.isLoadingRecipes.set(false);
        },
      });
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toastService.error('Completa los campos requeridos');
      return;
    }
    const raw = this.form.getRawValue();
    if (
      raw.product_id == null ||
      raw.recipe_id == null ||
      raw.planned_qty == null
    ) {
      return;
    }

    const dto: CreateProductionOrderDto = {
      product_id: Number(raw.product_id),
      recipe_id: Number(raw.recipe_id),
      // The API stores units; the form captures whole batches.
      planned_qty: this.plannedUnits() ?? Number(raw.planned_qty),
      notes: raw.notes?.trim() || undefined,
    };

    this.isSubmitting.set(true);
    this.productionService
      .create(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.toastService.success('Orden de producción creada en estado draft');
          this.isSubmitting.set(false);
          this.router.navigate(['/admin/restaurant-ops/production']);
        },
        error: (error) => {
          this.toastService.error(
            typeof error === 'string'
              ? error
              : 'Error al crear la orden de producción',
          );
          this.isSubmitting.set(false);
        },
      });
  }

  onCancel(): void {
    this.router.navigate(['/admin/restaurant-ops/production']);
  }
}
