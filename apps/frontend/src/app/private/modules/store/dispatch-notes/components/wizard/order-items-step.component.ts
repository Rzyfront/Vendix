import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  EmptyStateComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  TextareaComponent,
} from '../../../../../../shared/components';
import type { SelectorOption } from '../../../../../../shared/components';

import { LocationsService } from '../../../inventory/services/locations.service';
import type {
  ApiResponse,
  InventoryLocation,
} from '../../../inventory/interfaces';
import { DispatchNotesService } from '../../services/dispatch-notes.service';
import { DispatchNoteWizardService } from '../../services/dispatch-note-wizard.service';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { toLocalDateString } from '../../../../../../shared/utils/date.util';
import { WizardStepSectionComponent } from './wizard-step-section.component';

/**
 * Fused "Ítems y bodega" step for the customer_delivery flow (step index 2).
 *
 * Merges what used to be two separate steps:
 *   1. **Items** — precargados desde la orden; el operario ajusta las
 *      cantidades a despachar (clamp a `pending_quantity` vía
 *      `wizardService.updateItemQuantity`). Se preserva el quick-accept
 *      (`quickAcceptAll` / `clearQuantities`) y el estado vacío.
 *   2. **Bodega de origen + entrega** — replica la lógica de `details-step`:
 *      selector de bodega (required → `dispatch_location_id`), fecha acordada
 *      de entrega y notas (colapsables). Todo escrito vía
 *      `wizardService.setDetails`.
 *
 * `canProceed` (case 2) exige ítems válidos **y** `dispatch_location_id`, por
 * eso la bodega se elige EN ESTE MISMO paso (regla de negocio: los ítems y la
 * bodega desde donde salen se verifican juntos).
 *
 * `pending_quantity` se computa restando la suma de
 * `dispatch_note_items[].dispatched_quantity` ya creada para cada order_item
 * (query `DispatchNotesService.getByOrder(orderId)` al montar). Mitiga el
 * doble despacho de V1.
 *
 * Zoneless puro: signal/computed, sin NgZone/markForCheck.
 */
