import {
  Component,
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

  /** Prepared products as options; non-batch ones are rendered disabled with a hint. */
  readonly productOptions = signal<SelectorOption[]>([]);
  /** True when prepared products exist but none are batch-eligible — drives the guidance note. */
  readonly noEligibleProducts = signal(false);
  /** Active recipes for the currently selected product. */
  readonly recipeOptions = signal<SelectorOption[]>([]);
  readonly isLoadingProducts = signal(false);
  readonly isLoadingRecipes = signal(false);
  /** stock_unit of the selected product — surfaced as the planned_qty unit hint. */
  readonly selectedProductUnit = signal<string | null>(null);

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
    planned_qty: this.fb.nonNullable.control<number | null>(null, [
      Validators.required,
      Validators.min(0.0001),
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

  /** Loaded prepared products, kept to resolve stock_unit on selection. */
  private preparedProducts: Product[] = [];

  ngOnInit(): void {
    this.loadPreparedProducts();

    // Chained picker: when the product changes, reset + reload its recipes.
    this.form.controls.product_id.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((productId) => this.onProductChange(productId));
  }

  private loadPreparedProducts(): void {
    this.isLoadingProducts.set(true);
    this.productIdControl.disable({ emitEvent: false });
    // El backend filtra product_type server-side (verificado), así que NO
    // re-filtramos por tipo en cliente ni sobre-pedimos. Mostramos todos los
    // preparados y marcamos como deshabilitados los que aún no son producibles
    // por lote (is_batch_produced=false), con una pista para activarlos.
    this.productsService
      .getProducts({
        limit: 200,
        state: ProductState.ACTIVE,
        product_type: 'prepared',
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const rows = response.data ?? [];
          this.preparedProducts = rows;
          this.productOptions.set(
            rows.map((p: Product) => {
              const batchReady = p.is_batch_produced === true;
              const base = p.sku
                ? `${p.sku} · ${p.stock_unit ?? ''}`.trim()
                : (p.stock_unit ?? '');
              return {
                value: p.id,
                label: p.name,
                description: batchReady
                  ? base || undefined
                  : `${base ? base + ' · ' : ''}Activa «producido por lote»`,
                disabled: !batchReady,
              } as SelectorOption;
            }),
          );
          this.noEligibleProducts.set(
            rows.length > 0 &&
              !rows.some((p: Product) => p.is_batch_produced === true),
          );
          this.productIdControl.enable({ emitEvent: false });
          this.isLoadingProducts.set(false);
        },
        error: () => {
          this.toastService.error('No se pudieron cargar los productos preparados');
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
      planned_qty: Number(raw.planned_qty),
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
