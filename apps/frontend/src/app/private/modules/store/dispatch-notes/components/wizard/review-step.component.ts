import {
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  IconComponent,
  ButtonComponent,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import {
  DispatchNoteWizardService,
  WizardTerminalAction,
} from '../../services/dispatch-note-wizard.service';
import type { DispatchNote } from '../../interfaces/dispatch-note.interface';

/**
 * Review step (ref 2026-06-25, plan wizard remisión order-first).
 *
 * Shows 4 read-only sections (Orden / Ítems / Detalles / Ruta) plus a
 * totals bar and a radio group for the terminal action
 * (draft / confirm_route / deliver). The wizard's "Siguiente" button is
 * hidden at step 4 — the footer "Crear" button mirrors the terminal
 * action label.
 */
@Component({
  selector: 'app-dispatch-wizard-review-step',
  standalone: true,
  imports: [IconComponent, ButtonComponent, CurrencyPipe, FormsModule],
  template: `
    <div class="space-y-2.5">
      @if (!created()) {
        <!-- Party Section (Orden for customer_delivery, Origen/Destino/Proveedor/Cliente for others) -->
        <section
          class="border-l-2 border-[var(--color-primary)] rounded-r-lg bg-[var(--color-surface)] p-3"
        >
          <div class="flex items-center justify-between mb-1.5">
            <h4 class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              {{ partyLabel() }}
            </h4>
            <button
              type="button"
              class="text-xs font-medium text-[var(--color-primary)] hover:underline px-2 py-1 rounded hover:bg-[var(--color-primary-light)]"
              (click)="goToStep.emit(0 + goToStepOffset())"
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
        </section>

        <!-- Items Section -->
        <section
          class="border-l-2 border-[var(--color-primary)] rounded-r-lg bg-[var(--color-surface)] p-3"
        >
          <div class="flex items-center justify-between mb-1.5">
            <h4 class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Ítems ({{ wizardService.items().length }})
            </h4>
            <button
              type="button"
              class="text-xs font-medium text-[var(--color-primary)] hover:underline px-2 py-1 rounded hover:bg-[var(--color-primary-light)]"
              (click)="goToStep.emit(1 + goToStepOffset())"
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
                             bg-amber-100 text-amber-800 text-[10px] font-medium"
                    >
                      <app-icon name="hash" [size]="9"></app-icon>
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
        </section>

        <!-- Details Section -->
        <section
          class="border-l-2 border-[var(--color-primary)] rounded-r-lg bg-[var(--color-surface)] p-3"
        >
          <div class="flex items-center justify-between mb-1.5">
            <h4 class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Detalles
            </h4>
            <button
              type="button"
              class="text-xs font-medium text-[var(--color-primary)] hover:underline px-2 py-1 rounded hover:bg-[var(--color-primary-light)]"
              (click)="goToStep.emit(2 + goToStepOffset())"
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
        </section>

        <!-- Route Section (customer_delivery only — other subtypes have no route) -->
        @if (wizardService.subtype() === 'customer_delivery') {
          <section
            class="border-l-2 border-[var(--color-primary)] rounded-r-lg bg-[var(--color-surface)] p-3"
          >
          <div class="flex items-center justify-between mb-1.5">
            <h4 class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Ruta
            </h4>
            <button
              type="button"
              class="text-xs font-medium text-[var(--color-primary)] hover:underline px-2 py-1 rounded hover:bg-[var(--color-primary-light)]"
              (click)="goToStep.emit(3 + goToStepOffset())"
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
          </section>
        }

        <!-- Totals Bar -->
        <section
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
        </section>

        <!-- Terminal action radio group -->
        <section class="rounded-lg border border-[var(--color-border)] p-3 space-y-1.5">
          <p class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Acción terminal
          </p>
          @for (opt of availableTerminalOptions(); track opt.value) {
            <label
              class="flex items-start gap-2 p-2 rounded-md cursor-pointer transition-colors"
              [class]="
                wizardService.terminalAction() === opt.value
                  ? 'bg-[var(--color-primary-light)]'
                  : 'hover:bg-[var(--color-surface-elevated)]'
              "
            >
              <input
                type="radio"
                name="terminal-action"
                [value]="opt.value"
                [ngModel]="wizardService.terminalAction()"
                (ngModelChange)="wizardService.setTerminalAction($event)"
                class="mt-0.5"
              />
              <div>
                <p class="text-sm font-medium text-[var(--color-text-primary)]">
                  {{ opt.label }}
                </p>
                <p class="text-[11px] text-[var(--color-text-muted)]">
                  {{ opt.description }}
                </p>
              </div>
            </label>
          }
        </section>
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
    </div>

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
  private readonly authFacade = inject(AuthFacade);

  // Inputs
  readonly created = input<boolean>(false);
  readonly createdNote = input<DispatchNote | null>(null);
  readonly completedAction = input<WizardTerminalAction>('draft');
  /**
   * Offset applied to `goToStep` emissions. The bidirectional wizard adds a
   * Tipo step at index 0, shifting all subsequent steps by 1. Defaults to 0
   * for backward compatibility with any consumer that still uses 0-based
   * step indices (e.g. the original 5-step wizard before the Type step).
   */
  readonly goToStepOffset = input<number>(0);

  // Outputs
  readonly goToStep = output<number>();
  readonly viewDetail = output<number>();
  readonly createAnother = output<void>();
  readonly printNote = output<DispatchNote>();

  readonly terminalOptions = computed<Array<{
    value: WizardTerminalAction;
    label: string;
    description: string;
  }>>(() => {
    const sub = this.wizardService.subtype();
    // Inbound subtypes: draft / confirm / receive
    if (sub === 'transfer_in' || sub === 'purchase_receipt' || sub === 'customer_return') {
      return [
        {
          value: 'draft',
          label: 'Crear como borrador',
          description: 'La remisión queda pendiente de confirmación.',
        },
        {
          value: 'confirm',
          label: 'Confirmar',
          description: 'Confirma la remisión para recepción posterior.',
        },
        {
          value: 'receive',
          label: 'Confirmar y recibir',
          description: 'Confirma y marca como recibida en una sola acción.',
        },
      ];
    }
    // customer_delivery (outbound): draft / confirm_route / deliver
    return [
      {
        value: 'draft',
        label: 'Crear como borrador',
        description: 'La remisión queda pendiente de confirmación.',
      },
      {
        value: 'confirm_route',
        label: 'Confirmar y asignar a ruta',
        description: 'Si hay seriales, se solicitan antes de confirmar.',
      },
      {
        value: 'deliver',
        label: 'Confirmar y entregar',
        description: 'Entrega inmediata tras verificar seriales.',
      },
    ];
  });

  /**
   * Terminal options filtradas por permiso (ref 2026-06-25).
   * 'draft' siempre disponible; 'confirm_route' requiere
   * store:dispatch_notes:confirm; 'deliver' requiere
   * store:dispatch_notes:deliver. Defensa-en-profundidad: el backend
   * también valida estos permisos en confirm()/deliver().
   */
  readonly availableTerminalOptions = computed(() => {
    const canConfirm = this.authFacade.hasPermission('store:dispatch_notes:confirm');
    const canDeliver = this.authFacade.hasPermission('store:dispatch_notes:deliver');
    return this.terminalOptions().filter((opt) => {
      if (opt.value === 'confirm_route') return canConfirm;
      if (opt.value === 'deliver') return canDeliver;
      if (opt.value === 'confirm') return canConfirm;
      if (opt.value === 'receive') return canDeliver;
      return true;
    });
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
