import { Component, computed, input, output, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { PopCartState } from '../interfaces/pop-cart.interface';
import { CostPreviewItem, CostPreviewResponse } from '../../interfaces';

/**
 * Shape of a per-line pricing override edited in the modal. Matches the
 * optional fields on the backend `ReceiveItemDto` so the parent can thread
 * the same value into `receivePurchaseOrder()` without remapping.
 */
export interface PricingOverride {
  new_base_price?: number;
  new_profit_margin?: number;
}

/**
 * Map of pricing overrides keyed by `${product_id}-${product_variant_id || 0}`
 * (the same key the modal already uses to track the @for loop). Keeping the
 * key shape consistent across the preview loop and the override Map avoids
 * subtle "value exists but key doesn't match" bugs at the call site.
 */
export type PricingOverridesMap = Map<string, PricingOverride>;

@Component({
  selector: 'app-pop-order-confirmation-modal',
  standalone: true,
  imports: [
    DatePipe,
    DecimalPipe,
    FormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    CurrencyPipe,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      [title]="modalTitle"
      size="lg"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
    >
      <div class="space-y-3 p-4">

        <!-- Proveedor + Bodega -->
        <div class="grid grid-cols-2 gap-3">
          <div class="border-l-2 border-[var(--color-primary)] rounded-r-lg bg-[var(--color-surface)] p-3">
            <p class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">Proveedor</p>
            <div class="flex items-center gap-2">
              <app-icon name="truck" [size]="16" color="var(--color-primary)"></app-icon>
              <span class="text-sm font-medium text-[var(--color-text-primary)]">{{ supplierName() || '—' }}</span>
            </div>
          </div>
          <div class="border-l-2 border-[var(--color-primary)] rounded-r-lg bg-[var(--color-surface)] p-3">
            <p class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">Bodega</p>
            <div class="flex items-center gap-2">
              <app-icon name="warehouse" [size]="16" color="var(--color-primary)"></app-icon>
              <span class="text-sm font-medium text-[var(--color-text-primary)]">{{ locationName() || '—' }}</span>
            </div>
          </div>
        </div>

        <!-- Productos -->
        <section class="border-l-2 border-[var(--color-primary)] rounded-r-lg bg-[var(--color-surface)] p-3">
          <p class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
            Productos ({{ cartState()?.items?.length || 0 }})
          </p>
          <div class="rounded-md overflow-hidden border border-[var(--color-border)] max-h-52 overflow-y-auto">
            @for (item of cartState()?.items; track item.id; let idx = $index) {
              <div class="flex items-center gap-2 px-2.5 py-1.5 text-sm"
                   [class]="idx % 2 === 0 ? 'bg-[var(--color-surface)]' : 'bg-[var(--color-surface-elevated)]'">
                <div class="flex-1 min-w-0 truncate">
                  <span class="font-medium text-[var(--color-text-primary)]">
                    {{ item.is_prebulk ? item.prebulk_data?.name : item.product.name }}
                  </span>
                  @if (item.variant?.name) {
                    <span class="text-xs text-[var(--color-text-muted)]"> · {{ item.variant!.name }}</span>
                  }
                </div>
                <span class="text-xs text-[var(--color-text-secondary)] whitespace-nowrap shrink-0">
                  {{ item.quantity }} × {{ item.unit_cost | currency }}
                </span>
                <span class="font-medium text-[var(--color-text-primary)] whitespace-nowrap shrink-0 min-w-[4.5rem] text-right">
                  {{ item.total | currency }}
                </span>
              </div>
            }
          </div>
        </section>

        @if (actionType() === 'create-receive' && (loadingPreview() || (costPreview()?.items?.length ?? 0) > 0)) {
          <section class="border-l-2 border-amber-400 rounded-r-lg bg-[var(--color-surface)] p-3">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <p class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  Valoración de Inventario
                </p>
                @if (costPreview()?.costing_method) {
                  <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                        [class]="costPreview()!.costing_method === 'cpp'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-purple-100 text-purple-700'">
                    {{ costPreview()!.costing_method === 'cpp' ? 'CPP' : 'FIFO' }}
                  </span>
                }
              </div>
              <button type="button"
                      class="text-[10px] text-[var(--color-primary)] hover:underline font-medium"
                      (click)="navigateToSettings.emit()">
                Cambiar estrategia →
              </button>
            </div>
            @if (loadingPreview()) {
              <div class="space-y-2">
                <div class="h-8 bg-gray-100 rounded animate-pulse"></div>
                <div class="h-8 bg-gray-100 rounded animate-pulse w-3/4"></div>
              </div>
            } @else {
              <div class="rounded-md overflow-hidden border border-[var(--color-border)]">
                @for (item of costPreview()?.items; track previewKey(item); let idx = $index) {
                  <div class="px-2.5 py-2 text-xs space-y-1.5"
                       [class]="idx % 2 === 0 ? 'bg-[var(--color-surface)]' : 'bg-[var(--color-surface-elevated)]'">
                    <div class="font-medium text-[var(--color-text-primary)] mb-0.5">
                      {{ item.product_name }}
                      @if (item.variant_name) {
                        <span class="text-[var(--color-text-muted)]"> · {{ item.variant_name }}</span>
                      }
                    </div>
                    @if (item.is_reactivation) {
                      <div class="text-[var(--color-text-secondary)]">
                        <span class="inline-flex items-center gap-1 text-amber-600 font-medium">
                          <app-icon name="rotate-ccw" [size]="11"></app-icon>
                          Reactivación
                        </span>
                        — {{ item.incoming_quantity }} uds @ {{ item.incoming_cost | currency }}
                      </div>
                      <div class="text-[var(--color-text-secondary)]">
                        Costo nuevo: <span class="font-medium text-[var(--color-text-primary)]">{{ item.new_cost_per_unit | currency }}</span>
                      </div>
                    } @else if (costPreview()?.costing_method === 'cpp') {
                      <div class="flex items-center gap-3 text-[var(--color-text-secondary)]">
                        <span>Stock: {{ item.global_stock }} → <span class="font-medium text-[var(--color-text-primary)]">{{ item.new_stock }}</span></span>
                        <span class="text-[var(--color-border)]">|</span>
                        <span>Costo: {{ item.global_cost_per_unit | currency }} → <span class="font-medium text-[var(--color-text-primary)]">{{ item.new_cost_per_unit | currency }}</span></span>
                      </div>
                    } @else {
                      <div class="text-[var(--color-text-secondary)]">
                        Nueva capa: {{ item.incoming_quantity }} uds @ {{ item.incoming_cost | currency }}
                      </div>
                    }

                    <!-- ===== QUI-425 (D3): editable margin UX ===== -->
                    <div class="pt-1.5 border-t border-[var(--color-border)]/60 grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div class="text-[var(--color-text-secondary)] flex flex-col">
                        <span class="text-[10px] uppercase tracking-wider">Costo nuevo</span>
                        <span class="font-medium text-[var(--color-text-primary)]">{{ item.new_cost_per_unit | currency }}</span>
                      </div>
                      <div class="text-[var(--color-text-secondary)] flex flex-col">
                        <span class="text-[10px] uppercase tracking-wider">Margen resultante</span>
                        <span class="font-medium text-[var(--color-text-primary)]">
                          @if (previewMargin(item) !== null) {
                            {{ previewMargin(item) | number:'1.0-1' }}%
                          } @else {
                            —
                          }
                        </span>
                      </div>
                      <div class="text-[var(--color-text-secondary)] flex flex-col">
                        <span class="text-[10px] uppercase tracking-wider">Precio base actual</span>
                        <span class="font-medium text-[var(--color-text-primary)]">{{ item.current_base_price | currency }}</span>
                      </div>

                      <div class="sm:col-span-1">
                        <app-input
                          type="number"
                          [label]="'Nuevo margen (%)'"
                          [customInputClass]="'text-sm'"
                          [ngModel]="marginDraftFor(item)"
                          (ngModelChange)="onMarginDraftChange(item, $event)"
                        ></app-input>
                      </div>
                      <div class="sm:col-span-1">
                        <app-input
                          [currency]="true"
                          [currencyDecimals]="2"
                          [label]="'Nuevo precio base'"
                          [customInputClass]="'text-sm'"
                          [ngModel]="priceDraftFor(item)"
                          (ngModelChange)="onPriceDraftChange(item, $event)"
                        ></app-input>
                      </div>
                      <div class="sm:col-span-1 flex items-end">
                        @if (hasOverride(item)) {
                          <button type="button"
                                  class="text-[10px] text-[var(--color-primary)] hover:underline font-medium"
                                  (click)="clearOverride(item)">
                            Restablecer (anclar a costo)
                          </button>
                        }
                      </div>
                    </div>
                  </div>
                }
              </div>
            }
          </section>
        }

        <!-- Detalles -->
        <section class="border-l-2 border-[var(--color-primary)] rounded-r-lg bg-[var(--color-surface)] p-3">
          <p class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Detalles</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <!-- Fecha Orden -->
            <div class="flex items-center gap-1.5">
              <app-icon name="calendar" [size]="13" color="var(--color-text-muted)"></app-icon>
              <span class="text-[var(--color-text-muted)]">Orden:</span>
              <span class="font-medium text-[var(--color-text-primary)]">{{ cartState()?.orderDate | date:'dd/MM/yyyy' }}</span>
            </div>
            <!-- Fecha Entrega -->
            @if (cartState()?.expectedDate) {
              <div class="flex items-center gap-1.5">
                <app-icon name="calendar-check" [size]="13" color="var(--color-text-muted)"></app-icon>
                <span class="text-[var(--color-text-muted)]">Entrega:</span>
                <span class="font-medium text-[var(--color-text-primary)]">{{ cartState()!.expectedDate | date:'dd/MM/yyyy' }}</span>
              </div>
            }
            <!-- Método Envío -->
            @if (cartState()?.shippingMethod) {
              <div class="flex items-center gap-1.5">
                <app-icon name="truck" [size]="13" color="var(--color-text-muted)"></app-icon>
                <span class="text-[var(--color-text-muted)]">Envío:</span>
                <span class="font-medium text-[var(--color-text-primary)]">{{ shippingMethodLabel }}</span>
              </div>
            }
            <!-- Términos de pago -->
            @if (cartState()?.paymentTerms) {
              <div class="flex items-center gap-1.5">
                <app-icon name="credit-card" [size]="13" color="var(--color-text-muted)"></app-icon>
                <span class="text-[var(--color-text-muted)]">Pago:</span>
                <span class="font-medium text-[var(--color-text-primary)]">{{ cartState()!.paymentTerms }}</span>
              </div>
            }
          </div>
          <!-- Notas -->
          @if (cartState()?.notes) {
            <div class="mt-2 pt-2 border-t border-[var(--color-border)]">
              <p class="text-xs text-[var(--color-text-muted)] font-medium mb-0.5">Notas</p>
              <p class="text-sm text-[var(--color-text-secondary)] whitespace-pre-line line-clamp-3">{{ cartState()!.notes }}</p>
            </div>
          }
        </section>

        <!-- Totales -->
        <section class="rounded-lg overflow-hidden border border-[var(--color-primary)] bg-[var(--color-primary-light)]">
          <div class="px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-[var(--color-text-secondary)] border-b border-[var(--color-border)]">
            <span>Subtotal: <span class="font-medium text-[var(--color-text-primary)]">{{ cartState()?.summary?.subtotal | currency }}</span></span>
            @if ((cartState()?.summary?.tax_amount || 0) > 0) {
              <span>Impuestos: <span class="font-medium text-[var(--color-text-primary)]">{{ cartState()!.summary.tax_amount | currency }}</span></span>
            }
            @if ((cartState()?.shippingCost || 0) > 0) {
              <span>Envío: <span class="font-medium text-[var(--color-text-primary)]">{{ cartState()!.shippingCost | currency }}</span></span>
            }
          </div>
          <div class="px-3 py-2.5 flex items-center justify-between">
            <span class="text-sm font-semibold text-[var(--color-text-primary)]">Total</span>
            <span class="text-xl font-bold text-[var(--color-primary)]">{{ cartState()?.summary?.total | currency }}</span>
          </div>
        </section>

      </div>

      <div slot="footer">
        <div class="flex items-center justify-end gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100">
          <app-button variant="outline" (clicked)="onCancel()">Cancelar</app-button>
          <app-button variant="primary" (clicked)="onConfirm()">
            <app-icon [name]="actionType() === 'create-receive' ? 'package-check' : 'check'" [size]="16" slot="icon" ></app-icon>
            {{ actionType() === 'create-receive' ? 'Crear y Recibir' : 'Crear Orden' }}
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class PopOrderConfirmationModalComponent {
  readonly isOpen = input(false);
  readonly isOpenChange = output<boolean>();
  readonly cartState = input<PopCartState | null>(null);
  readonly supplierName = input('');
  readonly locationName = input('');
  readonly actionType = input<'create' | 'create-receive'>('create');
  readonly costPreview = input<CostPreviewResponse | null>(null);
  readonly loadingPreview = input(false);
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
  readonly navigateToSettings = output<void>();
  // ===== QUI-425 (D3) margin UX =====
  // Emitted on every override change so the parent can keep a fresh Map
  // ready when the operator clicks "Crear y Recibir" without forcing a
  // round-trip through the modal. The parent decides what to do with it
  // (e.g. gate the submit button, surface a summary, etc.).
  readonly pricingOverridesChange = output<PricingOverridesMap>();

  /**
   * Signal-backed Map of overrides keyed by the same string used in the
   * preview `@for` loop. Plain Maps are not reactive in zoneless, so we
   * hold the Map itself inside a signal and call `.set(new Map(...))` on
   * every mutation to trigger downstream `computed()` re-evaluation.
   */
  readonly pricingOverrides = signal<PricingOverridesMap>(new Map());

  get modalTitle(): string {
    return this.actionType() === 'create-receive'
      ? 'Crear y Recibir Inventario'
      : 'Confirmar Orden de Compra';
  }

  get shippingMethodLabel(): string {
    const labels: Record<string, string> = {
      supplier_transport: 'Transporte Proveedor',
      freight: 'Flete',
      pickup: 'Recolección',
      other: 'Otro',
    };
    return labels[this.cartState()?.shippingMethod || ''] || this.cartState()?.shippingMethod || '';
  }

  /** Stable key for the preview @for loop AND the override Map. */
  previewKey(item: CostPreviewItem): string {
    return `${item.product_id}-${item.product_variant_id || 0}`;
  }

  /** True when the operator has set at least one override for this line. */
  hasOverride(item: CostPreviewItem): boolean {
    const o = this.pricingOverrides().get(this.previewKey(item));
    return !!(o && (o.new_base_price !== undefined || o.new_profit_margin !== undefined));
  }

  /**
   * Margin displayed in the "Margen resultante" column. When the operator
   * has set a margin override we show that override (so the value matches
   * what will be persisted); when they set a price override we re-derive
   * the margin from the override; otherwise we fall back to the backend's
   * `resulting_margin` (cost-anchor default).
   */
  previewMargin(item: CostPreviewItem): number | null {
    const o = this.pricingOverrides().get(this.previewKey(item));
    if (o?.new_profit_margin !== undefined) return o.new_profit_margin;
    if (o?.new_base_price !== undefined && item.new_cost_per_unit > 0) {
      return Math.round(
        ((o.new_base_price - item.new_cost_per_unit) / item.new_cost_per_unit) *
          10000,
      ) / 100;
    }
    return item.resulting_margin;
  }

  /** Display value for the "Nuevo margen" input (string for app-input). */
  marginDraftFor(item: CostPreviewItem): string {
    const o = this.pricingOverrides().get(this.previewKey(item));
    if (o?.new_profit_margin !== undefined) return String(o.new_profit_margin);
    // Default suggestion: backend's resulting_margin (cost-anchor default).
    return item.resulting_margin !== null ? String(item.resulting_margin) : '';
  }

  /** Display value for the "Nuevo precio base" input (string for app-input). */
  priceDraftFor(item: CostPreviewItem): string {
    const o = this.pricingOverrides().get(this.previewKey(item));
    if (o?.new_base_price !== undefined) return String(o.new_base_price);
    return String(item.current_base_price ?? 0);
  }

  /**
   * Handler for the margin input. Parses the string from app-input, then:
   *  - Re-derives `new_base_price` from the new cost so the price input
   *    stays in sync (the math lives in one place: backend skill rule).
   *  - Stores ONLY `new_profit_margin` in the override Map — when the
   *    operator confirms, the backend will re-derive the price from cost
   *    (single source of truth: the cost).
   */
  onMarginDraftChange(item: CostPreviewItem, raw: string): void {
    const key = this.previewKey(item);
    const value = this.parseOptionalNumber(raw);
    const next = new Map(this.pricingOverrides());
    const existing: PricingOverride = next.get(key) ?? {};
    if (value === null) {
      // Empty input → drop the override entirely (back to cost-anchor).
      delete existing.new_profit_margin;
      if (existing.new_base_price === undefined) {
        next.delete(key);
      } else {
        next.set(key, existing);
      }
    } else {
      existing.new_profit_margin = value;
      next.set(key, existing);
    }
    this.pricingOverrides.set(next);
    this.pricingOverridesChange.emit(next);
  }

  /**
   * Handler for the price input. We store ONLY `new_base_price` and let the
   * backend derive the margin — keeps the override payload minimal and
   * avoids two sources of truth drifting on the wire.
   */
  onPriceDraftChange(item: CostPreviewItem, raw: string): void {
    const key = this.previewKey(item);
    const value = this.parseOptionalNumber(raw);
    const next = new Map(this.pricingOverrides());
    const existing: PricingOverride = next.get(key) ?? {};
    if (value === null) {
      delete existing.new_base_price;
      if (existing.new_profit_margin === undefined) {
        next.delete(key);
      } else {
        next.set(key, existing);
      }
    } else {
      existing.new_base_price = value;
      next.set(key, existing);
    }
    this.pricingOverrides.set(next);
    this.pricingOverridesChange.emit(next);
  }

  clearOverride(item: CostPreviewItem): void {
    const key = this.previewKey(item);
    const next = new Map(this.pricingOverrides());
    next.delete(key);
    this.pricingOverrides.set(next);
    this.pricingOverridesChange.emit(next);
  }

  /**
   * Tolerates "", null and NaN so an empty app-input value is treated as
   * "no override" rather than crashing the price parser downstream.
   */
  private parseOptionalNumber(raw: string | null | undefined): number | null {
    if (raw === null || raw === undefined || raw === '') return null;
    const cleaned = String(raw).replace(/,/g, '.').trim();
    if (cleaned === '') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  onConfirm(): void {
    // Forward the current overrides so the parent can grab them in the same
    // tick without subscribing to the output (cheaper than toSignal here).
    this.pricingOverridesChange.emit(this.pricingOverrides());
    this.confirmed.emit();
  }

  onCancel(): void {
    this.cancelled.emit();
    this.isOpenChange.emit(false);
  }
}