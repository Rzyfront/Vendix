import {
  Component,
  computed,
  effect,
  inject,
  model,
  output,
  signal,
  DestroyRef,
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { SettingToggleComponent } from '../../../../../../shared/components/setting-toggle/setting-toggle.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';

import { UomService } from '../../services/uom.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { PreBulkData } from '../interfaces/pop-cart.interface';

/**
 * POP Pre-Bulk Product Modal
 * Adds temporary products to purchase order that don't exist in catalog.
 *
 * UX aligned with `product-create-modal.component` (structured sections,
 * Reactive Forms, currency input mode). The product is NOT persisted in
 * the catalog — it only lives on this specific purchase order.
 *
 * @deprecated Reemplazado por `PopProductConfigModalComponent` con
 * `mode='create'` (Fase 5 — modal unificado). El orquestador
 * (`pop.component.ts`) ahora enruta la creación manual al modal
 * unificado cuando `POP_USE_UNIFIED_MODAL=true` (default). Este
 * componente queda **inerte** y pendiente de eliminación con
 * autorización explícita (regla dura de memoria). Mantener el archivo
 * para no romper la rama legacy cuando el flag está en `false`.
 */
@Component({
  selector: 'app-pop-prebulk-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    TextareaComponent,
    IconComponent,
    SettingToggleComponent,
    CurrencyPipe,
  ],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      (cancel)="onCancel()"
      [size]="'md'"
      title="Agregar Producto Nuevo"
      subtitle="Se creará en tu catálogo al confirmar la orden"
    >
      <div class="p-2 md:p-4">
        <form [formGroup]="form" class="space-y-4">
          <!-- Info banner -->
          <div
            class="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3"
          >
            <app-icon
              name="info"
              [size]="20"
              class="mt-0.5 flex-shrink-0 text-blue-600"
            ></app-icon>
            <div class="text-sm">
              <p class="mb-0.5 font-semibold text-blue-800">Producto nuevo</p>
              <p class="text-blue-900">
                Se creará automáticamente en tu catálogo al confirmar la orden.
                Podrás editarlo luego desde Productos.
              </p>
            </div>
          </div>

          <!-- Section 1: Basic info -->
          <section class="space-y-3">
            <h3
              class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]"
            >
              Información básica
            </h3>

            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div class="md:col-span-2">
                <app-input
                  label="Nombre del Producto"
                  formControlName="name"
                  placeholder="Ej: Material genérico"
                  [error]="getErrorMessage('name')"
                  [required]="true"
                ></app-input>
              </div>

              <app-input
                label="SKU / Código"
                formControlName="code"
                placeholder="Ej: MAN-001"
                [error]="getErrorMessage('code')"
                [required]="true"
              ></app-input>

              <app-input
                label="Descripción corta"
                formControlName="description"
                placeholder="Opcional"
              ></app-input>
            </div>
          </section>

          <!-- Section 1.5: Ingredient classification (only when the store
               supports the is_ingredient capacity — restaurant industry). -->
          @if (storeSupportsIngredients()) {
            <section class="space-y-3">
              <h3
                class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]"
              >
                Clasificación
              </h3>

              <app-setting-toggle
                label="Es un insumo"
                description="Marca este producto como insumo para recetas. Dejará de venderse directamente y se medirá por unidades de compra y stock."
                [ngModel]="isIngredient()"
                [ngModelOptions]="{ standalone: true }"
                (changed)="onIngredientToggle($event)"
              ></app-setting-toggle>

              @if (isIngredient()) {
                <div
                  class="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2"
                  data-testid="pop-prebulk-ingredient-uom"
                >
                  <div class="flex items-center gap-2">
                    <app-icon
                      name="package"
                      [size]="14"
                      class="text-primary-600"
                    ></app-icon>
                    <p
                      class="text-[10px] text-text-muted uppercase font-bold tracking-wider"
                    >
                      Unidad de medida del insumo
                    </p>
                  </div>
                  <p class="text-xs text-text-muted">
                    Captura el costo por la <strong>unidad de compra</strong>
                    (la presentación que llega del proveedor). El sistema lo
                    convertirá automáticamente a la unidad de stock usando el
                    factor de la UoM.
                  </p>
                  <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <label
                        class="block text-xs font-medium text-text-primary mb-1"
                      >
                        Unidad de compra
                        <span class="text-destructive">*</span>
                      </label>
                      <select
                        class="w-full px-2 py-1.5 text-sm rounded-lg border border-border bg-surface text-text-primary"
                        [ngModel]="purchaseUomId()"
                        [ngModelOptions]="{ standalone: true }"
                        (ngModelChange)="purchaseUomId.set($event)"
                      >
                        <option [ngValue]="null">— Seleccionar —</option>
                        @for (u of uomCatalog(); track u.id) {
                          <option [ngValue]="u.id">
                            {{ u.code }} — {{ u.name }}
                          </option>
                        }
                      </select>
                    </div>
                    <div>
                      <label
                        class="block text-xs font-medium text-text-primary mb-1"
                      >
                        Unidad de stock
                        <span class="text-destructive">*</span>
                      </label>
                      <select
                        class="w-full px-2 py-1.5 text-sm rounded-lg border border-border bg-surface text-text-primary"
                        [ngModel]="stockUomId()"
                        [ngModelOptions]="{ standalone: true }"
                        (ngModelChange)="stockUomId.set($event)"
                      >
                        <option [ngValue]="null">— Seleccionar —</option>
                        @for (u of uomCatalog(); track u.id) {
                          <option [ngValue]="u.id">
                            {{ u.code }} — {{ u.name }}
                          </option>
                        }
                      </select>
                    </div>
                  </div>
                  @if (unitCapacity(); as cap) {
                    <div
                      class="flex items-center gap-2 text-xs text-primary bg-white/60 rounded-lg px-2 py-1.5"
                      data-testid="pop-prebulk-capacity-preview"
                    >
                      <app-icon name="info" [size]="12"></app-icon>
                      <span>
                        1 {{ cap.purchaseUnit }} = {{ cap.value }}
                        {{ cap.unit }} (factor de conversión).
                      </span>
                    </div>
                  }
                </div>
              }
            </section>
          }

          <!-- Section 2: Pricing -->
          <section class="space-y-3">
            <h3
              class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]"
            >
              Precio y costo
            </h3>

            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
              <app-input
                [label]="costInputLabel()"
                [currency]="true"
                formControlName="unitCost"
                prefix="$"
                placeholder="0.00"
                [error]="getErrorMessage('unitCost')"
                [required]="true"
              ></app-input>

              <app-input
                label="Precio de Venta"
                [currency]="true"
                formControlName="basePrice"
                prefix="$"
                placeholder="0.00"
                tooltipText="Opcional: precio de referencia para ventas"
              ></app-input>
            </div>

            <!-- Total preview -->
            <div
              class="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)] px-4 py-3"
            >
              <div class="flex items-center gap-2">
                <app-icon
                  name="calculator"
                  [size]="16"
                  class="text-[var(--color-text-secondary)]"
                ></app-icon>
                <span class="text-sm text-[var(--color-text-secondary)]">
                  Total estimado
                </span>
              </div>
              <span
                class="text-lg font-semibold text-[var(--color-text-primary)]"
              >
                {{ calculatedTotal() | currency: 0 }}
              </span>
            </div>
          </section>

          <!-- Section 3: Quantity & notes -->
          <section class="space-y-3">
            <h3
              class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]"
            >
              Cantidad y notas
            </h3>

            <app-input
              label="Cantidad"
              type="number"
              formControlName="quantity"
              placeholder="1"
              [error]="getErrorMessage('quantity')"
              [required]="true"
            ></app-input>

            <app-textarea
              label="Notas"
              formControlName="notes"
              placeholder="Notas adicionales sobre este producto..."
              [rows]="2"
            ></app-textarea>
          </section>
        </form>
      </div>

      <!-- Footer -->
      <div slot="footer" class="max-w-full">
        <div
          class="flex items-center justify-end gap-2 md:gap-3 p-2 md:px-4 md:py-3 bg-gray-50 rounded-b-xl"
        >
          <app-button
            variant="outline"
            (clicked)="onClose()"
            customClasses="!rounded-xl flex-1 sm:flex-none font-bold"
          >
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            (clicked)="onAdd()"
            [disabled]="!isFormValid()"
            customClasses="!rounded-xl flex-1 sm:flex-none font-bold shadow-md shadow-primary-200 active:scale-95 transition-all"
          >
            Agregar al carrito
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
  styleUrls: ['./pop-prebulk-modal.component.scss'],
})
export class PopPreBulkModalComponent {
  private fb = inject(FormBuilder);
  private destroyRef = inject(DestroyRef);
  private uomService = inject(UomService);
  private authFacade = inject(AuthFacade);

