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
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  TextareaComponent,
} from '../../../../../../shared/components/index';
import { TransferProductPickerComponent } from './transfer-product-picker.component';
import {
  TransferDraft,
  TransferDraftHandoffService,
  TransferDraftLine,
  TransferPayload,
  TransferPickerRow,
  TransferProductSearchFn,
  buildTransferPayload,
  mergePickerRows,
  totalUnits,
} from './transfer-draft';

/**
 * Movimiento rápido de inventario entre bodegas propias (D1 + D9), compartido
 * por tienda y organización.
 *
 * Mueve el inventario al instante (`POST .../complete`): origen −, destino +,
 * y solo deja el registro del movimiento y quién lo hizo. Sin transporte ni
 * remisión — eso vive en la vista avanzada, a la que se llega marcando
 * "Movimiento masivo o avanzado" y arrastrando lo ya llenado.
 */
@Component({
  selector: 'app-transfer-quick-move-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    SelectorComponent,
    TextareaComponent,
    IconComponent,
    TransferProductPickerComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      title="Mover inventario"
      size="lg"
      subtitle="Entre tus bodegas, al instante"
      [canClose]="canClose"
      (closed)="onCancel()"
      (isOpenChange)="isOpenChange.emit($event)"
    >
      <div class="space-y-4">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-2">
              Bodega de origen *
            </label>
            <app-selector
              [options]="locationOptions()"
              [ngModel]="fromLocationId()"
              placeholder="Seleccionar origen"
              (ngModelChange)="onFromChange($event)"
            ></app-selector>
          </div>
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-2">
              Bodega de destino *
            </label>
            <app-selector
              [options]="destinationOptions()"
              [ngModel]="toLocationId()"
              placeholder="Seleccionar destino"
              (ngModelChange)="onToChange($event)"
            ></app-selector>
          </div>
        </div>

        @if (sameLocation()) {
          <div
            class="p-3 bg-error/10 rounded-xl border border-error/30 text-sm text-error flex items-center gap-2"
          >
            <app-icon name="alert-circle" [size]="16"></app-icon>
            El origen y el destino deben ser bodegas diferentes.
          </div>
        } @else if (noDestination()) {
          <div
            class="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm flex items-center gap-2"
          >
            <app-icon name="alert-triangle" [size]="16"></app-icon>
            No tienes otra bodega para mover inventario. Crea una bodega primero.
          </div>
        }

        <app-transfer-product-picker
          [fromLocationId]="fromLocationId()"
          [toLocationId]="toLocationId()"
          [searchFn]="searchFn()"
          [addedKeys]="addedKeys()"
          (add)="onAddRows($event)"
        ></app-transfer-product-picker>

        <!-- Líneas de la orden -->
        @if (lines().length === 0) {
          <div class="p-6 text-center border border-dashed border-border rounded-xl">
            <app-icon name="package" [size]="28" class="mx-auto mb-2 text-gray-300"></app-icon>
            <p class="text-sm text-text-secondary">
              Busca productos arriba y agrégalos con sus cantidades.
            </p>
          </div>
        } @else {
          <div class="border border-border rounded-xl overflow-hidden">
            <div
              class="grid grid-cols-[1fr_76px_84px_84px_32px] gap-0 bg-surface-secondary text-xs font-medium text-text-secondary border-b border-border"
            >
              <div class="px-3 py-2">Producto</div>
              <div class="px-2 py-2 text-center">Cantidad</div>
              <div class="px-2 py-2 text-center">Origen</div>
              <div class="px-2 py-2 text-center">Destino</div>
              <div class="px-1 py-2"></div>
            </div>

            @for (line of lines(); track line.key; let i = $index) {
              <div
                class="grid grid-cols-[1fr_76px_84px_84px_32px] gap-0 items-center border-b border-border last:border-b-0"
                [attr.data-testid]="'quick-line-' + line.key"
              >
                <div class="px-3 py-2.5 min-w-0">
                  <p class="text-sm font-medium text-text-primary truncate">
                    {{ line.product_name }}
                    @if (line.variant_name) {
                      <span class="text-text-secondary">· {{ line.variant_name }}</span>
                    }
                  </p>
                  <p class="text-xs text-text-secondary truncate">
                    {{ line.sku || 'Sin SKU' }} · quedan
                    {{ line.available_at_origin - line.quantity }} en origen
                  </p>
                </div>
                <div class="px-2 py-2.5">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    [value]="line.quantity"
                    [attr.data-testid]="'quick-qty-' + line.key"
                    (input)="onQuantityChange(i, $event)"
                    class="w-full px-2 py-1 text-sm text-center border border-border rounded-lg bg-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  />
                </div>
                <div class="px-2 py-2.5 text-center text-xs">
                  <span class="text-text-secondary">{{ line.available_at_origin }}</span>
                  <app-icon name="arrow-right" [size]="12" class="mx-0.5 text-text-secondary"></app-icon>
                  <span
                    class="font-bold"
                    [class.text-error]="originAfter(line) < 0"
                    [class.text-text-primary]="originAfter(line) >= 0"
                  >{{ originAfter(line) }}</span>
                </div>
                <div class="px-2 py-2.5 text-center text-xs">
                  <span class="text-text-secondary">{{ line.available_at_destination }}</span>
                  <app-icon name="arrow-right" [size]="12" class="mx-0.5 text-text-secondary"></app-icon>
                  <span class="font-bold text-success">{{ destinationAfter(line) }}</span>
                </div>
                <div class="px-1 py-2.5 text-center">
                  <button
                    type="button"
                    class="text-error hover:text-error/80 transition-colors"
                    [attr.aria-label]="'Quitar ' + line.product_name"
                    [attr.data-testid]="'quick-remove-' + line.key"
                    (click)="removeLine(i)"
                  >
                    <app-icon name="trash-2" [size]="15"></app-icon>
                  </button>
                </div>
              </div>
            }
          </div>

          @if (invalidLine()) {
            <div
              class="p-3 bg-error/10 rounded-xl border border-error/30 text-sm text-error flex items-center gap-2"
            >
              <app-icon name="alert-triangle" [size]="16"></app-icon>
              {{ invalidLine() }}
            </div>
          }
        }

        <div class="flex items-center justify-between gap-3">
          <p class="text-sm text-text-secondary">
            {{ lines().length }} producto(s) · {{ units() }} unidad(es)
          </p>
          <p class="text-sm text-text-secondary">
            El movimiento se aplica al confirmar: no hay paso de aprobación.
          </p>
        </div>

        <app-textarea
          label="Notas (opcional)"
          [ngModel]="notes()"
          (ngModelChange)="notes.set($event)"
          [rows]="2"
          placeholder="Motivo o referencia del movimiento..."
        ></app-textarea>

        <label
          class="flex items-start gap-3 p-3 bg-surface-secondary rounded-xl border border-border cursor-pointer select-none"
        >
          <input
            type="checkbox"
            class="mt-0.5 w-4 h-4 rounded border-border text-primary focus:ring-primary"
            data-testid="quick-advanced-toggle"
            [checked]="advanced()"
            (change)="onAdvancedToggle($any($event.target).checked)"
          />
          <div>
            <p class="text-sm font-medium text-text-primary">
              Movimiento masivo o avanzado
            </p>
            <p class="text-xs text-text-secondary mt-0.5">
              Transporte, remisión, borrador y aprobación. Te llevamos a la vista
              avanzada con lo que ya llenaste.
            </p>
          </div>
        </label>
      </div>

      <div slot="footer" class="flex justify-between items-center gap-3 px-6 py-4 bg-gray-50 rounded-b-xl">
        <button
          type="button"
          class="text-xs text-text-secondary underline hover:text-primary"
          data-testid="quick-use-detailed"
          (click)="useDetailedFlow.emit()"
        >
          Flujo detallado (borrador → aprobar → despachar)
        </button>
        <div class="flex gap-3">
          <app-button
            variant="outline"
            type="button"
            customClasses="!rounded-xl font-bold !text-error !border-error hover:!bg-error/5"
            (clicked)="onCancel()"
          >
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            type="button"
            data-testid="quick-move-submit"
            [loading]="isSubmitting()"
            [disabled]="!payload() || isSubmitting()"
            customClasses="!rounded-xl font-bold shadow-md shadow-primary-200 active:scale-95 transition-all"
            (clicked)="onSubmit()"
          >
            <app-icon name="repeat" [size]="14" class="mr-1.5" slot="icon"></app-icon>
            Mover ahora
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class TransferQuickMoveModalComponent {
  private readonly router = inject(Router);
  private readonly handoff = inject(TransferDraftHandoffService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = input(false);
  readonly isSubmitting = input(false);
  readonly locations = input<SelectorOption[]>([]);
  readonly searchFn = input.required<TransferProductSearchFn>();
  /** Ruta de la vista avanzada de esta superficie (tienda u organización). */
  readonly advancedRoute = input('');

  readonly isOpenChange = output<boolean>();
  readonly cancel = output<void>();
  readonly quickMove = output<TransferPayload>();
  readonly useDetailedFlow = output<void>();

  readonly fromLocationId = signal<number | null>(null);
  readonly toLocationId = signal<number | null>(null);
  readonly notes = signal('');
  readonly lines = signal<TransferDraftLine[]>([]);
  readonly advanced = signal(false);

  /** Memoria del effect: detecta el flanco cerrado → abierto. */
  private wasOpen = false;

  readonly locationOptions = computed(() => this.locations());

  readonly destinationOptions = computed(() => {
    const from = this.fromLocationId();
    return this.locations().filter((l) => l.value !== from);
  });

  readonly sameLocation = computed(() => {
    const from = this.fromLocationId();
    const to = this.toLocationId();
    return from != null && to != null && from === to;
  });

  readonly noDestination = computed(
    () => this.fromLocationId() != null && this.destinationOptions().length === 0,
  );

  readonly addedKeys = computed(() => this.lines().map((l) => l.key));

  readonly units = computed(() => totalUnits(this.lines()));

  /** Primer error de cantidad, en texto para el comerciante. */
  readonly invalidLine = computed<string | null>(() => {
    for (const line of this.lines()) {
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        return `La cantidad de ${line.product_name} debe ser un número entero mayor que cero.`;
      }
      if (line.quantity > line.available_at_origin) {
        return `Solo hay ${line.available_at_origin} de ${line.product_name} en la bodega de origen.`;
      }
    }
    return null;
  });

  readonly payload = computed(() =>
    buildTransferPayload({
      from_location_id: this.fromLocationId(),
      to_location_id: this.toLocationId(),
      notes: this.notes(),
      lines: this.lines(),
    }),
  );

  readonly canClose = (): Promise<boolean> => Promise.resolve(true);

  constructor() {
    effect(() => {
      const open = this.isOpen();
      if (open && !this.wasOpen) this.reset();
      this.wasOpen = open;
    });
    this.destroyRef.onDestroy(() => undefined);
  }

  onFromChange(value: string | number | null): void {
    const id = value == null || value === '' ? null : Number(value);
    if (id !== this.fromLocationId()) {
      // Cambiar de origen cambia el disponible: las líneas dejan de ser válidas.
      this.lines.set([]);
    }
    this.fromLocationId.set(id);
    if (id != null && this.toLocationId() === id) this.toLocationId.set(null);
  }

  onToChange(value: string | number | null): void {
    this.toLocationId.set(value == null || value === '' ? null : Number(value));
  }

  onAddRows(rows: TransferPickerRow[]): void {
    const merged = mergePickerRows(this.lines(), rows);
    this.lines.set(merged.lines);
  }

  removeLine(index: number): void {
    this.lines.update((lines) => lines.filter((_, i) => i !== index));
  }

  /**
   * Cantidad editable: entero ≥ 1. Un valor mayor al disponible se conserva
   * tal cual para que el comerciante vea el error (`invalidLine`) en vez de que
   * el número cambie solo.
   */
  onQuantityChange(index: number, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const parsed = Number(raw);
    const quantity = raw === '' || !Number.isFinite(parsed) ? 0 : Math.floor(parsed);
    this.lines.update((lines) =>
      lines.map((line, i) => (i === index ? { ...line, quantity } : line)),
    );
  }

  originAfter(line: TransferDraftLine): number {
    return line.available_at_origin - line.quantity;
  }

  destinationAfter(line: TransferDraftLine): number {
    return line.available_at_destination + line.quantity;
  }

  onAdvancedToggle(checked: boolean): void {
    this.advanced.set(checked);
    if (!checked) return;
    const draft = this.buildDraft();
    if (draft) this.handoff.set(draft);
    const route = this.advancedRoute();
    if (route) {
      void this.router.navigate([route]);
    }
    this.isOpenChange.emit(false);
  }

  onSubmit(): void {
    const payload = this.payload();
    if (!payload) return;
    this.quickMove.emit(payload);
  }

  onCancel(): void {
    this.reset();
    this.cancel.emit();
  }

  private buildDraft(): TransferDraft | null {
    const from = this.fromLocationId();
    const to = this.toLocationId();
    if (from == null || to == null || from === to) return null;
    return {
      from_location_id: from,
      to_location_id: to,
      from_location_name: this.labelOf(from),
      to_location_name: this.labelOf(to),
      notes: this.notes(),
      lines: this.lines().map((l) => ({ ...l })),
    };
  }

  private labelOf(id: number | null): string {
    if (id == null) return '';
    return this.locations().find((l) => l.value === id)?.label ?? '';
  }

  private reset(): void {
    this.fromLocationId.set(null);
    this.toLocationId.set(null);
    this.notes.set('');
    this.lines.set([]);
    this.advanced.set(false);
  }
}
