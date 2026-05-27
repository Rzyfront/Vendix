import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { PriceTier } from '../../interfaces';

/**
 * Compact dropdown to select a price tier on a single sale line.
 *
 * Renders only when:
 *  - the parent decides the product supports multi-tarifa
 *    (`product.has_multiple_price_tiers === true`), AND
 *  - the user has `store:products:apply_pricing_tier` permission
 *    (gating happens in the parent, NOT in this component).
 *
 * The component is intentionally dumb: it does not fetch tiers, does not
 * resolve price — it only exposes the current selection plus a "Default
 * (sin tarifa)" sentinel value (`null`). All business logic lives in the
 * parent flow (POS cart, quotation modal, order modal).
 *
 * Output `selectedTierIdChange` emits `number | null` — `null` means "use
 * default cascade" (no tier applied).
 */
@Component({
  selector: 'app-price-tier-selector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  template: `
    @if (tiers().length > 0) {
      <div class="relative inline-flex items-center gap-1">
        <button
          type="button"
          class="tier-chip"
          [class.tier-chip--active]="isCustomTier()"
          (click)="toggleOpen()"
          [attr.aria-expanded]="isOpen()"
          [attr.aria-haspopup]="'listbox'"
          [title]="selectedTier()?.name || 'Tarifa default'"
        >
          <app-icon name="tag" [size]="12"></app-icon>
          <span class="truncate max-w-[110px]">{{
            selectedTier()?.name || 'Default'
          }}</span>
          @if (isPackageUnit()) {
            <span class="tier-chip__pkg">× {{ unitsPerPackage() }}</span>
          }
          <app-icon name="chevron-down" [size]="11"></app-icon>
        </button>

        @if (isOpen()) {
          <div
            class="tier-menu"
            role="listbox"
            (click)="$event.stopPropagation()"
          >
            <button
              type="button"
              role="option"
              [attr.aria-selected]="selectedTierId() === null"
              class="tier-menu__item"
              [class.tier-menu__item--selected]="selectedTierId() === null"
              (click)="select(null)"
            >
              <span class="font-medium">Default (sin tarifa)</span>
            </button>
            @for (tier of tiers(); track tier.id) {
              <button
                type="button"
                role="option"
                [attr.aria-selected]="selectedTierId() === tier.id"
                class="tier-menu__item"
                [class.tier-menu__item--selected]="selectedTierId() === tier.id"
                (click)="select(tier.id)"
              >
                <div class="flex items-center justify-between gap-2 w-full">
                  <div class="flex flex-col min-w-0">
                    <span class="font-medium truncate">{{ tier.name }}</span>
                    @if (tier.discount_percentage) {
                      <span class="text-[10px] text-text-secondary">
                        {{ tier.discount_percentage }}% off
                      </span>
                    }
                  </div>
                  @if (tier.is_package_unit) {
                    <span
                      class="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-semibold bg-blue-50 text-blue-700"
                      >paquete</span
                    >
                  }
                </div>
              </button>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: inline-block;
      }

      .tier-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 6px;
        border-radius: 9999px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        background: var(--color-muted);
        color: var(--color-text-secondary);
        border: 1px solid var(--color-border);
        transition: all 0.15s ease;
        line-height: 1.2;
      }

      .tier-chip:hover {
        background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface));
        color: var(--color-primary);
        border-color: color-mix(in srgb, var(--color-primary) 25%, var(--color-border));
      }

      .tier-chip--active {
        background: color-mix(in srgb, var(--color-primary) 12%, var(--color-surface));
        color: var(--color-primary);
        border-color: color-mix(in srgb, var(--color-primary) 35%, var(--color-border));
      }

      .tier-chip__pkg {
        font-size: 9px;
        color: color-mix(in srgb, var(--color-primary) 80%, var(--color-text-primary));
        background: rgba(255, 255, 255, 0.4);
        padding: 0 4px;
        border-radius: 4px;
      }

      .tier-menu {
        position: absolute;
        top: 100%;
        right: 0;
        margin-top: 4px;
        min-width: 180px;
        max-width: 240px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
        z-index: 30;
        overflow: hidden;
        max-height: 240px;
        overflow-y: auto;
      }

      .tier-menu__item {
        display: flex;
        width: 100%;
        text-align: left;
        padding: 8px 10px;
        font-size: 12px;
        color: var(--color-text-primary);
        background: transparent;
        border: 0;
        cursor: pointer;
        transition: background 0.12s ease;
      }

      .tier-menu__item:hover {
        background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface));
      }

      .tier-menu__item--selected {
        background: color-mix(in srgb, var(--color-primary) 10%, var(--color-surface));
        color: var(--color-primary);
        font-weight: 600;
      }
    `,
  ],
})
export class PriceTierSelectorComponent {
  readonly tiers = input.required<PriceTier[]>();
  readonly selectedTierId = input<number | null>(null);
  readonly unitsPerPackage = input<number | null>(null);

  readonly selectedTierIdChange = output<number | null>();

  readonly isOpen = signal(false);

  readonly selectedTier = computed<PriceTier | null>(() => {
    const id = this.selectedTierId();
    if (id == null) return null;
    return this.tiers().find((t) => t.id === id) ?? null;
  });

  readonly isCustomTier = computed(() => this.selectedTierId() !== null);

  readonly isPackageUnit = computed(
    () => !!this.selectedTier()?.is_package_unit && !!this.unitsPerPackage(),
  );

  toggleOpen(): void {
    this.isOpen.update((v) => !v);
  }

  select(tierId: number | null): void {
    this.isOpen.set(false);
    this.selectedTierIdChange.emit(tierId);
  }
}