  /**
   * Capability resolver (Fase 0). When false, the ingredient section is
   * hidden entirely and the modal always emits a retail product.
   */
  readonly storeSupportsIngredients = this.authFacade.storeSupportsIngredients;

  readonly isOpen = model<boolean>(false);

  readonly close = output<void>();
  readonly add = output<{
    prebulkData: PreBulkData;
    quantity: number;
    unit_cost: number;
    notes?: string;
  }>();

  // ============================================================
  // Ingredient state (signals — zoneless safe)
  // ============================================================

  /** Whether the new product is an ingredient. Default false (retail). */
  readonly isIngredient = signal(false);
  /** Soft exclusivity with `isIngredient`: ingredient => not sellable. */
  readonly isSellable = signal(true);
  /** Per-modal UoM selection (only relevant when `isIngredient`). */
  readonly purchaseUomId = signal<number | null>(null);
  readonly stockUomId = signal<number | null>(null);

  /**
   * UoM catalog. Loaded lazily on first modal open via a cached HTTP call
   * (UomService uses shareReplay, so repeated opens are no-ops).
   */
  readonly uomCatalog = signal<
    Array<{
      id: number;
      code: string;
      name: string;
      dimension: string;
      factor_to_base: number | string;
      is_active: boolean;
    }>
  >([]);

