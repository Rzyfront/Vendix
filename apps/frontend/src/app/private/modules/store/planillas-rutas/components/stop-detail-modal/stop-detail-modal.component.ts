import { Component, computed, inject, input, output } from '@angular/core';
import { Observable } from 'rxjs';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  ResponsiveDataViewComponent,
  TableColumn,
  ItemListCardConfig,
} from '../../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import {
  DispatchNoteAddressEditorComponent,
  AddressPayload,
} from '../../../../../../shared/components/index';
import { DispatchNoteAddressPayload } from '../../../../../../shared/components/dispatch-note-address-editor/dispatch-note-address-editor.service';
import {
  DispatchDeliveryAddress,
  DispatchRouteStop,
} from '../../interfaces/planilla.interface';
import { DispatchNote } from '../../../dispatch-notes/interfaces/dispatch-note.interface';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';

/** Address blob may arrive as a JSON object or a pre-formatted string. */
type AddressLike = DispatchDeliveryAddress | string;

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
  imports: [
    CurrencyPipe,
    ModalComponent,
    IconComponent,
    ResponsiveDataViewComponent,
    DispatchNoteAddressEditorComponent,
  ],
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

        @if (canEditAddress() && (noteId() != null || addressSaveFn() != null)) {
          <app-dispatch-note-address-editor
            [noteId]="noteId() ?? undefined"
            [address]="stopAddress()"
            [saveFn]="addressSaveFn()"
            (saved)="onAddressSaved()"
          ></app-dispatch-note-address-editor>
        }

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

        <!-- Ítems de la remisión -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <span
              class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-text-secondary"
            >
              <app-icon name="package" [size]="14"></app-icon>
              Ítems ({{ itemCount() }})
            </span>
            @if (orderNumber()) {
              <span class="text-xs text-text-secondary">
                Orden <strong class="text-text-primary">{{ orderNumber() }}</strong>
              </span>
            }
          </div>
          @if (loading() && !note()) {
            <p class="text-xs text-text-secondary italic">Cargando ítems…</p>
          } @else {
            <app-responsive-data-view
              [data]="items()"
              [columns]="columns"
              [cardConfig]="cardConfig"
              tableSize="sm"
              itemListSize="sm"
              [compact]="true"
              emptyIcon="package"
              emptyMessage="Sin ítems en la remisión."
            ></app-responsive-data-view>
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

  /**
   * Optional carrier-mode address saver (Vendix Repartos). When provided, the
   * inline address editor is shown WITHOUT the admin `store:dispatch_notes:update`
   * permission and persists via this fn (carrier endpoint
   * `PATCH /store/carrier/route/stops/:stopId/address`) instead of the admin
   * `DispatchNoteAddressService`. Left null in admin usages → original behavior.
   */
  readonly addressSaveFn = input<
    ((payload: DispatchNoteAddressPayload) => Observable<unknown>) | null
  >(null);

  /** Dismiss the modal. */
  readonly close = output<void>();
  /** Navigate to the full dispatch-note page (emits the dispatch note id). */
  readonly goToNote = output<number>();
  /** Emit after the address editor persisted a new snapshot — parent refetches. */
  readonly refresh = output<void>();

  private readonly authFacade = inject(AuthFacade);

  /** The dispatch-note id backing this stop — drives the address editor. */
  readonly noteId = computed<number | null>(
    () => this.stop()?.dispatch_note_id ?? null,
  );

  /**
   * Permission gate for the inline address editor. In admin mode mirrors the
   * backend `@Permissions('store:dispatch_notes:update')` on `PATCH /:id/address`;
   * in carrier mode the presence of `addressSaveFn` is the gate (the carrier has
   * its own `store:carrier:stop:update_address` permission, not the admin one).
   */
  readonly canEditAddress = computed(
    () =>
      this.addressSaveFn() != null ||
      this.authFacade.hasPermission('store:dispatch_notes:update'),
  );

  /**
   * Raw delivery-address snapshot to seed the editor. Prefers the stop's own
   * `dispatch_note.customer_address`, falls back to the order's
   * `shipping_address_snapshot`, then the fully-loaded note's
   * `customer_address`. String snapshots (legacy) are treated as "no address"
   * so the editor opens with an empty form the user can fill in. Mapped to
   * `AddressPayload` vocabulary (1:1 on shared keys).
   */
  readonly stopAddress = computed<AddressPayload | null>(() => {
    const a = this.resolvedAddress();
    if (!a || typeof a === 'string') return null;
    return {
      address_line1: a.address_line1 ?? a.line1 ?? a.address ?? null,
      address_line2: a.address_line2 ?? null,
      city: a.city ?? null,
      state_province: a.state_province ?? null,
      country_code: a.country_code ?? null,
      postal_code: a.postal_code ?? null,
      phone_number: null,
      latitude: a.latitude ?? null,
      longitude: a.longitude ?? null,
    };
  });

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
    // date-only field → format en UTC para evitar el corrimiento de un día.
    return formatDateOnlyUTC(raw);
  });

  readonly itemCount = computed<number>(() => this.note()?.dispatch_note_items?.length ?? 0);

  readonly orderNumber = computed<string>(() => {
    const so = this.note()?.sales_order as { order_number?: string } | undefined;
    return so?.order_number || '';
  });

  // ── Ítems de la remisión para ResponsiveDataView ──────
  /** Dispatch-note lines with a 1-based `_index` for the "#" column. */
  readonly items = computed(() =>
    (this.note()?.dispatch_note_items ?? []).map((item, i) => ({ ...item, _index: i + 1 })),
  );

  readonly columns: TableColumn[] = [
    { key: '_index', label: '#', width: '44px', align: 'center' },
    {
      key: 'product.name',
      label: 'Producto',
      transform: (_v: any, item: any) =>
        item?.product?.name || item?.product?.product_name || `Producto #${item?.product_id}`,
    },
    { key: 'ordered_quantity', label: 'Pedida', align: 'center', width: '80px' },
    { key: 'dispatched_quantity', label: 'Despachada', align: 'center', width: '95px' },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'product.name',
    titleTransform: (item: any) =>
      item?.product?.name || item?.product?.product_name || `Producto #${item?.product_id}`,
    subtitleKey: 'product_variant.sku',
    subtitleTransform: (item: any) => {
      const parts: string[] = [];
      if (item?.product_variant?.sku) parts.push(`SKU: ${item.product_variant.sku}`);
      if (item?.lot_serial) parts.push(`Lote: ${item.lot_serial}`);
      return parts.join(' · ');
    },
    avatarFallbackIcon: 'package',
    avatarShape: 'square',
    detailKeys: [
      { key: 'ordered_quantity', label: 'Pedida' },
      { key: 'dispatched_quantity', label: 'Despachada' },
    ],
  };

  /**
   * Formats the delivery address whether it is a string or object. Prefers the
   * stop's own snapshot (present immediately from the route include:
   * `dispatch_note.customer_address`, then the order's
   * `shipping_address_snapshot` fallback) and only falls back to the fully
   * fetched note's `customer_address` while the stop carries none — so the
   * address shows up without waiting for the note fetch.
   */
  readonly addressText = computed<string>(() => {
    const a = this.resolvedAddress();
    if (!a) return '';
    if (typeof a === 'string') return a;
    const parts = [
      a.address_line1 ?? a.line1 ?? a.address,
      a.address_line2,
      a.city,
      a.state_province,
      a.postal_code,
      a.country_code,
    ].filter(Boolean);
    return parts.join(', ');
  });

  /** Picks the first usable address blob: stop snapshot → order snapshot → note. */
  private resolvedAddress(): AddressLike | null | undefined {
    const summary = this.stop().dispatch_note;
    return (
      (summary?.customer_address as AddressLike | null | undefined) ??
      (summary?.order?.shipping_address_snapshot as AddressLike | null | undefined) ??
      (this.note()?.customer_address as AddressLike | null | undefined)
    );
  }

  /**
   * After the inline editor persisted a new `customer_address` snapshot, bubble
   * a `refresh` event so the parent refetches the route (`getMapStops`) and
   * recomputes markers + the `unlocated[]` list — the stop's coordinates may
   * have changed. The parent also re-opens the detail with the fresh note.
   */
  onAddressSaved(): void {
    this.refresh.emit();
  }

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
