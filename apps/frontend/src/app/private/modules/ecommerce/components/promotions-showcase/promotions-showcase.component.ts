import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  OnInit,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ActiveStorePromotion,
  CatalogService,
} from '../../services/catalog.service';
import { CurrencyPipe } from '../../../../../shared/pipes/currency';
import { BadgeComponent } from '../../../../../shared/components/badge/badge.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';

/**
 * Storefront home "Promociones activas" banner. Opt-in section: the home only
 * mounts it when `home_sections.promotions.enabled` is true. Self-gating on
 * data too — it renders nothing when there are no active promotions, so the
 * page never shows an empty promotions block.
 *
 * Each promotion shows its name plus the backend-formatted `badge_label`
 * (already localized: tiered → "Desde N und: -X% / -$Y", flat → "-X% OFF" /
 * "-$Y OFF"), so the component never recomputes discounts. When a promotion
 * declares a `min_purchase_amount`, a "Compra mínima" note is rendered with
 * the tenant `CurrencyPipe`.
 *
 * This banner doubles as the general indicator for ORDER-scope promotions on
 * the storefront, so no separate per-card chip is required for those.
 */
@Component({
  selector: 'app-promotions-showcase',
  standalone: true,
  imports: [CurrencyPipe, BadgeComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (promotions().length) {
      <section class="promotions-section">
        <div class="section-header">
          <span class="section-kicker">Ofertas del momento</span>
          <h2>{{ title() || 'Promociones activas' }}</h2>
          @if (subtitle()) {
            <p class="subtitle">{{ subtitle() }}</p>
          }
        </div>

        <div class="promotions-grid">
          @for (promo of promotions(); track promo.id) {
            <div class="promo-card">
              <div class="promo-icon">
                <app-icon name="ticket" [size]="20" />
              </div>
              <div class="promo-body">
                <h3 class="promo-name">{{ promo.name }}</h3>
                <app-badge variant="success" size="md">
                  {{ promo.badge_label }}
                </app-badge>
                @if (promo.min_purchase_amount) {
                  <span class="promo-min">
                    Compra mínima: {{ promo.min_purchase_amount | currency }}
                  </span>
                }
              </div>
            </div>
          }
        </div>
      </section>
    }
  `,
  styles: [
    `
      .promotions-section {
        padding: 2.5rem 1rem;
        max-width: 1200px;
        margin: 0 auto;
      }
      .section-header {
        text-align: center;
        margin-bottom: 1.75rem;
      }
      .section-kicker {
        display: inline-block;
        font-size: 0.75rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-primary, #2f6f4e);
        font-weight: 600;
      }
      .section-header h2 {
        font-size: 1.75rem;
        font-weight: 700;
        margin: 0.25rem 0;
      }
      .section-header .subtitle {
        color: #6b7280;
        margin: 0;
      }
      .promotions-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 1rem;
      }
      .promo-card {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        border-radius: 0.75rem;
        background: #fff;
        border: 1px solid #f0f0f0;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
        padding: 1rem;
        transition:
          transform 0.15s ease,
          box-shadow 0.15s ease;
      }
      .promo-card:hover {
        transform: translateY(-3px);
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.1);
      }
      .promo-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2.5rem;
        height: 2.5rem;
        flex-shrink: 0;
        border-radius: 0.65rem;
        background: rgba(16, 185, 129, 0.12);
        color: #059669;
      }
      .promo-body {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        min-width: 0;
      }
      .promo-name {
        font-size: 1rem;
        font-weight: 600;
        margin: 0;
        line-height: 1.2;
      }
      .promo-min {
        font-size: 0.8rem;
        color: #6b7280;
      }
    `,
  ],
})
export class PromotionsShowcaseComponent implements OnInit {
  readonly title = input<string>('');
  readonly subtitle = input<string>('');

  private readonly catalogService = inject(CatalogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly promotions = signal<ActiveStorePromotion[]>([]);

  ngOnInit(): void {
    this.catalogService
      .getActivePromotions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.promotions.set(res.data ?? []),
        error: () => this.promotions.set([]),
      });
  }
}
