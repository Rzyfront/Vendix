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
import { Product } from '../../../../products/interfaces/product.interface';
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

  /** Prepared-product candidates (product_type='prepared' OR is_batch_produced). */
  readonly productOptions = signal<SelectorOption[]>([]);
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
    recipe_id: this.fb.nonNullable.control<number | null>(null, [
      Validators.required,
      Validators.min(1),
    ]),
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
    this.productsService
      .getProducts({ limit: 500, state: 'active' as any, product_type: 'prepared' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const rows = response.data ?? [];
          // Server does not reliably scope to prepared/batch — filter client-side.
          const filtered = rows.filter(
            (p: Product) =>
              p.product_type === 'prepared' || p.is_batch_produced === true,
          );
          this.preparedProducts = filtered;
          this.productOptions.set(
            filtered.map((p: Product) => ({
              value: p.id,
              label: p.name,
              description: p.sku
                ? `${p.sku} · ${p.stock_unit ?? ''}`.trim()
                : (p.stock_unit ?? undefined),
            })),
          );
          this.isLoadingProducts.set(false);
        },
        error: () => {
          this.toastService.error('No se pudieron cargar los productos preparados');
          this.isLoadingProducts.set(false);
        },
      });
  }

  private onProductChange(productId: number | null): void {
    // Reset the dependent recipe selection whenever the product changes.
    this.form.controls.recipe_id.setValue(null);
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
          this.isLoadingRecipes.set(false);
        },
        error: () => {
          this.toastService.error(
            'No se pudieron cargar las recetas de este producto',
          );
          this.recipeOptions.set([]);
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
