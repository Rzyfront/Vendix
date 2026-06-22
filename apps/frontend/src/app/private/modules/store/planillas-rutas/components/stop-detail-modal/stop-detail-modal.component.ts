import { Component, computed, input, output } from '@angular/core';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { DispatchRouteStop } from '../../interfaces/planilla.interface';
import { DispatchNote } from '../../../dispatch-notes/interfaces/dispatch-note.interface';

/**
 * Quick-view modal for a route stop / dispatch note. Surfaces the
 * delivery-relevant information of a remisión (¿dónde es?, cliente, total,
 * fecha de entrega) without leaving the planilla detail page.
 *
 * Presentational only: the parent fetches the full `DispatchNote` (which
 * carries the address — the stop's nested summary does not) and passes it in.
 * While the fetch is in flight the modal renders the summary already present
 * on the stop plus a loading hint.
 *
 * Zoneless-clean: signal inputs + signal outputs, no legacy CD APIs.
 */
@Component({
  selector: 'app-stop-detail-modal',
  standalone: true,
  imports: [CurrencyPipe, ModalComponent, IconComponent],
  template: `
    <app-modal
      [isOpen]="true"
      title="Detalle de la remisión"
      [subtitle]="stop().dispatch_note?.dispatch_number || ''"
      size="md"
      (cancel)="close.emit()"
      (closed)="close.emit()"
    >
      <div class="space-y-4">
        <!-- Cliente + remisión -->
        <div class="flex items-start gap-3">
          <span
            class="flex h-10 w-10 items-center justify-center rounded-[0.625rem] flex-shrink-0"
            style="color: var(--color-primary); background: rgba(var(--color-primary-rgb, 126, 215, 165), 0.1); border: 1px solid rgba(var(--color-primary-rgb, 126, 215, 165), 0.18);"
          >
            <app-icon name="user" [size]="20"></app-icon>
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-bold text-text-primary truncate">
              {{ customerName() }}
            </p>
            @if (taxId()) {
              <p class="text-xs text-text-secondary">NIT/CC: {{ taxId() }}</p>
            }
            <div class="mt-1 flex items-center gap-2">
              <span
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
                [style.color]="statusColor().fg"
                [style.background]="statusColor().bg"
              >
                {{ statusLabel() }}
              </span>
              <span class="text-[11px] text-text-secondary">
                Parada #{{ stop().stop_sequence }}
              </span>
            </div>
          </div>
        </div>

        <!-- Dónde es (dirección de entrega) -->
        <div class="rounded-xl border border-border bg-surface p-3">
          <div class="flex items-center gap-1.5 mb-1.5">
            <app-icon name="map-pin" [size]="14" class="text-primary-600"></app-icon>
            <span class="text-[11px] font-bold uppercase tracking-wide text-text-secondary">
              Dónde es
            </span>
          </div>
          @if (loading() && !note()) {
            <p class="text-xs text-text-secondary italic">Cargando dirección…</p>
          } @else if (addressText()) {
            <p class="text-sm text-text-primary whitespace-pre-wrap">{{ addressText() }}</p>
          } @else {
            <p class="text-xs text-text-secondary italic">Sin dirección registrada en la remisión.</p>
          }
        </div>

        <!-- Datos de entrega -->
        <div class="grid grid-cols-2 gap-3">
          <div class="rounded-xl border border-border bg-surface p-3">
            <span class="text-[11px] font-bold uppercase tracking-wide text-text-secondary block mb-0.5">
              Total
            </span>
            <span class="text-base font-bold text-text-primary font-mono">
              {{ total() | currency }}
            </span>
          </div>
          <div class="rounded-xl border border-border bg-surface p-3">
            <span class="text-[11px] font-bold uppercase tracking-wide text-text-secondary block mb-0.5">
              Entrega acordada
            </span>
            <span class="text-sm text-text-primary">{{ deliveryDate() }}</span>
          </div>
        </div>

        <!-- Items + orden vinculada -->
        <div class="flex items-center justify-between text-sm">
          <span class="flex items-center gap-1.5 text-text-secondary">
            <app-icon name="package" [size]="14"></app-icon>
            {{ itemCount() }} {{ itemCount() === 1 ? 'ítem' : 'ítems' }}
          </span>
          @if (orderNumber()) {
            <span class="text-text-secondary">
              Orden <strong class="text-text-primary">{{ orderNumber() }}</strong>
            </span>
          }
        </div>
      </div>

      <div slot="footer" class="flex items-center justify-end gap-2">
        <button
          type="button"
          (click)="close.emit()"
          class="rounded-md border border-border bg-surface px-4 py-2 text-sm"
        >
          Cerrar
        </button>
        @if (stop().dispatch_note_id) {
          <button
            type="button"
            (click)="goToNote.emit(stop().dispatch_note_id)"
            class="inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
          >
            Ver remisión completa
            <app-icon name="external-link" [size]="14"></app-icon>
          </button>
        }
      </div>
    </app-modal>
  `,
})
export class StopDetailModalComponent {
  /** The route stop (carries the dispatch-note summary). */
  readonly stop = input.required<DispatchRouteStop>();
  /** The fully-loaded dispatch note (null while the parent fetch is pending). */
  readonly note = input<DispatchNote | null>(null);
  /** True while the parent is fetching the full dispatch note. */
  readonly loading = input<boolean>(false);

