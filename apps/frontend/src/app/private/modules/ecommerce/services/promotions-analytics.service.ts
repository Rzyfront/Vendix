import { Injectable } from '@angular/core';
import { environment } from '../../../../../environments/environment';

/**
 * Sink for `<app-promotion-stack>` analytics events emitted from the
 * ecommerce surfaces (catalog banner, PDP tier ladder, cart applied/tier
 * blocks).
 *
 * CP-ECOM-PROMO-UX-001 — G.1 acceptance "wired sink": the shared
 * promotion stack emits `promotionViewed` and `promotionIntent` outputs;
 * without a consumer those events were emitted into the void. Each
 * consumer (catalog, PDP, cart-promotions) injects THIS service and
 * forwards the events, so the loop is closed at the integration seam.
 *
 * The current implementation is a structured console sink gated to
 * non-production builds to keep the loop observable during convergence
 * without leaking PII or telemetry payloads to the live tenant. When a
 * real telemetry destination lands (Datadog RUM, GA4, etc.) the
 * `environment.production` branches are the seams to extend.
 */
@Injectable({
  providedIn: 'root',
})
export class PromotionsAnalyticsService {
  /**
   * View/impression of a promotion card. `mode` is the stack's visual
   * mode (`scroll-batch`, `compact-pills`, `expanded-cards`,
   * `marquee-bar`) so a single `promotion_id` can be tracked across
   * multiple surfaces without the downstream sink collapsing them.
   */
  trackViewed(promotion_id: string | number, mode: string): void {
    const payload = {
      event: 'promotion_viewed',
      promotion_id,
      mode,
      timestamp: Date.now(),
    };
    if (!environment.production) {
      // eslint-disable-next-line no-console
      console.info('[analytics] promotion_viewed', payload);
    }
    // TODO: forward to the real telemetry sink (GA4 / Datadog RUM).
  }

  /**
   * Tier-crossed intent. Fires when the buyer crosses a tier boundary
   * (e.g. went from 2 to 3 units) — the stack's own `effect()` only
   * emits this when `currentTier()` changes, so this is a meaningful
   * funnel step, not a debounced keystroke.
   */
  trackIntent(
    promotion_id: string | number,
    tier_index: number,
    quantity: number,
  ): void {
    const payload = {
      event: 'promotion_intent',
      promotion_id,
      tier_index,
      quantity,
      timestamp: Date.now(),
    };
    if (!environment.production) {
      // eslint-disable-next-line no-console
      console.info('[analytics] promotion_intent', payload);
    }
    // TODO: forward to the real telemetry sink (GA4 / Datadog RUM).
  }
}