  readonly form: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(255)]],
    code: ['', [Validators.required, Validators.maxLength(64)]],
    description: [''],
    quantity: [1, [Validators.required, Validators.min(1)]],
    unitCost: [0, [Validators.required, Validators.min(0)]],
    basePrice: [0, [Validators.min(0)]],
    notes: [''],
  });

  // Track form value changes as a signal so computed() recalculates.
  private readonly formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.value,
  });

  // Track form status changes so validity computed updates reactively.
  private readonly formStatus = toSignal(this.form.statusChanges, {
    initialValue: this.form.status,
  });

  // ============================================================
  // Computed
  // ============================================================

  readonly calculatedTotal = computed(() => {
    const v = this.formValue();
    const qty = Number(v?.quantity) || 0;
    const cost = Number(v?.unitCost) || 0;
    return qty * cost;
  });

  /**
   * Live preview of the purchase→stock factor the backend will compute on
   * receive(). Mirrors `unitCapacity` from the config modal. Null when the
   * user has not picked both UoMs, or they belong to different dimensions.
   */
  readonly unitCapacity = computed<{
    value: number;
    unit: string;
    purchaseUnit: string;
  } | null>(() => {
    const purchaseId = this.purchaseUomId();
    const stockId = this.stockUomId();
    if (!purchaseId || !stockId) return null;
    const opts = this.uomCatalog();
    const stock = opts.find((u) => u.id === stockId);
    const purchase = opts.find((u) => u.id === purchaseId);
    if (!stock || !purchase) return null;
    if (stock.dimension !== purchase.dimension) return null;
    const sf = Number(stock.factor_to_base);
    const pf = Number(purchase.factor_to_base);
    if (!Number.isFinite(sf) || !Number.isFinite(pf) || pf <= 0) return null;
    const factor = Math.round((pf / sf) * 1e6) / 1e6;
    return {
      value: factor,
      unit: stock.code,
      purchaseUnit: purchase.code,
    };
  });

  /**
   * Dynamic label for the cost input. Retail mode keeps "Costo Unitario".
   * Ingredient mode shows the purchase presentation ("Costo por L", etc.).
   */
  readonly costInputLabel = computed(() => {
    if (!this.isIngredient()) return 'Costo Unitario';
    const purchaseId = this.purchaseUomId();
    if (!purchaseId) return 'Costo por unidad de compra';
    const purchase = this.uomCatalog().find((u) => u.id === purchaseId);
    return purchase ? `Costo por ${purchase.code}` : 'Costo por unidad de compra';
  });

  readonly isFormValid = computed(() => {
    if (this.formStatus() !== 'VALID') return false;
    // When marked as ingredient, both UoMs are mandatory.
    if (this.isIngredient()) {
      return this.purchaseUomId() != null && this.stockUomId() != null;
    }
    return true;
  });

  // ============================================================
  // Lifecycle
  // ============================================================

  constructor() {
    // Fase 5: emit a single deprecation warning the first time this
    // modal is instantiated. The orchestrator only loads this component
    // when `POP_USE_UNIFIED_MODAL=false`, so production users on the
    // default flag never see this warning.
    console.warn(
      '[POP] PopPreBulkModalComponent is deprecated. Use PopProductConfigModalComponent(mode="create") instead. See pop.config.ts.',
    );

    // Reset the form whenever the modal closes, so each open starts clean.
    effect(() => {
      if (!this.isOpen()) {
        this.resetForm();
      }
    });

    // Load the UoM catalog on first open (cached internally by the service).
    effect(() => {
      if (this.isOpen() && this.uomCatalog().length === 0) {
        this.loadUoMCatalog();
      }
    });
  }

  /**
   * Loads the global UoM catalog. The service caches results via
   * shareReplay, so this is a no-op after the first successful call.
   * Errors are non-fatal: the ingredient section simply shows no options.
   */
  private loadUoMCatalog(): void {
    this.uomService
      .getCatalog()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          const data = Array.isArray(res?.data) ? res.data : [];
          this.uomCatalog.set(data);
        },
        error: () => {
          this.uomCatalog.set([]);
        },
      });
  }

  /**
   * Soft exclusivity: turning the ingredient flag on marks the product as
   * non-sellable; turning it off restores sellable and clears the UoM
   * selection so a retail product never carries stale FKs.
   */
  onIngredientToggle(value: boolean): void {
    this.isIngredient.set(value);
    this.isSellable.set(!value);
    if (!value) {
      this.purchaseUomId.set(null);
      this.stockUomId.set(null);
    }
  }

  // ============================================================
  // Actions
  // ============================================================

  onAdd(): void {
    // Block submit when the form is invalid OR (ingredient && missing UoM).
    if (!this.isFormValid()) {
      this.form.markAllAsTouched();
      return;
    }

    const v = this.form.value;
    const ingredient = this.isIngredient();

    this.add.emit({
      prebulkData: {
        name: v.name,
        code: v.code,
        description: v.description || undefined,
        base_price: Number(v.basePrice) || 0,
        is_ingredient: ingredient,
        is_sellable: this.isSellable(),
        // UoM FKs only travel for ingredients; retail stays null.
        purchase_uom_id: ingredient ? this.purchaseUomId() : null,
        stock_uom_id: ingredient ? this.stockUomId() : null,
      },
      quantity: Number(v.quantity),
      unit_cost: Number(v.unitCost),
      notes: v.notes || undefined,
    });

    this.resetForm();
    this.isOpen.set(false);
    this.close.emit();
  }

  onClose(): void {
    this.isOpen.set(false);
    this.close.emit();
  }

  onCancel(): void {
    this.isOpen.set(false);
    this.close.emit();
  }

  // ============================================================
  // Helpers
  // ============================================================

  getErrorMessage(fieldName: string): string {
    const field = this.form.get(fieldName);
    if (!field || !field.errors || !field.touched) return '';

    const errors = field.errors;
    if (errors['required']) return 'Este campo es obligatorio';
    if (errors['min']) return `El valor mínimo es ${errors['min'].min}`;
    if (errors['maxlength'])
      return `Máximo ${errors['maxlength'].requiredLength} caracteres`;
    return 'Entrada inválida';
  }

  private resetForm(): void {
    this.form.reset({
      name: '',
      code: '',
      description: '',
      quantity: 1,
      unitCost: 0,
      basePrice: 0,
      notes: '',
    });
    // Reset ingredient state so each open starts as a clean retail product.
    this.isIngredient.set(false);
    this.isSellable.set(true);
    this.purchaseUomId.set(null);
    this.stockUomId.set(null);
  }
}
