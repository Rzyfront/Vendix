import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
} from '@angular/forms';

import {
  SelectorComponent,
  SelectorOption,
} from '../../selector/selector.component';
import { IconComponent } from '../../icon/icon.component';

export type CostingMethod = 'FIFO' | 'WEIGHTED_AVERAGE' | 'STANDARD';

export interface InitialInventoryValue {
  costing_method: CostingMethod;
  capture_initial_balance_later: boolean;
}

interface InitialInventoryControls {
  costing_method: FormControl<CostingMethod>;
  capture_initial_balance_later: FormControl<boolean>;
}

interface CostingMethodDetails {
  /** Short label shown in the header of the active-option panel. */
  heading: string;
  /** One-sentence description of how the method works. */
  summary: string;
  /** Concrete Colombian-SMB example that helps the user recognize the use case. */
  example: string;
  /** Short benefit/when-to-use tag shown in the info box. */
  whenToUse: string;
  /** Optional caveat the user should know before picking this option. */
  caveat?: string;
}

const COSTING_METHOD_DETAILS: Record<CostingMethod, CostingMethodDetails> = {
  FIFO: {
    heading: 'FIFO — Primero en entrar, primero en salir',
    summary:
      'Vende primero las unidades más antiguas del inventario. Cada venta se valora al costo del lote más viejo disponible.',
    example:
      'Compraste 10 unidades a $100 (lote 1) y luego 10 a $120 (lote 2). Al vender 8, se valoran al costo del lote 1 ($100).',
    whenToUse: 'Productos perecederos, inventarios con fecha de vencimiento.',
    caveat:
      'En inflación alta, el costo de ventas subestima el costo real (mayor utilidad reportada).',
  },
  WEIGHTED_AVERAGE: {
    heading: 'Promedio ponderado (CPP)',
    summary:
      'Después de cada compra, el costo unitario se recalcula como el promedio de todo el inventario disponible.',
    example:
      'Con 10 unidades a $100 y 10 a $120, el costo promedio queda en $110 — y se mantiene hasta la siguiente compra.',
    whenToUse: 'La mayoría de comercios y PYMES. Simple, estable y audit-friendly.',
    caveat: 'No refleja capas por lote, solo un costo promedio único.',
  },
  STANDARD: {
    heading: 'Costo estándar',
    summary:
      'Usa un costo fijo predefinido por producto. Las diferencias contra el costo real se llevan a una cuenta de variaciones.',
    example:
      'Fijas la caja a $5.000. Si el proveedor la cobra a $5.200, la diferencia de $200 va a la cuenta de variaciones y se ajusta mensualmente.',
    whenToUse: 'Empresas con tarifas pactadas o producción estandarizada.',
    caveat:
      'Requiere actualizar el estándar periódicamente — sino, los reportes se desalinean del costo real.',
  },
};

