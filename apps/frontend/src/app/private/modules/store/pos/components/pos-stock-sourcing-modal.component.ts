import {
  Component,
  computed,
  inject,
  input,
  model,
  output,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';

import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { StockSourcingSuggestionResponse } from '../models/sourcing.model';

/**
 * POS Stock Sourcing Modal.
 *
 * Surfaced when the cashier tries to add a product/variant whose
 * in-scope (main-location) stock is insufficient. Reacts to the
 * `suggestion` field returned by
 * `GET /store/inventory/stock-levels/sourcing-suggestion`:
 *
 *  - `'transfer'`: another location has stock — offer to start a transfer.
 *  - `'purchase'`: no location has stock — offer to create a purchase order.
 *
 * Standalone, reusable, signal-based; mobile-first markup.
 */
@Component({
  selector: 'app-pos-stock-sourcing-modal',
  standalone: true,
  imports: [DecimalPipe, ModalComponent, ButtonComponent, IconComponent],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      [title]="modalTitle()"
      [subtitle]="modalSubtitle()"
      size="md"
      [showCloseButton]="true"
      (cancel)="onClose()"
    >
      <div class="space-y-4 py-2">
        <!-- Product summary -->
        <div
          class="rounded-[var(--radius-md)] bg-[var(--color-muted)]/40 border border-[var(--color-border)] p-3"
        >
          <div class="flex items-start gap-3">
            <div
              class="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
              [class]="iconWrapperClass()"
            >
              <app-icon
                [name]="iconName()"
                [size]="18"
                [color]="iconColor()"
              ></app-icon>
            </div>
            <div class="min-w-0 flex-1">
              <p
                class="text-[var(--fs-sm)] font-[var(--fw-semibold)] text-[var(--color-text-primary)] truncate"
              >
                {{ productName() || 'Producto' }}
              </p>
              @if (variantLabel()) {
                <p
                  class="text-[var(--fs-xs)] text-[var(--color-text-secondary)] truncate"
                >
                  {{ variantLabel() }}
                </p>
              }
              <p
                class="text-[var(--fs-xs)] text-[var(--color-text-secondary)] mt-0.5"
              >
                Solicitado:
                <span class="font-[var(--fw-medium)]"
                  >{{ requestedQuantity() | number }} unidades</span
                >
              </p>
            </div>
          </div>
        </div>

        <!-- Transfer suggestion -->
        @if (isTransferSuggestion()) {
          <div>
            <p
              class="text-[var(--fs-sm)] text-[var(--color-text-primary)] mb-2"
            >
              Hay stock disponible en otras bodegas:
            </p>
            <ul class="space-y-2">
              @for (loc of otherLocations(); track loc.id) {
                <li
                  class="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <app-icon
                      name="warehouse"
                      [size]="16"
                      color="var(--color-text-secondary)"
                    ></app-icon>
                    <span
                      class="text-[var(--fs-sm)] text-[var(--color-text-primary)] truncate"
                    >
                      {{ loc.name }}
                    </span>
                  </div>
                  <span
                    class="text-[var(--fs-sm)] font-[var(--fw-semibold)] text-[var(--color-success)]"
                  >
                    {{ loc.quantity_available | number }} disp.
                  </span>
                </li>
              } @empty {
                <li
                  class="text-[var(--fs-xs)] text-[var(--color-text-secondary)] italic"
                >
                  Sin bodegas alternativas con stock.
                </li>
              }
            </ul>

            @if (!canCreateTransfer()) {
              <p
                class="mt-3 text-[var(--fs-xs)] text-[var(--color-text-secondary)]"
              >
                Solicita una transferencia al administrador de la organización
                para mover el stock a tu bodega.
              </p>
            }
          </div>
        }

        <!-- Purchase suggestion -->
        @if (isPurchaseSuggestion()) {
          <div
            class="rounded-[var(--radius-md)] border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-3"
          >
            <p
              class="text-[var(--fs-sm)] text-[var(--color-text-primary)]"
            >
              Este producto no tiene stock disponible en ninguna bodega activa
              de la tienda. Considera crear una orden de compra al proveedor.
            </p>
          </div>
        }
      </div>

      <div slot="footer" class="flex justify-end gap-2 md:gap-3">
        <app-button variant="outline" (clicked)="onClose()">Cancelar</app-button>

        @if (isTransferSuggestion() && canCreateTransfer()) {
          <app-button variant="primary" (clicked)="onCreateTransfer()">
            Crear transferencia
          </app-button>
        }

        @if (isPurchaseSuggestion()) {
          <app-button variant="primary" (clicked)="onCreatePurchaseOrder()">
            Crear orden de compra
          </app-button>
        }
      </div>
    </app-modal>
  `,
})
export class PosStockSourcingModalComponent {
  // ─── Inputs ─────────────────────────────────────────────────────────────
  readonly isOpen = model<boolean>(false);
  readonly suggestion = input<StockSourcingSuggestionResponse | null>(null);
  readonly productName = input<string>('');
  readonly variantLabel = input<string>('');

  // ─── Outputs ────────────────────────────────────────────────────────────
  readonly closed = output<void>();

  // ─── Services ───────────────────────────────────────────────────────────
  private readonly router = inject(Router);
  private readonly authFacade = inject(AuthFacade);

  // ─── Derived state ──────────────────────────────────────────────────────
  readonly otherLocations = computed(
    () => this.suggestion()?.other_locations ?? [],
  );
  readonly requestedQuantity = computed(
    () => this.suggestion()?.requested_quantity ?? 0,
  );

  readonly isTransferSuggestion = computed(
    () => this.suggestion()?.suggestion === 'transfer',
  );
  readonly isPurchaseSuggestion = computed(
    () => this.suggestion()?.suggestion === 'purchase',
  );

  /**
   * Store admins/cashiers can always navigate to the store-admin transfers
   * route. For ecommerce-only contexts we degrade to a help message.
   * Driven by the active user's available store admin permissions; we
   * fall back to `true` when undetermined so the CTA is not hidden by
   * a transient permission load.
   */
  readonly canCreateTransfer = computed(() => {
    const perms = (this.authFacade.userPermissions() as string[] | null) ?? [];
    if (perms.length === 0) return true;
    return (
      perms.includes('store:stock-transfers:create') ||
      perms.includes('store:stock-transfers:update')
    );
  });

  readonly modalTitle = computed(() => {
    if (this.isTransferSuggestion()) return 'Stock disponible en otra bodega';
    if (this.isPurchaseSuggestion()) return 'Sin stock en ninguna bodega';
    return 'Disponibilidad de stock';
  });

  readonly modalSubtitle = computed(() => {
    if (this.isTransferSuggestion()) {
      return 'La bodega del POS no tiene suficiente stock para esta venta.';
    }
    if (this.isPurchaseSuggestion()) {
      return 'Ninguna bodega activa tiene stock suficiente para esta venta.';
    }
    return '';
  });

  readonly iconName = computed(() => {
    if (this.isTransferSuggestion()) return 'truck';
    if (this.isPurchaseSuggestion()) return 'package';
    return 'alert-triangle';
  });

  readonly iconColor = computed(() => {
    if (this.isTransferSuggestion()) return 'var(--color-info)';
    if (this.isPurchaseSuggestion()) return 'var(--color-warning)';
    return 'var(--color-text-secondary)';
  });

  readonly iconWrapperClass = computed(() => {
    if (this.isTransferSuggestion()) {
      return 'bg-[var(--color-info)]/10';
    }
    if (this.isPurchaseSuggestion()) {
      return 'bg-[var(--color-warning)]/15';
    }
    return 'bg-[var(--color-muted)]';
  });

  // ─── Actions ────────────────────────────────────────────────────────────
  onClose(): void {
    this.isOpen.set(false);
    this.closed.emit();
  }

  onCreateTransfer(): void {
    this.isOpen.set(false);
    this.closed.emit();
    this.router.navigate(['/admin/inventory/transfers']).catch((err) => {
      console.error(
        '[PosStockSourcingModal] navigation to transfers failed',
        err,
      );
    });
  }

  onCreatePurchaseOrder(): void {
    this.isOpen.set(false);
    this.closed.emit();
    this.router.navigate(['/admin/orders/purchase-orders']).catch((err) => {
      console.error(
        '[PosStockSourcingModal] navigation to purchase-orders failed',
        err,
      );
    });
  }
}
