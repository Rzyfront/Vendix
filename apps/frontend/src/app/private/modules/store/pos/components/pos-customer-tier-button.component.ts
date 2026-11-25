import { Component, computed, input, output } from '@angular/core';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { CartItem } from '../models/cart.model';
import {
  CustomerTierRef,
  customerTierShortcut,
} from '../utils/customer-tier-prompt.util';

/**
 * Acceso a la tarifa del cliente desde la orden, junto a «Cambiar» y «Quitar»
 * cliente. Solo se pinta si el cliente tiene tarifa y el cajero puede
 * aplicarla; el contador indica las líneas elegibles que aún no la llevan.
 * Sin nada que aplicar queda deshabilitado con el motivo en `title`.
 *
 * Usa `aria-disabled` (no `disabled`) para que siga siendo enfocable y el
 * lector de pantalla y el `title` expliquen por qué no aplica.
 */
@Component({
  selector: 'app-pos-customer-tier-button',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (state(); as s) {
      <button
        type="button"
        class="tier-btn"
        [class.tier-btn--md]="size() === 'md'"
        [class.tier-btn--pending]="!s.disabledReason"
        [attr.aria-disabled]="s.disabledReason ? 'true' : null"
        [attr.title]="title()"
        [attr.aria-label]="ariaLabel()"
        (click)="onClick()"
      >
        <app-icon name="tags" [size]="size() === 'md' ? 15 : 13"></app-icon>
        @if (!s.disabledReason) {
          <span class="tier-btn__count" aria-hidden="true">{{
            s.pendingItemIds.length
          }}</span>
        }
      </button>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }
      .tier-btn {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 2px;
        min-width: 32px;
        height: 32px;
        padding: 0 6px;
        border: 1px solid transparent;
        border-radius: 8px;
        background: transparent;
        color: #94a3b8;
        cursor: not-allowed;
        flex-shrink: 0;
        transition: all 0.15s ease;
      }
      .tier-btn--md {
        min-width: 40px;
        height: 40px;
      }
      .tier-btn--pending {
        color: var(--color-primary);
        background: color-mix(in srgb, var(--color-primary) 8%, transparent);
        border-color: color-mix(in srgb, var(--color-primary) 25%, transparent);
        cursor: pointer;
      }
      .tier-btn--pending:hover {
        background: color-mix(in srgb, var(--color-primary) 14%, transparent);
      }
      .tier-btn:focus-visible {
        outline: 3px solid var(--color-primary);
        outline-offset: 2px;
      }
      .tier-btn__count {
        font-size: 11px;
        font-weight: 700;
        line-height: 1;
        font-variant-numeric: tabular-nums;
      }
    `,
  ],
})
export class PosCustomerTierButtonComponent {
  readonly items = input<CartItem[]>([]);
  readonly tier = input<CustomerTierRef | null>(null);
  readonly canApplyTier = input<boolean>(false);
  /** `md` en el carrito táctil (tablet/móvil); `sm` en el de escritorio. */
  readonly size = input<'sm' | 'md'>('sm');
  readonly apply = output<void>();

  readonly state = computed(() =>
    customerTierShortcut({
      items: this.items(),
      tier: this.tier(),
      canApplyTier: this.canApplyTier(),
    }),
  );

  readonly title = computed(() => {
    const s = this.state();
    if (!s) return null;
    return (
      s.disabledReason ??
      `Aplicar la tarifa "${s.tier.name}" a ${s.pendingItemIds.length} producto(s)`
    );
  });

  readonly ariaLabel = computed(() => {
    const s = this.state();
    if (!s) return null;
    const base = 'Aplicar la tarifa del cliente a la orden';
    return s.disabledReason
      ? `${base}: ${s.disabledReason}`
      : `${base}: "${s.tier.name}" en ${s.pendingItemIds.length} producto(s)`;
  });

  onClick(): void {
    const s = this.state();
    if (s && !s.disabledReason) this.apply.emit();
  }
}
