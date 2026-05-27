import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  TemplateRef,
  ViewContainerRef,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  Overlay,
  OverlayRef,
  ConnectedPosition,
} from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { ESCAPE } from '@angular/cdk/keycodes';
import { fromEvent } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { PriceTier } from '../../interfaces';

/**
 * Compact dropdown to select a price tier on a single sale line.
 *
 * Uses CDK Overlay to portal the menu to `document.body`, escaping any
 * transformed/overflow-hidden ancestors (e.g. POS cart panel, mobile cart
 * slide-up modal).
 *
 * Renders only when:
 *  - the parent decides the product supports multi-tarifa
 *    (`product.has_multiple_price_tiers === true`), AND
 *  - the user has `store:products:apply_pricing_tier` permission
 *    (gating happens in the parent, NOT in this component).
 */
@Component({
  selector: 'app-price-tier-selector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  template: `
    @if (tiers().length > 0) {
      <div class="inline-flex items-center gap-1">
        <button
          #trigger
          type="button"
          class="tier-chip"
          [class.tier-chip--active]="isCustomTier()"
          (click)="toggle()"
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
      </div>

      <ng-template #menuTpl>
        <div class="tier-menu" role="listbox">
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
                  >paquete</span>
                }
              </div>
            </button>
          }
        </div>
      </ng-template>
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
    `,
  ],
  // CDK overlay styles target the panel via `.tier-menu` class; the panel
  // sits outside this component's view-encapsulation, so the styles must
  // live globally. We register them as `:host ::ng-deep` won't reach the
  // portal — instead, mirror them via a small style block injected globally
  // through the CDK pane class.
})
export class PriceTierSelectorComponent implements OnDestroy {
  readonly tiers = input.required<PriceTier[]>();
  readonly selectedTierId = input<number | null>(null);
  readonly unitsPerPackage = input<number | null>(null);

  readonly selectedTierIdChange = output<number | null>();

  readonly isOpen = signal(false);
  readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  readonly menuTpl = viewChild<TemplateRef<unknown>>('menuTpl');

  private readonly overlay = inject(Overlay);
  private readonly vcr = inject(ViewContainerRef);
  private readonly destroyRef = inject(DestroyRef);
  private overlayRef: OverlayRef | null = null;

  readonly selectedTier = computed<PriceTier | null>(() => {
    const id = this.selectedTierId();
    if (id == null) return null;
    return this.tiers().find((t) => t.id === id) ?? null;
  });

  readonly isCustomTier = computed(() => this.selectedTierId() !== null);

  readonly isPackageUnit = computed(
    () => !!this.selectedTier()?.is_package_unit && !!this.unitsPerPackage(),
  );

  toggle(): void {
    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
    }
  }

  private open(): void {
    const btn = this.trigger()?.nativeElement;
    const tpl = this.menuTpl();
    if (!btn || !tpl) return;

    const positions: ConnectedPosition[] = [
      // Preferred: anchor bottom-right of trigger to top-right of menu.
      { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
      // Fallback above: trigger top-right → menu bottom-right.
      { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
      // Fallback below-left if no room on the right edge.
      { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    ];

    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo(btn)
      .withPositions(positions)
      .withPush(true)
      .withFlexibleDimensions(false)
      .withViewportMargin(8);

    this.overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-transparent-backdrop',
      panelClass: 'tier-menu-panel',
      minWidth: 200,
      maxWidth: 280,
      maxHeight: 320,
    });

    this.overlayRef.attach(new TemplatePortal(tpl, this.vcr));
    this.isOpen.set(true);

    this.overlayRef
      .backdropClick()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.close());

    this.overlayRef
      .keydownEvents()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((ev) => {
        if (ev.keyCode === ESCAPE) this.close();
      });

    // Close on outside scroll of any ancestor (reposition strategy already
    // handles viewport scroll, but a long-running scroll inside the cart
    // container should still dismiss the popover).
    fromEvent(window, 'resize')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.close());
  }

  private close(): void {
    this.overlayRef?.detach();
    this.overlayRef?.dispose();
    this.overlayRef = null;
    this.isOpen.set(false);
  }

  select(tierId: number | null): void {
    this.close();
    this.selectedTierIdChange.emit(tierId);
  }

  ngOnDestroy(): void {
    this.close();
  }
}
