import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs/operators';
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import {
  CardComponent,
  DialogService,
  IconComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  SettingToggleComponent,
  StickyHeaderActionButton,
  StickyHeaderComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../../shared/components/index';

import { RecipeItemsEditorComponent } from '../../components/recipe-items-editor/recipe-items-editor.component';
import { ProductsService } from '../../../../products/services/products.service';
import { Product } from '../../../../products/interfaces/product.interface';
import { RecipesService } from '../../services';
import {
  CreateRecipeDto,
  CreateRecipeItemDto,
  RecipeItemFormControls,
  UpdateRecipeItemDto,
} from '../../interfaces';

interface RecipeFormShape {
  product_id: FormControl<number | null>;
  yield_quantity: FormControl<number | null>;
  yield_unit: FormControl<string>;
  waste_percent: FormControl<number | null>;
  preparation_notes: FormControl<string>;
  is_active: FormControl<boolean>;
}

@Component({
  selector: 'app-recipe-form-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    StickyHeaderComponent,
    CardComponent,
    InputComponent,
    SelectorComponent,
    SettingToggleComponent,
    TextareaComponent,
    IconComponent,
    RecipeItemsEditorComponent,
  ],
  templateUrl: './recipe-form-page.component.html',
  styleUrl: './recipe-form-page.component.scss',
})
export class RecipeFormPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly recipesService = inject(RecipesService);
  private readonly productsService = inject(ProductsService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly isEditMode = signal(false);
  readonly recipeId = signal<number | null>(null);
  readonly isLoadingRecipe = signal(false);
  readonly isSubmitting = signal(false);
  readonly isLoadingProducts = signal(false);

  /**
   * Yield product candidates: `product_type='prepared'` OR `is_batch_produced=true`.
   * For new recipes we need to filter client-side because the backend product
   * list endpoint does not yet expose a server-side filter for these flags.
   */
  readonly yieldOptions = signal<SelectorOption[]>([]);

  /**
   * Curated list of yield units for restaurant recipes. Keeps `yield_unit`
   * as a free VARCHAR(20) in the DB (no migration) while steering the user
   * to the canonical codes used in the UoM catalog and the unit conversion
   * pipeline.
   */
  readonly yieldUnitOptions: SelectorOption[] = [
    { value: 'porción', label: 'Porción' },
    { value: 'plato', label: 'Plato' },
    { value: 'unidad', label: 'Unidad' },
    { value: 'ración', label: 'Ración' },
    { value: 'g', label: 'Gramos (g)' },
    { value: 'kg', label: 'Kilogramos (kg)' },
    { value: 'ml', label: 'Mililitros (ml)' },
    { value: 'L', label: 'Litros (L)' },
  ];

  readonly itemsArray = this.fb.nonNullable.array<
    FormGroup<RecipeItemFormControls>
  >([]);

  readonly form: FormGroup<RecipeFormShape> = this.fb.nonNullable.group<
    RecipeFormShape
  >({
    product_id: this.fb.nonNullable.control<number | null>(null, {
      validators: [Validators.required],
    }),
    yield_quantity: this.fb.nonNullable.control<number | null>(1, {
      validators: [Validators.required, Validators.min(0)],
    }),
    yield_unit: this.fb.nonNullable.control('', {
      validators: [Validators.required, Validators.maxLength(20)],
    }),
    waste_percent: this.fb.nonNullable.control<number | null>(0, {
      validators: [Validators.min(0), Validators.max(100)],
    }),
    preparation_notes: this.fb.nonNullable.control(''),
    is_active: this.fb.nonNullable.control(true),
  });

  /** Bridge form.status to a signal so the StickyHeader can react to validity. */
  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );

  readonly itemsCount = computed(() => this.itemsArray.length);

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    const invalid = this.formStatus() !== 'VALID' || this.isLoadingRecipe();
    return [
      {
        id: 'cancel',
        label: 'Cancelar',
        variant: 'outline',
        disabled: this.isSubmitting(),
      },
      {
        id: 'save',
        label: this.isEditMode() ? 'Guardar cambios' : 'Crear receta',
        icon: this.isEditMode() ? 'save' : 'plus',
        variant: 'primary',
        loading: this.isSubmitting(),
        disabled: invalid || this.isSubmitting(),
      },
    ];
  });

  constructor() {
    // Re-render header actions when item count or loading flags change.
    effect(() => {
      this.itemsCount();
    });
  }

  ngOnInit(): void {
    this.loadYieldOptions();

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.isEditMode.set(true);
      this.recipeId.set(Number(id));
      this.loadRecipe(this.recipeId());
      return;
    }

    // Deep-link desde el KDS: `recipes/new?product_id=<id>` preselecciona el
    // plato exacto que disparó el atajo "Crear receta" en un ticket sin
    // receta. Solo aplica en modo creación (en edición el producto es
    // inmutable y viene del recipe cargado).
    const rawProductId = this.route.snapshot.queryParamMap.get('product_id');
    const productId = rawProductId ? Number(rawProductId) : NaN;
    if (Number.isFinite(productId)) {
      this.form.controls.product_id.setValue(productId);
    }
  }

  // -------------------------------------------------------- Data loaders

  private loadYieldOptions(): void {
    this.isLoadingProducts.set(true);
    this.productsService
      .getProducts({ limit: 500, state: 'active' as any })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const rows = response.data || [];
          const filtered = rows.filter(
            (p: Product) =>
              p.product_type === 'prepared' || p.is_batch_produced === true,
          );
          this.yieldOptions.set(
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

  private loadRecipe(id: number | null): void {
    if (id == null) return;
    this.isLoadingRecipe.set(true);
    this.recipesService
      .getById(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (recipe) => {
          this.form.patchValue({
            product_id: recipe.product_id,
            yield_quantity: Number(recipe.yield_quantity ?? 0),
            yield_unit: recipe.yield_unit ?? '',
            waste_percent: Number(recipe.waste_percent ?? 0),
            preparation_notes: recipe.preparation_notes ?? '',
            is_active: recipe.is_active ?? true,
          });
          this.itemsArray.clear({ emitEvent: false });
          for (const item of recipe.items ?? []) {
            this.itemsArray.push(
              this.fb.nonNullable.group<RecipeItemFormControls>({
                id: this.fb.nonNullable.control<number | null>(item.id),
                component_product_id: this.fb.nonNullable.control<number | null>(
                  item.component_product_id,
                  { validators: [Validators.required] },
                ),
                quantity: this.fb.nonNullable.control<number | null>(
                  Number(item.quantity ?? 0),
                  { validators: [Validators.required, Validators.min(0)] },
                ),
                waste_percent: this.fb.nonNullable.control<number | null>(
                  Number(item.waste_percent ?? 0),
                  { validators: [Validators.min(0), Validators.max(100)] },
                ),
                // ===== Waste mode (Fase UoM) =====
                waste_mode: this.fb.nonNullable.control<'percent' | 'absolute'>(
                  (item.waste_mode as 'percent' | 'absolute') ?? 'percent',
                ),
                waste_absolute: this.fb.nonNullable.control<number | null>(
                  Number((item as any).waste_absolute ?? 0),
                  { validators: [Validators.min(0)] },
                ),
                is_optional: this.fb.nonNullable.control<boolean>(
                  !!item.is_optional,
                ),
              }),
            );
          }
          this.isLoadingRecipe.set(false);
        },
        error: (err: unknown) => {
          const msg = typeof err === 'string' ? err : 'No se pudo cargar la receta';
          this.toastService.error(msg);
          this.isLoadingRecipe.set(false);
          this.router.navigate(['/admin/restaurant-ops/recipes']);
        },
      });
  }

  // -------------------------------------------------------- Form actions

  onHeaderAction(actionId: string): void {
    if (actionId === 'cancel') {
      this.cancel();
    } else if (actionId === 'save') {
      this.submit();
    }
  }

  private cancel(): void {
    if (this.form.dirty || this.itemsArray.dirty) {
      this.dialogService
        .confirm({
          title: 'Descartar cambios',
          message: 'Tienes cambios sin guardar. ¿Salir sin guardar?',
          confirmText: 'Salir sin guardar',
          cancelText: 'Continuar editando',
          confirmVariant: 'danger',
        })
        .then((confirmed: boolean) => {
          if (confirmed) {
            this.router.navigate(['/admin/restaurant-ops/recipes']);
          }
        });
    } else {
      this.router.navigate(['/admin/restaurant-ops/recipes']);
    }
  }

  submit(): void {
    this.form.markAllAsTouched();
    this.itemsArray.markAllAsTouched();
    if (this.form.invalid || this.itemsArray.invalid) {
      this.toastService.warning('Revisa los campos marcados antes de guardar');
      return;
    }

    const raw = this.form.getRawValue();
    // Campos mutables compartidos. product_id NO va aquí: es inmutable tras crear
    // (el backend recipes.service.update lo ignora y el whitelist del DTO lo
    // rechaza con 400). Solo se envía al crear.
    const base = {
      yield_quantity: Number(raw.yield_quantity ?? 0),
      yield_unit: raw.yield_unit,
      waste_percent: Number(raw.waste_percent ?? 0),
      preparation_notes: raw.preparation_notes || undefined,
      is_active: raw.is_active,
    };

    this.isSubmitting.set(true);
    const upsert$ = this.isEditMode()
      ? this.recipesService.update(this.recipeId() as number, base)
      : this.recipesService.create({
          product_id: raw.product_id as number,
          ...base,
        } as CreateRecipeDto);

    upsert$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (recipe) => {
          const recipeId = recipe.id ?? this.recipeId();
          if (recipeId == null) {
            this.isSubmitting.set(false);
            return;
          }
          this.syncItems(recipeId).then(() => {
            this.isSubmitting.set(false);
            this.toastService.success(
              this.isEditMode()
                ? 'Receta actualizada correctamente'
                : 'Receta creada correctamente',
            );
            this.router.navigate(['/admin/restaurant-ops/recipes']);
          });
        },
        error: (err: unknown) => {
          this.isSubmitting.set(false);
          this.toastService.error(
            typeof err === 'string'
              ? err
              : this.isEditMode()
                ? 'Error al actualizar la receta'
                : 'Error al crear la receta',
          );
        },
      });
  }

  /**
   * Reconciles the items FormArray with the backend: creates new items, updates
   * existing ones, and removes any that disappeared from the form.
   */
  private async syncItems(recipeId: number): Promise<void> {
    const originalIds = new Set(
      (this.itemsArray.controls
        .map((c) => c.controls.id.value)
        .filter((v): v is number => typeof v === 'number') as number[]),
    );
    const currentIds = new Set<number>();

    for (const group of this.itemsArray.controls) {
      const raw = group.getRawValue();
      const itemId = raw.id;

      if (itemId == null) {
        // CREATE: component_product_id is required (the immutable FK to the
        // component product).
        const createDto: CreateRecipeItemDto = {
          component_product_id: raw.component_product_id as number,
          quantity: Number(raw.quantity ?? 0),
          waste_percent: Number(raw.waste_percent ?? 0),
          waste_mode: (raw.waste_mode as 'percent' | 'absolute') ?? 'percent',
          waste_absolute: Number(raw.waste_absolute ?? 0),
          is_optional: raw.is_optional,
        };
        await new Promise<void>((resolve) => {
          this.recipesService
            .addItem(recipeId, createDto)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (created) => {
                if (created?.id != null) currentIds.add(created.id);
                resolve();
              },
              error: () => {
                this.toastService.error('Error al agregar un componente');
                resolve();
              },
            });
        });
      } else {
        currentIds.add(itemId);
        // UPDATE: component_product_id is NOT updatable — the backend
        // UpdateRecipeItemDto whitelist rejects it with 400. Swapping a
        // component means remove + add, not patch.
        const updateDto: UpdateRecipeItemDto = {
          quantity: Number(raw.quantity ?? 0),
          waste_percent: Number(raw.waste_percent ?? 0),
          waste_mode: (raw.waste_mode as 'percent' | 'absolute') ?? 'percent',
          waste_absolute: Number(raw.waste_absolute ?? 0),
          is_optional: raw.is_optional,
        };
        await new Promise<void>((resolve) => {
          this.recipesService
            .updateItem(recipeId, itemId, updateDto)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: () => resolve(),
              error: () => {
                this.toastService.error('Error al actualizar un componente');
                resolve();
              },
            });
        });
      }
    }

    const toDelete = [...originalIds].filter((id) => !currentIds.has(id));
    for (const itemId of toDelete) {
      await new Promise<void>((resolve) => {
        this.recipesService
          .removeItem(recipeId, itemId)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => resolve(),
            error: () => {
              this.toastService.error('Error al eliminar un componente');
              resolve();
            },
          });
      });
    }
  }
}
