import {
  Component,
  computed,
  effect,
  inject,
  model,
  output,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';

import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';

import { PreBulkData } from '../interfaces/pop-cart.interface';

/**
 * POP Pre-Bulk Product Modal
 * Adds temporary products to purchase order that don't exist in catalog.
 *
 * UX aligned with `product-create-modal.component` (structured sections,
 * Reactive Forms, currency input mode). The product is NOT persisted in
 * the catalog — it only lives on this specific purchase order.
 */
@Component({
  selector: 'app-pop-prebulk-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    TextareaComponent,
    IconComponent,
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

          <!-- Section 2: Pricing -->
          <section class="space-y-3">
            <h3
              class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]"
            >
              Precio y costo
            </h3>

            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
              <app-input
                label="Costo Unitario"
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

  readonly isOpen = model<boolean>(false);

  readonly close = output<void>();
  readonly add = output<{
    prebulkData: PreBulkData;
    quantity: number;
    unit_cost: number;
    notes?: string;
  }>();

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

  readonly isFormValid = computed(() => this.formStatus() === 'VALID');

  // ============================================================
  // Lifecycle
  // ============================================================

  constructor() {
    // Reset the form whenever the modal closes, so each open starts clean.
    effect(() => {
      if (!this.isOpen()) {
        this.resetForm();
      }
    });
  }

  // ============================================================
  // Actions
  // ============================================================

  onAdd(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const v = this.form.value;

    this.add.emit({
      prebulkData: {
        name: v.name,
        code: v.code,
        description: v.description || undefined,
        base_price: Number(v.basePrice) || 0,
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
  }
}
