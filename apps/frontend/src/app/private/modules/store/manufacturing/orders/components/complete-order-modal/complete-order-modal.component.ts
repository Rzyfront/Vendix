import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  ToastService,
} from '../../../../../../../shared/components/index';

import {
  CompleteManufacturingOrderDto,
  ManufacturingOrder,
} from '../../../interfaces';
import { ManufacturingOrdersService } from '../../../services';

/**
 * Modal "Completar orden": registra la cantidad realmente producida (total o
 * parcial) y, opcionalmente, el lote del producto terminado.
 */
@Component({
  selector: 'app-complete-order-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    ButtonComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      size="md"
      title="Completar orden de producción"
      [subtitle]="subtitle()"
    >
      <form [formGroup]="form" (ngSubmit)="submit()" class="space-y-4">
        <app-input
          type="number"
          formControlName="produced_qty"
          label="Cantidad producida"
          step="0.0001"
          [min]="0"
          [required]="true"
          [helperText]="
            'Pendiente: ' + remaining() + '. Si produces menos, la orden queda parcialmente completada y podrás completar el resto después.'
          "
        />

        <div class="rounded-lg border border-[var(--color-border)] p-3 space-y-3">
          <div>
            <p class="text-sm font-semibold text-text-primary">Lote del producto terminado</p>
            <p class="text-xs text-text-secondary">
              @if (lotRequired()) {
                La planta exige lote: indica los datos del lote que ingresa.
              } @else {
                Opcional: déjalo vacío si no manejas lotes.
              }
            </p>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <app-input
              formControlName="batch_number"
              label="Número de lote"
              placeholder="Ej. L-2026-001"
            />
            <app-input
              type="date"
              formControlName="manufacturing_date"
              label="Fabricación"
            />
            <app-input
              type="date"
              formControlName="expiration_date"
              label="Vencimiento"
            />
          </div>
        </div>
      </form>

      <div slot="footer" class="flex flex-col-reverse md:flex-row md:justify-end gap-2">
        <app-button variant="outline" [disabled]="isSubmitting()" (clicked)="close()">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          [loading]="isSubmitting()"
          [disabled]="isSubmitting()"
          (clicked)="submit()"
        >
          <app-icon name="check" [size]="16" slot="icon" />
          Completar y registrar stock
        </app-button>
      </div>
    </app-modal>
  `,
})
export class CompleteOrderModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly ordersService = inject(ManufacturingOrdersService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly order = input.required<ManufacturingOrder>();
  readonly lotRequired = input<boolean>(false);

  /** Emite la orden actualizada tras completar. */
  readonly completed = output<ManufacturingOrder>();

  readonly isSubmitting = signal(false);

  readonly remaining = computed(() => {
    const o = this.order();
    const left = Number(o.planned_qty) - Number(o.produced_qty ?? 0);
    const value = left > 0 ? left : 0;
    return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/\.?0+$/, '');
  });

  readonly subtitle = computed(
    () =>
      `${this.order().order_number ?? `#${this.order().id}`} · ${this.order().product?.name ?? ''}`,
  );

  readonly form = this.fb.nonNullable.group({
    produced_qty: this.fb.nonNullable.control<number | null>(null, [
      Validators.required,
      Validators.min(0.0001),
    ]),
    batch_number: this.fb.nonNullable.control(''),
    manufacturing_date: this.fb.nonNullable.control(''),
    expiration_date: this.fb.nonNullable.control(''),
  });

  constructor() {
    // Al abrir, el valor por defecto es lo que falta por producir.
    effect(() => {
      if (!this.isOpen()) return;
      const remaining = Number(this.remaining());
      untracked(() => {
        this.form.reset({
          produced_qty: remaining > 0 ? remaining : null,
          batch_number: '',
          manufacturing_date: '',
          expiration_date: '',
        });
      });
    });
  }

  close(): void {
    this.isOpen.set(false);
  }

  submit(): void {
    if (this.isSubmitting()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toastService.error('Indica una cantidad producida mayor a 0');
      return;
    }
    const raw = this.form.getRawValue();
    const batch = {
      ...(raw.batch_number.trim() ? { batch_number: raw.batch_number.trim() } : {}),
      ...(raw.manufacturing_date ? { manufacturing_date: raw.manufacturing_date } : {}),
      ...(raw.expiration_date ? { expiration_date: raw.expiration_date } : {}),
    };
    if (this.lotRequired() && Object.keys(batch).length === 0) {
      this.toastService.error('La planta exige lote: completa los datos del lote');
      return;
    }
    const dto: CompleteManufacturingOrderDto = {
      produced_qty: Number(raw.produced_qty),
      ...(Object.keys(batch).length > 0 ? { batch } : {}),
    };

    this.isSubmitting.set(true);
    this.ordersService
      .complete(this.order().id, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.isSubmitting.set(false);
          this.toastService.success(
            updated.status === 'completed'
              ? 'Orden completada: insumos consumidos y producto terminado ingresado'
              : 'Producción parcial registrada: la orden sigue abierta',
          );
          this.isOpen.set(false);
          this.completed.emit(updated);
        },
        error: (error) => {
          this.isSubmitting.set(false);
          this.toastService.error(
            typeof error === 'string' ? error : 'Error al completar la orden',
          );
        },
      });
  }
}