@Component({
  selector: 'app-initial-inventory-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, SelectorComponent, IconComponent],
  template: `
    <form [formGroup]="form" class="space-y-4">
      <app-selector
        label="Método de valoración de inventario"
        formControlName="costing_method"
        [options]="costingMethodOptions"
        [required]="true"
        tooltipText="Define cómo se calcula el costo de la mercancía vendida. FIFO: primero en entrar, primero en salir. Promedio ponderado: costo promedio. Estándar: costo fijo predefinido."
      ></app-selector>

      <div class="p-3 rounded-lg bg-blue-50 border border-blue-100 text-xs text-blue-700 space-y-1">
        <div><strong>FIFO:</strong> Las unidades más antiguas se venden primero. Recomendado para productos perecederos.</div>
        <div><strong>Promedio ponderado:</strong> Calcula el costo promedio de cada producto. Más simple y estable.</div>
        <div><strong>Estándar:</strong> Costo fijo predefinido. Requiere ajustes periódicos.</div>
      </div>

      <!--
        Active-option help panel. Expands inline with a detailed explanation
        and a concrete example for the costing method the user has just
        selected. aria-live="polite" lets assistive tech announce the
        change without stealing focus. The role="region" with an
        aria-label gives screen-reader users a stable landmark.
      -->
      <section
        role="region"
        aria-live="polite"
        aria-atomic="true"
        aria-label="Detalle del método de valoración seleccionado"
        class="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-2"
      >
        <header class="flex items-start gap-2">
          <app-icon
            name="info"
            [size]="16"
            class="text-emerald-700 mt-0.5 shrink-0"
          ></app-icon>
          <div class="min-w-0">
            <h4 class="text-sm font-semibold text-emerald-900">
              {{ activeCostingDetails().heading }}
            </h4>
            <p class="text-xs text-emerald-800 mt-0.5">
              {{ activeCostingDetails().summary }}
            </p>
          </div>
        </header>

        <div class="rounded-md bg-white/70 border border-emerald-100 p-2.5">
          <div class="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
            Ejemplo
          </div>
          <p class="text-xs text-emerald-900 mt-1">
            {{ activeCostingDetails().example }}
          </p>
        </div>

        <div class="flex flex-wrap gap-1.5 text-[11px]">
          <span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
            <strong>Cuándo usarlo:</strong> {{ activeCostingDetails().whenToUse }}
          </span>
          @if (activeCostingDetails().caveat) {
            <span class="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
              <strong>A tener en cuenta:</strong> {{ activeCostingDetails().caveat }}
            </span>
          }
        </div>
      </section>

      <label class="flex items-start gap-2 text-sm cursor-pointer p-2 rounded border border-border">
        <input
          type="checkbox"
          class="mt-0.5"
          [checked]="form.controls.capture_initial_balance_later.value"
          [disabled]="disabled()"
          (change)="onCaptureLaterToggle($event)"
        />
        <span class="text-text-secondary">
          Capturar saldo inicial de inventario más tarde
          <span class="block text-xs text-text-muted mt-0.5">
            Esta opción es informativa. Podrá registrar el saldo inicial desde el módulo de ajustes de inventario.
          </span>
        </span>
      </label>
    </form>
  `,
})
export class InitialInventoryFormComponent {
  readonly initialValue = input<Partial<InitialInventoryValue> | null>(null);
  readonly disabled = input<boolean>(false);

  readonly valueChange = output<InitialInventoryValue>();
  readonly validityChange = output<boolean>();

  readonly valid = signal(true);

  private readonly destroyRef = inject(DestroyRef);

  readonly form: FormGroup<InitialInventoryControls> = new FormGroup<InitialInventoryControls>(
    {
      costing_method: new FormControl<CostingMethod>('WEIGHTED_AVERAGE', {
        nonNullable: true,
      }),
      capture_initial_balance_later: new FormControl(true, { nonNullable: true }),
    },
  );

  readonly costingMethodOptions: SelectorOption[] = [
    { value: 'FIFO', label: 'FIFO (Primero en entrar, primero en salir)' },
    { value: 'WEIGHTED_AVERAGE', label: 'Promedio ponderado' },
    { value: 'STANDARD', label: 'Costo estándar' },
  ];

  /**
   * Tracks the currently selected costing method. We mirror the form
   * control value into a signal so the active-option panel can be a
   * `computed` derived purely from reactive state — no manual `effect`
   * cleanup, no DOM event listeners.
   */
  readonly costingMethod = signal<CostingMethod>('WEIGHTED_AVERAGE');

  readonly activeCostingDetails = computed<CostingMethodDetails>(
    () => COSTING_METHOD_DETAILS[this.costingMethod()],
  );

  constructor() {
    effect(() => {
      const v = this.initialValue();
      if (v) {
        this.form.patchValue(v, { emitEvent: false });
        this.emitCurrent();
      }
    });

    effect(() => {
      if (this.disabled()) this.form.disable({ emitEvent: false });
      else this.form.enable({ emitEvent: false });
    });

    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.costingMethod.set(this.form.controls.costing_method.value);
        this.emitCurrent();
      });
  }

  getValue(): InitialInventoryValue {
    return this.form.getRawValue();
  }

  markAllTouched(): void {
    this.form.markAllAsTouched();
  }

  onCaptureLaterToggle(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.form.controls.capture_initial_balance_later.setValue(checked);
  }

  private emitCurrent(): void {
    const isValid = this.form.valid;
    this.valid.set(isValid);
    this.validityChange.emit(isValid);
    this.valueChange.emit(this.form.getRawValue());
  }
}