  /** Dismiss the modal. */
  readonly close = output<void>();
  /** Navigate to the full dispatch-note page (emits the dispatch note id). */
  readonly goToNote = output<number>();

  readonly customerName = computed<string>(
    () => this.note()?.customer_name || this.stop().dispatch_note?.customer_name || '(Cliente)',
  );

  readonly taxId = computed<string>(() => this.note()?.customer_tax_id || '');

  readonly total = computed<number>(() =>
    Number(this.note()?.grand_total ?? this.stop().dispatch_note?.grand_total ?? 0),
  );

  readonly deliveryDate = computed<string>(() => {
    const raw = this.note()?.agreed_delivery_date;
    if (!raw) return '—';
    return new Date(raw).toLocaleDateString();
  });

  readonly itemCount = computed<number>(() => this.note()?.dispatch_note_items?.length ?? 0);

  readonly orderNumber = computed<string>(() => {
    const so = this.note()?.sales_order as { order_number?: string } | undefined;
    return so?.order_number || '';
  });

  /** Formats the dispatch-note customer address whether it is a string or object. */
  readonly addressText = computed<string>(() => {
    const a = this.note()?.customer_address as
      | string
      | {
          address_line1?: string;
          address_line2?: string;
          city?: string;
          state_province?: string;
          postal_code?: string;
          country_code?: string;
        }
      | null
      | undefined;
    if (!a) return '';
    if (typeof a === 'string') return a;
    const parts = [
      a.address_line1,
      a.address_line2,
      a.city,
      a.state_province,
      a.postal_code,
      a.country_code,
    ].filter(Boolean);
    return parts.join(', ');
  });

  readonly statusLabel = computed<string>(() => {
    const map: Record<string, string> = {
      draft: 'Borrador',
      confirmed: 'Confirmada',
      delivered: 'Entregada',
      invoiced: 'Facturada',
      voided: 'Anulada',
    };
    const s = this.note()?.status || this.stop().dispatch_note?.status || '';
    return map[s] || s || '—';
  });

  /** WCAG-AA legible inline colors keyed off the dispatch-note status. */
  readonly statusColor = computed<{ fg: string; bg: string }>(() => {
    const s = this.note()?.status || this.stop().dispatch_note?.status || '';
    const map: Record<string, { fg: string; bg: string }> = {
      draft: { fg: '#475569', bg: '#f1f5f9' },
      confirmed: { fg: '#1d4ed8', bg: '#dbeafe' },
      delivered: { fg: '#047857', bg: '#d1fae5' },
      invoiced: { fg: '#7e22ce', bg: '#f3e8ff' },
      voided: { fg: '#b91c1c', bg: '#fee2e2' },
    };
    return map[s] || { fg: '#475569', bg: '#f1f5f9' };
  });
}
