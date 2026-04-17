import {
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import {
  IconComponent,
  ButtonComponent,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { DispatchNoteWizardService, WizardCreateAction } from '../../services/dispatch-note-wizard.service';
import type { DispatchNote } from '../../interfaces/dispatch-note.interface';

@Component({
  selector: 'app-dispatch-wizard-review-step',
  standalone: true,
  imports: [
    IconComponent,
    ButtonComponent,
    CurrencyPipe,
  ],
  template: `
    <div class="space-y-2.5">
      @if (!created()) {
        <!-- Customer Section -->
        <section class="border-l-2 border-[var(--color-primary)] rounded-r-lg bg-[var(--color-surface)] p-3">
          <div class="flex items-center justify-between mb-1.5">
            <h4 class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Cliente</h4>
            <button
              type="button"
              class="text-xs font-medium text-[var(--color-primary)] hover:underline px-2 py-1 rounded transition-colors hover:bg-[var(--color-primary-light)]"
              (click)="goToStep.emit(0)"
              aria-label="Editar cliente"
            >
              Editar
            </button>
          </div>
          @if (wizardService.customer(); as customer) {
            <p class="text-sm text-[var(--color-text-primary)] truncate">
              <span class="font-medium">{{ customer.first_name }} {{ customer.last_name }}</span><!--
              -->@if (customer.phone) {
                <span class="text-[var(--color-text-muted)]"> · {{ customer.phone }}</span>
              }<!--
              -->@if (customer.document_number) {
                <span class="text-[var(--color-text-muted)]"> · {{ customer.document_number }}</span>
              }
            </p>
            @if (customer.email) {
              <p class="text-xs text-[var(--color-text-muted)] truncate mt-0.5">{{ customer.email }}</p>
            }
          }
        </section>

        <!-- Products Section -->
        <section class="border-l-2 border-[var(--color-primary)] rounded-r-lg bg-[var(--color-surface)] p-3">
          <div class="flex items-center justify-between mb-1.5">
            <h4 class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Productos ({{ wizardService.items().length }})
            </h4>
            <button
              type="button"
              class="text-xs font-medium text-[var(--color-primary)] hover:underline px-2 py-1 rounded transition-colors hover:bg-[var(--color-primary-light)]"
              (click)="goToStep.emit(1)"
              aria-label="Editar productos"
            >
              Editar
            </button>
          </div>

          <div class="rounded-md overflow-hidden border border-[var(--color-border)]">
            @for (item of wizardService.items(); track item.product_id + '-' + (item.product_variant_id || 0); let idx = $index) {
              <div
                class="flex items-center gap-2 px-2.5 py-1.5 text-sm"
                [class]="idx % 2 === 0 ? 'bg-[var(--color-surface)]' : 'bg-[var(--color-surface-elevated)]'"
              >
                <div class="flex-1 min-w-0 truncate">
                  <span class="font-medium text-[var(--color-text-primary)]">{{ item.product_name }}</span>
                  @if (item.variant_name) {
                    <span class="text-xs text-[var(--color-text-muted)]"> · {{ item.variant_name }}</span>
                  }
                </div>
                <span class="text-xs text-[var(--color-text-secondary)] whitespace-nowrap shrink-0">
                  {{ item.dispatched_quantity }} x {{ item.unit_price | currency }}
                </span>
                <span class="font-medium text-[var(--color-text-primary)] whitespace-nowrap shrink-0 min-w-[4.5rem] text-right">
                  {{ (item.unit_price * item.dispatched_quantity) | currency }}
                </span>
                @if (item.discount_amount > 0) {
                  <span class="text-xs text-[var(--color-error)] whitespace-nowrap shrink-0">
                    -{{ (item.discount_amount * item.dispatched_quantity) | currency }}
                  </span>
                }
              </div>
            }
          </div>
        </section>

        <!-- Details Section -->
        <section class="border-l-2 border-[var(--color-primary)] rounded-r-lg bg-[var(--color-surface)] p-3">
          <div class="flex items-center justify-between mb-1.5">
            <h4 class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Detalles</h4>
            <button
              type="button"
              class="text-xs font-medium text-[var(--color-primary)] hover:underline px-2 py-1 rounded transition-colors hover:bg-[var(--color-primary-light)]"
              (click)="goToStep.emit(2)"
              aria-label="Editar detalles"
            >
              Editar
            </button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <div class="flex items-center gap-1.5">
              <app-icon name="calendar" [size]="13" color="var(--color-text-muted)"></app-icon>
              <span class="text-[var(--color-text-muted)]">Emision:</span>
              <span class="text-[var(--color-text-primary)] font-medium">{{ wizardService.details().emission_date }}</span>
            </div>

            @if (wizardService.details().agreed_delivery_date) {
              <div class="flex items-center gap-1.5">
                <app-icon name="calendar" [size]="13" color="var(--color-text-muted)"></app-icon>
                <span class="text-[var(--color-text-muted)]">Entrega:</span>
                <span class="text-[var(--color-text-primary)] font-medium">{{ wizardService.details().agreed_delivery_date }}</span>
              </div>
            }

            @if (wizardService.details().dispatch_location_name) {
              <div class="flex items-center gap-1.5 sm:col-span-2">
                <app-icon name="map-pin" [size]="13" color="var(--color-text-muted)"></app-icon>
                <span class="text-[var(--color-text-muted)]">Ubicacion:</span>
                <span class="text-[var(--color-text-primary)] font-medium truncate">{{ wizardService.details().dispatch_location_name }}</span>
              </div>
            }
          </div>

          @if (wizardService.details().notes) {
            <div class="mt-2 pt-2 border-t border-[var(--color-border)]">
              <p class="text-xs text-[var(--color-text-muted)] font-medium mb-0.5">Notas</p>
              <p class="text-sm text-[var(--color-text-secondary)] whitespace-pre-line line-clamp-3">{{ wizardService.details().notes }}</p>
            </div>
          }

          @if (wizardService.details().internal_notes) {
            <div class="mt-1.5 pt-1.5 border-t border-dashed border-[var(--color-border)]">
              <p class="text-xs text-[var(--color-text-muted)] font-medium mb-0.5">Notas internas</p>
              <p class="text-sm text-[var(--color-text-secondary)] whitespace-pre-line italic line-clamp-2">{{ wizardService.details().internal_notes }}</p>
            </div>
          }
        </section>

        <!-- Totals Bar -->
        <section class="rounded-lg overflow-hidden border border-[var(--color-primary)] bg-[var(--color-primary-light)]">
          <div class="px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-[var(--color-text-secondary)] border-b border-[var(--color-border)]">
            <span>Subtotal: <span class="font-medium text-[var(--color-text-primary)]">{{ wizardService.totals().subtotal | currency }}</span></span>
            @if (wizardService.totals().discount > 0) {
              <span>Desc: <span class="font-medium text-[var(--color-error)]">-{{ wizardService.totals().discount | currency }}</span></span>
            }
            @if (wizardService.totals().tax > 0) {
              <span>Imp: <span class="font-medium text-[var(--color-text-primary)]">{{ wizardService.totals().tax | currency }}</span></span>
            }
          </div>
          <div class="px-3 py-2.5 flex items-center justify-between">
            <span class="text-sm font-semibold text-[var(--color-text-primary)]">Total</span>
            <span class="text-xl font-bold text-[var(--color-primary)]">{{ wizardService.totals().grandTotal | currency }}</span>
          </div>
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
            <app-button variant="outline" size="sm" (clicked)="viewDetail.emit(createdNote()!.id)">
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

  // Inputs
  readonly created = input<boolean>(false);
  readonly createdNote = input<DispatchNote | null>(null);
  readonly completedAction = input<WizardCreateAction>('draft');

  // Outputs
  readonly goToStep = output<number>();
  readonly viewDetail = output<number>();
  readonly createAnother = output<void>();
  readonly printNote = output<DispatchNote>();

  get successTitle(): string {
    switch (this.completedAction()) {
      case 'confirm': return 'Remision creada y confirmada';
      case 'invoice': return 'Remision facturada';
      default: return 'Remision creada';
    }
  }
}
