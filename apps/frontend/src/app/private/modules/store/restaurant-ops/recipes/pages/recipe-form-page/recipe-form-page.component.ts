import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  OnInit,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs/operators';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
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
  Recipe,
  RecipeItemFormControls,
  RecipeProductVariant,
  UpdateRecipeItemDto,
} from '../../interfaces';

interface RecipeFormShape {
  // Recetas por variante (paso 6): la selección del yield es una clave
  // compuesta — `"<product_id>"` para productos simples o
  // `"<product_id>:<variant_id>"` para variantes. El `app-selector` solo
  // maneja un escalar (`SelectorOption.value: string | number`), así que el
  // par viaja codificado y se decodifica en `submit()` (ver
  // `parseYieldSelection`). Nunca se auto-asigna variante: si la clave no
  // decodifica, el submit se bloquea con error en línea.
  yield_selection: FormControl<string | null>;
  yield_quantity: FormControl<number | null>;
  yield_unit: FormControl<string>;
  waste_percent: FormControl<number | null>;
  preparation_notes: FormControl<string>;
  is_active: FormControl<boolean>;
}

/**
 * Custom FormArray validator. Validators.minLength(1) does NOT work on
 * FormArrays in Angular (limitation: it only checks string length on
 * FormControl<string>). Use this to require at least one element in a
 * FormArray — e.g. a recipe's BOM must have ≥1 component.
 */
