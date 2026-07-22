import {
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';

import {
  IconComponent,
  ButtonComponent,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { WizardStepSectionComponent } from './wizard-step-section.component';
import {
  DispatchNoteWizardService,
  WizardTerminalAction,
} from '../../services/dispatch-note-wizard.service';
import type { DispatchNote } from '../../interfaces/dispatch-note.interface';

/**
 * Review step (ref plan wizard remisión bidireccional — Ola 2, paso 4).
 *
 * Resumen READ-ONLY del wizard dentro del shell `app-wizard-step-section`:
 * secciones Party / Ítems y bodega / Detalles / Ruta, más una barra de
 * totales y enlaces "Editar" que saltan al paso correspondiente.
 *
 * Ya NO hay control de "Acción terminal": el estado destino de la remisión
 * se DERIVA de si se asignó ruta (paso Ruta) — ver
 * `DispatchNoteWizardService.deriveTargetStatus()`. El botón "Crear" vive en
 * el footer del orquestador.
 */
@Component({
  selector: 'app-dispatch-wizard-review-step',
  standalone: true,
  imports: [
    IconComponent,
    ButtonComponent,
    CurrencyPipe,
    WizardStepSectionComponent,
  ],
  template: `
    @if (!created()) {
      <app-wizard-step-section
        icon="clipboard-check"
        title="Revisión"
        subtitle="Revisa el resumen antes de crear la remisión"
        [dense]="true"
      >
        <!-- Party (Orden para customer_delivery; Origen/Destino/Proveedor/Cliente para el resto) -->
        <div class="rounded-lg bg-[var(--color-surface-elevated)] p-3">
          <div class="flex items-center justify-between mb-2">
            <h4
              class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]"
            >
              {{ partyLabel() }}
            </h4>
            <button
              type="button"
              class="text-xs font-medium text-[var(--color-primary)] hover:underline px-2 py-1 rounded-md hover:bg-[var(--color-primary-light)] transition-colors"
              (click)="goToStep.emit(partyStepIndex())"
            >
              Editar
            </button>
          </div>
          <div class="text-sm text-[var(--color-text-primary)]">
            @switch (wizardService.subtype()) {
              @case ('customer_delivery') {
                @if (wizardService.selectedOrder(); as order) {
                  <p class="truncate">
                    <span class="font-medium">#{{ order.order_number }}</span>
                    @if (wizardService.customer(); as c) {
                      <span class="text-[var(--color-text-muted)]">
                        · {{ c.first_name }} {{ c.last_name }}
                      </span>
                    }
                  </p>
                  <p class="text-xs text-[var(--color-text-muted)] mt-0.5">
                    {{ order.grand_total | currency }} · {{ order.state }}
                  </p>
                }
              }
              @case ('transfer_out') {
                <p>Origen: <span class="font-medium">{{ locationLabel(wizardService.fromLocationId()) }}</span></p>
                <p>Destino: <span class="font-medium">{{ locationLabel(wizardService.toLocationId()) }}</span></p>
              }
              @case ('transfer_in') {
                <p>Origen: <span class="font-medium">{{ locationLabel(wizardService.fromLocationId()) }}</span></p>
                <p>Destino: <span class="font-medium">{{ locationLabel(wizardService.toLocationId()) }}</span></p>
              }
              @case ('purchase_receipt') {
                <p>Proveedor: <span class="font-medium">{{ wizardService.supplierName() || '—' }}</span></p>
                @if (wizardService.purchaseOrderId(); as poId) {
                  <p class="text-xs text-[var(--color-text-muted)]">OC #{{ poId }}</p>
                }
              }
              @case ('customer_return') {
                <p>Cliente: <span class="font-medium">{{ wizardService.customerName() || '—' }}</span></p>
                @if (wizardService.relatedDispatchId(); as rdId) {
                  <p class="text-xs text-[var(--color-text-muted)]">Remisión original #{{ rdId }}</p>
                }
              }
            }
          </div>
        </div>

        <!-- Ítems y bodega -->
        <div class="rounded-lg bg-[var(--color-surface-elevated)] p-3">
          <div class="flex items-center justify-between mb-2">
            <h4
              class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]"
            >
              Ítems ({{ wizardService.items().length }})
            </h4>
            <button
              type="button"
              class="text-xs font-medium text-[var(--color-primary)] hover:underline px-2 py-1 rounded-md hover:bg-[var(--color-primary-light)] transition-colors"
              (click)="goToStep.emit(itemsStepIndex())"
            >
              Editar
            </button>
          </div>

          <div class="rounded-md overflow-hidden border border-[var(--color-border)]">
            @for (item of wizardService.items(); track $index; let idx = $index) {
              <div
                class="flex items-center gap-2 px-2.5 py-1.5 text-sm"
                [class]="idx % 2 === 0 ? 'bg-[var(--color-surface)]' : 'bg-[var(--color-surface-elevated)]'"
              >
                <div class="flex-1 min-w-0 truncate">
                  <span class="font-medium text-[var(--color-text-primary)]">
                    {{ item.product_name }}
                  </span>
                  @if (item.requires_serial_numbers) {
                    <span
                      class="ml-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full
                             bg-[var(--color-warning-light)] text-[var(--color-warning)] text-xs font-medium"
                    >
                      <app-icon name="hash" [size]="12"></app-icon>
                      S/N
                    </span>
                  }
                </div>
                <span class="text-xs text-[var(--color-text-secondary)] whitespace-nowrap shrink-0">
                  {{ item.dispatched_quantity }} x {{ item.unit_price | currency }}
                </span>
                <span class="font-medium text-[var(--color-text-primary)] whitespace-nowrap shrink-0 min-w-[4.5rem] text-right">
                  {{ (item.unit_price * item.dispatched_quantity) | currency }}
                </span>
              </div>
            }
          </div>
        </div>

        <!-- Detalles (read-only; su "Editar" salta al paso Ítems y bodega tras la fusión) -->
        <div class="rounded-lg bg-[var(--color-surface-elevated)] p-3">
          <div class="flex items-center justify-between mb-2">
            <h4
              class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]"
            >
              Detalles
            </h4>
            <button
              type="button"
              class="text-xs font-medium text-[var(--color-primary)] hover:underline px-2 py-1 rounded-md hover:bg-[var(--color-primary-light)] transition-colors"
              (click)="goToStep.emit(itemsStepIndex())"
            >
              Editar
            </button>
          </div>
          <div class="text-sm text-[var(--color-text-primary)]">
            <p>
              <span class="text-[var(--color-text-muted)]">Bodega:</span>
              {{ wizardService.details().dispatch_location_name || '—' }}
            </p>
            @if (wizardService.details().agreed_delivery_date) {
              <p class="text-xs text-[var(--color-text-secondary)] mt-0.5">
                Entrega acordada: {{ wizardService.details().agreed_delivery_date }}
              </p>
            }
            @if (wizardService.details().notes) {
              <p class="text-xs text-[var(--color-text-muted)] mt-1 italic line-clamp-2">
                {{ wizardService.details().notes }}
              </p>
            }
          </div>
        </div>

        <!-- Ruta (solo customer_delivery — los demás subtipos no tienen ruta) -->
        @if (wizardService.subtype() === 'customer_delivery') {
          <div class="rounded-lg bg-[var(--color-surface-elevated)] p-3">
            <div class="flex items-center justify-between mb-2">
              <h4
                class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]"
              >
                Ruta
              </h4>
              <button
                type="button"
                class="text-xs font-medium text-[var(--color-primary)] hover:underline px-2 py-1 rounded-md hover:bg-[var(--color-primary-light)] transition-colors"
                (click)="goToStep.emit(routeStepIndex())"
              >
                Editar
              </button>
            </div>
            <p class="text-sm text-[var(--color-text-primary)]">
              @switch (wizardService.routeMode()) {
                @case ('none') { Sin ruta (entrega directa) }
                @case ('existing') {
                  #{{ wizardService.selectedRouteId() }}
                }
                @case ('new') {
                  @if (wizardService.newRouteDraft(); as draft) {
                    Nueva planilla · {{ draft.planned_date }} · #{{ draft.driver_user_id }}
                  } @else {
                    Nueva planilla (borrador)
                  }
                }
              }
            </p>
          </div>
        }

        <!-- Barra de totales -->
        <div
          class="rounded-lg overflow-hidden border border-[var(--color-primary)] bg-[var(--color-primary-light)]"
        >
          <div
            class="px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-[var(--color-text-secondary)] border-b border-[var(--color-border)]"
          >
            <span
              >Subtotal:
              <span class="font-medium text-[var(--color-text-primary)]">
                {{ wizardService.totals().subtotal | currency }}
              </span></span
            >
            @if (wizardService.totals().discount > 0) {
              <span
                >Desc:
                <span class="font-medium text-[var(--color-error)]">
                  -{{ wizardService.totals().discount | currency }}
                </span></span
              >
            }
            @if (wizardService.totals().tax > 0) {
              <span
                >Imp:
                <span class="font-medium text-[var(--color-text-primary)]">
                  {{ wizardService.totals().tax | currency }}
                </span></span
              >
            }
          </div>
          <div class="px-3 py-2.5 flex items-center justify-between">
            <span class="text-sm font-semibold text-[var(--color-text-primary)]">Total</span>
            <span class="text-xl font-bold text-[var(--color-primary)]">
              {{ wizardService.totals().grandTotal | currency }}
            </span>
          </div>
        </div>
      </app-wizard-step-section>
    } @else {
      <!-- Success State -->
      <div class="text-center py-6 space-y-3">
        <div
          class="w-20 h-20 mx-auto rounded-full flex items-center justify-center"
          style="background: radial-gradient(circle, var(--color-success-light) 0%, transparent 70%); animation: successPulse 1.5s ease-out"
        >
          <div
            class="w-14 h-14 rounded-full bg-[var(--color-success)] flex items-center justify-center shadow-lg"
            style="animation: successScale 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both"
          >
            <app-icon name="check" [size]="28" color="#fff"></app-icon>
          </div>
        </div>

        <div>
          <h3 class="text-lg font-bold text-[var(--color-text-primary)]">
            {{ successTitle }}
          </h3>
          @if (createdNote()) {
            <p class="text-2xl font-bold text-[var(--color-primary)] mt-1">
              #{{ createdNote()!.dispatch_number }}
            </p>
          }
        </div>

        <div class="flex flex-row gap-2 justify-center pt-2">
          <app-button
            variant="outline"
            size="sm"
            (clicked)="viewDetail.emit(createdNote()!.id)"
          >
            Ver detalle
          </app-button>
          <app-button variant="outline" size="sm" (clicked)="createAnother.emit()">
            Crear otra
          </app-button>
          <app-button variant="primary" size="sm" (clicked)="printNote.emit(createdNote()!)">
            <app-icon name="printer" [size]="14" slot="icon"></app-icon>
            Imprimir
          </app-button>
        </div>
      </div>
    }

    <style>
      @keyframes successScale {
        from { transform: scale(0); opacity: 0; }
        to { transform: scale(1); opacity: 1; }
      }
      @keyframes successPulse {
        0% { transform: scale(0.8); opacity: 0; }
        50% { transform: scale(1.1); opacity: 1; }
        100% { transform: scale(1); opacity: 1; }
      }
      @media (prefers-reduced-motion: reduce) {
        * { animation-duration: 0.01ms !important; }
      }
    </style>
  `,
})
export class ReviewStepComponent {
  readonly wizardService = inject(DispatchNoteWizardService);

  // Inputs
  readonly created = input<boolean>(false);
  readonly createdNote = input<DispatchNote | null>(null);
  readonly completedAction = input<WizardTerminalAction>('draft');
  /**
   * @deprecated Retenido sólo por compatibilidad con el binding del orquestador
   * (`[goToStepOffset]="1"`). Ya NO se usa para calcular los saltos "Editar":
   * los índices se derivan de `stepLabels()` del servicio (ver
   * `partyStepIndex` / `itemsStepIndex` / `routeStepIndex`). El orquestador
   * retirará este binding en un paso posterior.
   */
  readonly goToStepOffset = input<number>(0);

  // Outputs
  readonly goToStep = output<number>();
  readonly viewDetail = output<number>();
  readonly createAnother = output<void>();
  readonly printNote = output<DispatchNote>();

  // ── Saltos "Editar": índices ABSOLUTOS derivados de `stepLabels()` ──────────
  // Se recalculan solos si el mapa de pasos cambia; evitan offsets frágiles.
  //   customer_delivery (5): [Tipo=0, Orden=1, Ítems y bodega=2, Ruta=3, Revisión=4]
  //   inbound/transfer  (4): [Tipo=0, Party=1, Ítems y bodega=2, Revisión=3]

  /** Paso Party (Orden / Origen-Destino / Proveedor / Cliente): el que sigue a "Tipo". */
  readonly partyStepIndex = computed<number>(() => {
    const idx = this.wizardService.stepLabels().indexOf('Tipo');
    return idx >= 0 ? idx + 1 : 1;
  });

  /** Paso "Ítems y bodega" (fusión de ítems + detalles). */
  readonly itemsStepIndex = computed<number>(() => {
    const idx = this.wizardService.stepLabels().indexOf('Ítems y bodega');
    return idx >= 0 ? idx : 2;
  });

  /** Paso "Ruta" (sólo customer_delivery). */
  readonly routeStepIndex = computed<number>(() => {
    const idx = this.wizardService.stepLabels().indexOf('Ruta');
    return idx >= 0 ? idx : 3;
  });

  get successTitle(): string {
    switch (this.completedAction()) {
      case 'confirm_route':
        return 'Remisión confirmada y asignada';
      case 'deliver':
        return 'Remisión entregada';
      case 'confirm':
        return 'Remisión confirmada';
      case 'receive':
        return 'Remisión recibida';
      default:
        return 'Remisión creada';
    }
  }

  /** Label for the party section header, by subtype. */
  partyLabel(): string {
    switch (this.wizardService.subtype()) {
      case 'customer_delivery':
        return 'Orden';
      case 'transfer_out':
      case 'transfer_in':
        return 'Origen / Destino';
      case 'purchase_receipt':
        return 'Proveedor';
      case 'customer_return':
        return 'Cliente y Remisión';
      default:
        return 'Orden';
    }
  }

  /** Resolve a location id to its name from the wizard's loaded locations. */
  locationLabel(id: number | null | undefined): string {
    if (!id) return '—';
    // The party step loads locations internally; the review step does not
    // have direct access. We show the id as fallback. A future improvement
    // would share the locations list via the wizard service.
    return `Bodega #${id}`;
  }
}