@Component({
  selector: 'app-dispatch-wizard-order-items-step',
  standalone: true,
  imports: [
    CurrencyPipe,
    EmptyStateComponent,
    FormsModule,
    IconComponent,
    InputComponent,
    ReactiveFormsModule,
    SelectorComponent,
    TextareaComponent,
    WizardStepSectionComponent,
  ],
  template: `
    <div class="space-y-4">
      <!-- ═══ ÍTEMS ═══ -->
      <app-wizard-step-section
        icon="package"
        title="Ítems y bodega"
        subtitle="Verifica los ítems y elige la bodega de origen"
        [dense]="true"
      >
        @if (items().length === 0) {
          <app-empty-state
            icon="package"
            title="Sin ítems"
            description="La orden seleccionada no tiene ítems para despachar."
          ></app-empty-state>
        } @else {
          <div class="flex items-start justify-between gap-2">
            <p class="text-xs text-[var(--color-text-muted)] leading-snug">
              Ajusta las cantidades a despachar. Lo ya remitido se descuenta del
              pendiente.
            </p>
            <div class="flex items-center gap-1 shrink-0">
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium
                       text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition-colors"
                (click)="acceptAllPending()"
              >
                <app-icon name="check-check" [size]="14"></app-icon>
                Aceptar pendiente
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium
                       text-[var(--color-text-muted)] hover:bg-[var(--color-surface-elevated)] transition-colors"
                (click)="clearQuantities()"
              >
                <app-icon name="x" [size]="14"></app-icon>
                Limpiar
              </button>
            </div>
          </div>

          <div class="space-y-1.5 max-h-72 overflow-y-auto -mr-1 pr-1">
            @for (item of items(); track item.order_item_id) {
              <div
                class="flex items-center gap-3 p-2.5 rounded-lg border border-[var(--color-border)]
                       bg-[var(--color-surface)]"
              >
                <div
                  class="w-10 h-10 rounded-lg bg-[var(--color-surface-elevated)] flex items-center
                         justify-center shrink-0 overflow-hidden"
                >
                  @if (item.product_image_url) {
                    <img
                      [src]="item.product_image_url"
                      [alt]="item.product_name"
                      class="w-full h-full object-cover"
                    />
                  } @else {
                    <app-icon
                      name="package"
                      [size]="16"
                      color="var(--color-text-muted)"
                    ></app-icon>
                  }
                </div>

                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-[var(--color-text-primary)] truncate">
                    {{ item.product_name }}
                    @if (item.variant_name) {
                      <span class="text-xs text-[var(--color-text-muted)]">
                        · {{ item.variant_name }}
                      </span>
                    }
                  </p>
                  <div class="mt-1 flex flex-wrap items-center gap-1.5">
                    <span class="text-xs text-[var(--color-text-muted)]">
                      Pedido
                      <strong class="text-[var(--color-text-secondary)]">{{
                        item.ordered_quantity
                      }}</strong>
                    </span>
                    <span
                      class="inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium"
                      [class]="pendingBadgeClass(item.pending_quantity)"
                    >
                      Pendiente {{ item.pending_quantity }}
                    </span>
                    @if (item.requires_serial_numbers) {
                      <span
                        class="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium
                               text-[var(--color-primary)]"
                        style="background: color-mix(in srgb, var(--color-primary) 12%, transparent);"
                      >
                        <app-icon name="hash" [size]="11"></app-icon>
                        Seriales
                      </span>
                    }
                  </div>
                </div>

                <div class="flex flex-col items-end gap-1 shrink-0">
                  <app-input
                    type="number"
                    size="sm"
                    [min]="0"
                    [max]="item.pending_quantity"
                    [ngModel]="item.dispatched_quantity"
                    (ngModelChange)="onQtyChange(item.order_item_id!, $event)"
                    customClasses="w-20 text-center"
                  ></app-input>
                  <span class="text-xs font-semibold text-[var(--color-text-secondary)]">
                    {{ item.dispatched_quantity * item.unit_price | currency }}
                  </span>
                </div>
              </div>
            }
          </div>

          <div
            class="flex items-center justify-between rounded-lg px-3 py-2 text-sm"
            style="background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface));"
          >
            <span class="text-[var(--color-text-secondary)]">Total a despachar</span>
            <span class="font-bold text-[var(--color-primary)]">
              {{ wizardService.totals().grandTotal | currency }}
            </span>
          </div>
        }
      </app-wizard-step-section>

      <!-- ═══ BODEGA + ENTREGA ═══ -->
      <app-wizard-step-section
        icon="warehouse"
        title="Bodega de origen"
        subtitle="Desde qué bodega salen los ítems y cuándo se entregan"
        [dense]="true"
      >
        <form [formGroup]="detailsForm" class="space-y-3">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <app-selector
              label="Bodega de despacho"
              formControlName="dispatch_location_id"
              placeholder="Selecciona bodega..."
              [options]="locationOptions()"
              [required]="true"
            ></app-selector>

            <app-input
              type="date"
              label="Fecha acordada de entrega"
              formControlName="agreed_delivery_date"
            ></app-input>
          </div>

          @if (notesExpanded()) {
            <div class="space-y-2">
              <button
                type="button"
                class="inline-flex items-center gap-1.5 text-xs font-medium
                       text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors"
                (click)="notesExpanded.set(false)"
              >
                <app-icon name="sticky-note" [size]="14"></app-icon>
                Notas
                <app-icon name="chevron-up" [size]="14"></app-icon>
              </button>
              <app-textarea
                label="Notas"
                formControlName="notes"
                placeholder="Notas visibles en la remisión..."
                [rows]="2"
              ></app-textarea>
              <app-textarea
                label="Notas internas"
                formControlName="internal_notes"
                placeholder="Notas internas, solo visibles para el equipo..."
                [rows]="2"
              ></app-textarea>
            </div>
          } @else {
            <button
              type="button"
              class="inline-flex items-center gap-1.5 text-xs font-medium
                     text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors"
              (click)="notesExpanded.set(true)"
            >
              <app-icon name="sticky-note" [size]="14"></app-icon>
              Agregar notas
              <app-icon name="chevron-down" [size]="14"></app-icon>
            </button>
          }
        </form>
      </app-wizard-step-section>
    </div>
  `,
})
export class OrderItemsStepComponent {
  readonly wizardService = inject(DispatchNoteWizardService);
  private readonly dispatchNotesService = inject(DispatchNotesService);
  private readonly locationsService = inject(LocationsService);
  private readonly destroyRef = inject(DestroyRef);

  /** Mirrors `wizardService.items()` so the template can iterate without
   *  calling the signal inside `@for` (which would be fine, but the
   *  computed makes the dependency obvious to the change detector). */
  readonly items = computed(() => this.wizardService.items());

  /** Warehouse options for the "Bodega de despacho" selector. */
  readonly locationOptions = signal<SelectorOption[]>([]);

  /** Notas colapsables — arrancan abiertas si ya hay contenido. */
  readonly notesExpanded = signal<boolean>(
    !!(
      this.wizardService.details().notes ||
      this.wizardService.details().internal_notes
    ),
  );