function atLeastOneItemValidator(control: AbstractControl): ValidationErrors | null {
  if (control instanceof FormArray) {
    return control.length > 0 ? null : { minItems: true };
  }
  return null;
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
  // Inline error message displayed at the top of the form. Acts as a
  // fallback to the toast (which the user reported was not always visible).
  // Persists until the next submit attempt.
  readonly submitError = signal<string | null>(null);
  readonly isLoadingRecipe = signal(false);
  readonly isSubmitting = signal(false);
  readonly isLoadingProducts = signal(false);
  // Receta cargada en modo edición. Expone `product_variant` al template para
  // la sub-línea del paso 7 (el backend la devuelve vía el include del paso 4).
  readonly loadedRecipe = signal<Recipe | null>(null);

  /**
   * Yield candidates: `product_type='prepared'` OR `is_batch_produced=true`.
   * For new recipes we need to filter client-side because the backend product
   * list endpoint does not yet expose a server-side filter for these flags.
   *
   * Recetas por variante (paso 6): cada producto CON variantes se expande en
   * una opción por variante (`"<id>:<variantId>"`, `"Plato — Variante"`) y la
   * fila base se descarta — nunca es seleccionable. Un producto SIN variantes
   * se ofrece tal cual (`"<id>"`). Ver `buildYieldOptions`.
   */
  readonly yieldOptions = signal<SelectorOption[]>([]);

  /**
   * Clave de yield pedida por el deep-link del KDS
   * (`recipes/new?product_id=…&product_variant_id=…`), PENDIENTE de validar.
   *
   * No se escribe directo en el control: `yieldOptions` se puebla por HTTP,
   * así que al montar todavía no se sabe si la clave existe entre las
   * opciones reales. El efecto del constructor la resuelve cuando la lista
   * llega. `null` = nada pendiente (navegación normal o clave ya aplicada).
   */
  private readonly pendingYieldSelection = signal<string | null>(null);

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
  >([], { validators: [atLeastOneItemValidator] });

  readonly form: FormGroup<RecipeFormShape> = this.fb.nonNullable.group<
    RecipeFormShape
  >({
    yield_selection: this.fb.nonNullable.control<string | null>(null, {
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
        // No longer tied to isSubmitting: if the user is stuck waiting for
        // a 4xx/5xx response, they MUST be able to leave the form.
        // takeUntilDestroyed will cancel the in-flight request on unmount.
        disabled: false,
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

    /**
     * Resolución del deep-link contra las opciones REALES del selector.
     *
     * Antes se escribía la clave del query param directo en el control: si
     * esa clave no existía entre las opciones (caso típico: llega la clave
     * base `"<product_id>"` de un plato variantizado, que nunca se ofrece),
     * el `<select>` no podía representarla, el campo se veía vacío y el
     * formulario parecía «válido» hasta reventar en el backend con
     * `RECIPE_VARIANT_REQUIRED`. Ahora se comprueba la pertenencia y, si no
     * pertenece, se cae al valor por defecto —sin selección— para que
     * `Validators.required` frene el guardado y el usuario elija a mano.
     *
     * Zoneless: las opciones llegan por HTTP, así que la comprobación NO
     * puede correr en `ngOnInit` (siempre fallaría). Vive en un effect que
     * espera a que la carga termine y la lista esté poblada. La clave
     * pendiente se LEE con `untracked` y todas las escrituras van dentro de
     * `untracked`, de modo que limpiarla no reentra al effect.
     */
    effect(() => {
      const options = this.yieldOptions();
      if (this.isLoadingProducts() || options.length === 0) return;
      const pending = untracked(this.pendingYieldSelection);
      if (pending == null) return;

      untracked(() => {
        this.pendingYieldSelection.set(null);
        const control = this.form.controls.yield_selection;
        const match = options.some(
          (o) => String(o.value) === pending && o.disabled !== true,
        );
        if (match) {
          control.setValue(pending);
          return;
        }
        // Valor por defecto sensato: SIN selección. Nunca se auto-asigna una
        // variante (la intención del usuario es incognoscible, misma regla
        // que `parseYieldSelection`), pero tampoco se deja basura escrita.
        control.setValue(null);
        control.markAsTouched();
        this.submitError.set(
          'No se pudo preseleccionar el plato del atajo: elige abajo el plato o la variante que produce esta receta. Si el plato tiene variantes, la receta se crea sobre una variante, nunca sobre el producto base.',
        );
      });
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

    // Deep-link desde el KDS:
    // `recipes/new?product_id=<id>[&product_variant_id=<id>]` preselecciona el
    // plato exacto que disparó el atajo "Crear receta" en un ticket sin
    // receta. Solo aplica en modo creación (en edición el producto es
    // inmutable y viene del recipe cargado).
    //
    // `product_variant_id` es OPCIONAL: si viene, la clave pedida es la del
    // par `(producto, variante)`; si no viene —plato sin variantes, el camino
    // común— es la clave base de siempre. La clave NO se escribe aquí: queda
    // pendiente y el effect del constructor la valida contra las opciones
    // reales cuando terminen de cargar.
    const rawProductId = this.route.snapshot.queryParamMap.get('product_id');
    const productId = rawProductId ? Number(rawProductId) : NaN;
    if (!Number.isFinite(productId)) return;

    const rawVariantId = this.route.snapshot.queryParamMap.get(
      'product_variant_id',
    );
    const parsedVariantId =
      rawVariantId != null && rawVariantId.trim() !== ''
        ? Number(rawVariantId)
        : NaN;
    const variantId = Number.isFinite(parsedVariantId) ? parsedVariantId : null;

    this.pendingYieldSelection.set(this.yieldKey(productId, variantId));
  }

  // -------------------------------------------------------- Data loaders

  /**
   * Clave de opción del selector para un yield: `"<product_id>"` en productos
   * simples, `"<product_id>:<variant_id>"` en variantes.
   */
  yieldKey(productId: number, variantId: number | null): string {
    return variantId != null ? `${productId}:${variantId}` : `${productId}`;
  }

  /**
   * Decodifica la selección del yield en el par `(product_id, variant_id).
   * Devuelve `null` si la clave no tiene la forma esperada — el submit la
   * trata como error en línea en vez de adivinar (misma regla que
   * `PO_VARIANT_001`: la intención de variante del usuario es incognoscible).
   */
  private parseYieldSelection(
    selection: string | null,
  ): { product_id: number; product_variant_id: number | null } | null {
    if (selection == null || selection === '') return null;
    const [rawProduct, rawVariant] = selection.split(':');
    // `Number('')` es 0, no NaN: una clave como `":470"` pasaría el
    // `isFinite` con un `product_id: 0` fantasma. Las claves las genera
    // `yieldKey`, siempre `"<id>"` numérico positivo.
    if (rawProduct == null || rawProduct.trim() === '') return null;
    const product_id = Number(rawProduct);
    if (!Number.isFinite(product_id)) return null;
    if (rawVariant == null || rawVariant === '') {
      return { product_id, product_variant_id: null };
    }
    const product_variant_id = Number(rawVariant);
    if (!Number.isFinite(product_variant_id)) return null;
    return { product_id, product_variant_id };
  }

  /**
   * Etiqueta legible de una variante: atributos → name → sku → `#id`. Mismo
   * orden que el picker de `add-items-modal` (QUI-736) para que la variante se
   * lea igual en cocina y en recetas. Acepta ambas formas de `attributes` (el
   * backend las mapea a arreglo `{attribute_name, attribute_value}` pero el
   * tipo `ProductVariant` las declara como registro).
   */
  variantDisplayName(
    variant: RecipeProductVariant | {
      id?: number;
      name?: string | null;
      sku?: string | null;
      attributes?:
        | Array<{ attribute_name: string; attribute_value: string }>
        | Record<string, unknown>
        | null;
    },
  ): string {
    const attrs = variant.attributes;
    if (Array.isArray(attrs) && attrs.length > 0) {
      return attrs.map((a) => a.attribute_value).join(' / ');
    }
    if (attrs != null && typeof attrs === 'object') {
      const values = Object.values(attrs).filter(
        (v): v is string | number => typeof v === 'string' || typeof v === 'number',
      );
      if (values.length > 0) return values.join(' / ');
    }
    return (
      variant.name ||
      variant.sku ||
      (variant.id != null ? `Variante #${variant.id}` : 'Variante')
    );
  }

  /**
   * Expansor del paso 6: envuelve el filtro de candidatos. Cada producto con
   * variantes emite UNA opción por variante y la fila base se descarta; un
   * producto sin variantes se ofrece tal cual (cero cambio para ellos).
   */
  private buildYieldOptions(rows: Product[]): SelectorOption[] {
    const options: SelectorOption[] = [];
    for (const p of rows) {
      const variants = p.product_variants ?? [];
      if (variants.length > 0) {
        for (const v of variants) {
          options.push({
            value: this.yieldKey(p.id, v.id),
            label: `${p.name} — ${this.variantDisplayName(v)}`,
            description: v.sku
              ? `${v.sku} · ${p.stock_unit ?? ''}`.trim()
              : (p.stock_unit ?? undefined),
          });
        }
      } else {
        options.push({
          value: this.yieldKey(p.id, null),
          label: p.name,
          description: p.sku
            ? `${p.sku} · ${p.stock_unit ?? ''}`.trim()
            : (p.stock_unit ?? undefined),
        });
      }
    }
    return options;
  }

  private loadYieldOptions(): void {
    this.isLoadingProducts.set(true);
    this.productsService
      // Sin `include_variants`, `product_variants` llega vacío y el expansor
      // degradaría a ofrecer la base — exactamente lo prohibido.
      .getProducts({
        limit: 500,
        state: 'active' as any,
        include_variants: true,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const rows = response.data || [];
          const filtered = rows.filter(
            (p: Product) =>
              p.product_type === 'prepared' || p.is_batch_produced === true,
          );
          this.yieldOptions.set(this.buildYieldOptions(filtered));
          this.ensureEditSelectionVisible();
          this.isLoadingProducts.set(false);
        },
        error: () => {
          this.toastService.error('No se pudieron cargar los productos preparados');
          this.isLoadingProducts.set(false);
        },
      });
  }

  /**
   * Red de seguridad del modo edición: si la receta cargada apunta a un yield
   * cuya opción no existe (receta base heredada de un producto variantizado,
   * creada antes del paso 6), se agrega UNA opción deshabilitada de solo
   * lectura para que el campo no quede en blanco. El selector ya está
   * deshabilitado en edición, así que no reintroduce la base como elegible.
   * Idempotente: solo agrega cuando la clave falta.
   */
  private ensureEditSelectionVisible(): void {
    if (!this.isEditMode()) return;
    const recipe = this.loadedRecipe();
    if (recipe == null || this.yieldOptions().length === 0) return;
    const key = this.yieldKey(
      recipe.product_id,
      recipe.product_variant_id ?? null,
    );
    if (this.yieldOptions().some((o) => String(o.value) === key)) return;
    const variantName =
      recipe.product_variant != null
        ? this.variantDisplayName(recipe.product_variant)
        : null;
    this.yieldOptions.set([
      ...this.yieldOptions(),
      {
        value: key,
        label:
          variantName != null
            ? `${recipe.product?.name ?? `Producto #${recipe.product_id}`} — ${variantName}`
            : (recipe.product?.name ?? `Producto #${recipe.product_id}`),
        disabled: true,
      },
    ]);
  }

  private loadRecipe(id: number | null): void {
    if (id == null) return;
    this.isLoadingRecipe.set(true);
    this.recipesService
      .getById(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (recipe) => {
          this.loadedRecipe.set(recipe);
          this.form.patchValue({
            yield_selection: this.yieldKey(
              recipe.product_id,
              recipe.product_variant_id ?? null,
            ),
            yield_quantity: Number(recipe.yield_quantity ?? 0),
            yield_unit: recipe.yield_unit ?? '',
            waste_percent: Number(recipe.waste_percent ?? 0),
            preparation_notes: recipe.preparation_notes ?? '',
            is_active: recipe.is_active ?? true,
          });
          // La receta puede llegar antes que las opciones: si la clave aún no
          // existe como opción, la red de seguridad la agrega deshabilitada.
          this.ensureEditSelectionVisible();
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
    this.submitError.set(null); // clear any previous inline error
    this.form.markAllAsTouched();
    this.itemsArray.markAllAsTouched();
    const formInvalid = this.form.invalid;
    const itemsInvalid = this.itemsArray.invalid;
    const itemsCount = this.itemsArray.length;
    if (formInvalid || itemsInvalid) {
      // Compose a specific inline message that names the actual problem
      // rather than a generic "review the fields" hint.
      const errors: string[] = [];
      if (itemsCount === 0) {
        errors.push('Agrega al menos un componente a la receta.');
      } else if (itemsInvalid) {
        errors.push('Revisa los componentes: cada uno necesita un insumo y cantidad mayor a 0.');
      }
      if (formInvalid) {
        errors.push('Completa los campos obligatorios del encabezado.');
      }
      const composedMessage = errors.join(' ');
      this.submitError.set(composedMessage);
      this.toastService.warning('Revisa los campos marcados antes de guardar');
      return;
    }

    // Safety net: if the request hangs forever (network stalled, server
    // crashed mid-response) the user is stuck looking at a spinner. After
    // 30s we force-reset isSubmitting so the form becomes usable again.
    const safetyTimer = setTimeout(() => {
      if (this.isSubmitting()) {
        this.isSubmitting.set(false);
        this.toastService.warning(
          'La solicitud tardó demasiado. Verifica tu conexión e intenta de nuevo.',
        );
      }
    }, 30000);
    // takeUntilDestroyed below cancels the subscription on destroy, so neither
    // `next` nor `error` runs and their clearTimeout never fires. Without this
    // the timer survives the component and pops a warning toast 30s later on
    // whatever page the user navigated to.
    this.destroyRef.onDestroy(() => clearTimeout(safetyTimer));

    const raw = this.form.getRawValue();
    // Campos mutables compartidos. El yield NO va aquí: es inmutable tras
    // crear (el backend recipes.service.update lo ignora y el whitelist del
    // DTO lo rechaza con 400). Solo se envía al crear.
    const base = {
      yield_quantity: Number(raw.yield_quantity ?? 0),
      yield_unit: raw.yield_unit,
      waste_percent: Number(raw.waste_percent ?? 0),
      preparation_notes: raw.preparation_notes || undefined,
      is_active: raw.is_active,
    };

    // Recetas por variante (paso 6): al crear, el yield viaja como par
    // (product_id, product_variant_id). Si la clave no decodifica, no se
    // adivina — se bloquea con error en línea.
    let createDto: CreateRecipeDto | null = null;
    if (!this.isEditMode()) {
      const parsed = this.parseYieldSelection(raw.yield_selection);
      if (parsed == null) {
        const msg =
          'Selecciona el plato o la variante que produce esta receta. Si el plato tiene variantes, debes elegir una variante, nunca el producto base.';
        this.submitError.set(msg);
        this.toastService.warning(
          'Revisa los campos marcados antes de guardar',
        );
        return;
      }
      createDto = {
        product_id: parsed.product_id,
        // product_variant_id solo viaja cuando el yield es una variante; el
        // spread condicional deja el payload byte-identico al de hoy para
        // productos simples.
        ...(parsed.product_variant_id != null && {
          product_variant_id: parsed.product_variant_id,
        }),
        ...base,
      };
    }

    this.isSubmitting.set(true);
    const upsert$ = this.isEditMode()
      ? this.recipesService.update(this.recipeId() as number, base)
      : this.recipesService.create(createDto as CreateRecipeDto);

    upsert$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (recipe) => {
          clearTimeout(safetyTimer);
          // Defensive: a malformed response (e.g. HTTP 200 with {success:false}
          // instead of 409) bypasses catchError and reaches `next` with
          // `recipe` undefined. Treat it as an error.
          if (!recipe || recipe.id == null) {
            const msg = 'Respuesta inválida del servidor. Intenta de nuevo.';
            this.submitError.set(msg);
            this.toastService.error(msg, 'No se pudo guardar la receta', 6000);
            this.isSubmitting.set(false);
            return;
          }
          const recipeId = recipe.id;
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
          clearTimeout(safetyTimer);
          this.isSubmitting.set(false);
          // The recipes service transforms HttpErrorResponse into a plain
          // string message; for 409 it includes the backend's exact text
          // (e.g. "Ya existe una receta para este producto en la tienda").
          // Fall back to a clear generic only if no message arrived.
          const apiMessage =
            typeof err === 'string'
              ? err
              : (err as { error?: { message?: string } })?.error?.message;
          const finalMessage =
            apiMessage ??
            (this.isEditMode()
              ? 'Error al actualizar la receta'
              : 'Error al crear la receta');
          // Inline error banner — always visible regardless of toast
          // rendering, stacking, or auto-dismiss timing.
          this.submitError.set(finalMessage);
          this.toastService.error(
            finalMessage,
            'No se pudo guardar la receta',
            6000, // 6s so the user has time to read the API message
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