  /** Bodega / fecha / notas — replicado de details-step (fusión). */
  readonly detailsForm = new FormGroup({
    agreed_delivery_date: new FormControl<string>('', { nonNullable: true }),
    dispatch_location_id: new FormControl<number | null>(null),
    notes: new FormControl<string>('', { nonNullable: true }),
    internal_notes: new FormControl<string>('', { nonNullable: true }),
  });

  constructor() {
    this.seedDetailsForm();
    this.loadLocations();
    this.syncFormToService();
    this.syncOrderDateToForm();

    // On mount, fetch existing remisiones for the selected order and
    // re-seed the wizard items with the proper `pending_quantity`.
    const order = this.wizardService.selectedOrder();
    if (!order) return;

    this.dispatchNotesService
      .getByOrder(order.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (notes) => {
          // Suma dispatched_quantity por sales_order_item_id (= order_items.id)
          // a través de todas las remisiones NO anuladas de la orden. El
          // backend (getByOrder + createFromOrder) ahora persiste y devuelve
          // sales_order_item_id, dando enlace exacto al renglón de la orden.
          // setSelectedOrder hace match contra oi.id, así que la clave coincide.
          const dispatched = new Map<number, number>();
          for (const note of notes ?? []) {
            for (const line of (note as any).dispatch_note_items ?? []) {
              if (!line?.dispatched_quantity) continue;
              const key = line.sales_order_item_id;
              if (typeof key === 'number') {
                dispatched.set(key, (dispatched.get(key) ?? 0) + Number(line.dispatched_quantity));
              }
            }
          }
          this.wizardService.setSelectedOrder(order, dispatched);
        },
        error: () => {
          // If the call fails, we keep the optimistic seed (pending = quantity).
        },
      });
  }

  // ==========================================================================
  // Items
  // ==========================================================================

  onQtyChange(orderItemId: number, value: number | string | null): void {
    const n = typeof value === 'string' ? parseInt(value, 10) : (value ?? 0);
    this.wizardService.updateItemQuantity(orderItemId, isNaN(n) ? 0 : n);
  }

  acceptAllPending(): void {
    this.wizardService.quickAcceptAll();
  }

  clearQuantities(): void {
    this.wizardService.clearQuantities();
  }

  pendingBadgeClass(pending: number): string {
    return pending > 0
      ? 'bg-[color-mix(in_srgb,var(--color-warning)_15%,transparent)] text-[var(--color-warning)]'
      : 'bg-[color-mix(in_srgb,var(--color-success)_15%,transparent)] text-[var(--color-success)]';
  }

  // ==========================================================================
  // Bodega / fecha / notas (fusionado desde details-step)
  // ==========================================================================

  private seedDetailsForm(): void {
    const d = this.wizardService.details();
    // Default HOY (fecha LOCAL) cuando la orden no trae fecha acordada.
    const agreedDeliveryDate = d.agreed_delivery_date ?? toLocalDateString();
    this.detailsForm.patchValue(
      {
        agreed_delivery_date: agreedDeliveryDate,
        dispatch_location_id: d.dispatch_location_id ?? null,
        notes: d.notes ?? '',
        internal_notes: d.internal_notes ?? '',
      },
      { emitEvent: false },
    );
    // Empuja el default al servicio para que review-step concuerde y para que el
    // effect syncOrderDateToForm no borre el valor sembrado (details() vacío → '').
    if (!d.agreed_delivery_date) {
      this.wizardService.setDetails({ agreed_delivery_date: agreedDeliveryDate });
    }
  }

  private loadLocations(): void {
    this.locationsService
      .getLocations({ is_active: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: ApiResponse<InventoryLocation[]>) => {
          const locations = response.data ?? [];
          this.locationOptions.set(
            locations.map((loc) => ({
              value: loc.id,
              label: loc.name,
              description: loc.code || undefined,
            })),
          );
        },
        error: () => this.locationOptions.set([]),
      });
  }

  private syncFormToService(): void {
    this.detailsForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((values) => {
        const locId = values.dispatch_location_id ?? undefined;
        const selected = this.locationOptions().find((o) => o.value === locId);
        this.wizardService.setDetails({
          agreed_delivery_date: values.agreed_delivery_date || undefined,
          dispatch_location_id: locId,
          dispatch_location_name: selected?.label || undefined,
          notes: values.notes || undefined,
          internal_notes: values.internal_notes || undefined,
        });
      });
  }

  /** El order load (async) puede rellenar `agreed_delivery_date` en `details()`
   *  después de que el form se inicializó; lo reflejamos sin re-emitir. */
  private syncOrderDateToForm(): void {
    effect(() => {
      const date = this.wizardService.details().agreed_delivery_date ?? '';
      const ctrl = this.detailsForm.controls.agreed_delivery_date;
      if (ctrl.value !== date) {
        ctrl.setValue(date, { emitEvent: false });
      }
    });
  }
}
