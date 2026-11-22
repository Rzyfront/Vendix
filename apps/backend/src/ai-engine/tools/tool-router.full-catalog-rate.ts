import { Logger } from '@nestjs/common';
import type { FullCatalogReason } from './tool-router.service';

/** Stable code of the alert line; dashboards and runbooks grep for it. */
export const FULL_CATALOG_RATE_CODE = 'TOOL_ROUTER_FULL_CATALOG_RATE';
/** Alert when more than this share of routed turns served the full catalog. */
export const FULL_CATALOG_RATE_THRESHOLD = 0.05;
/** Routed turns kept in the rolling window (per process). */
export const FULL_CATALOG_RATE_WINDOW = 200;
/** No alert below this many turns in the window: a tiny sample proves nothing. */
export const FULL_CATALOG_RATE_MIN_SAMPLE = 20;

/**
 * In-process rolling rate of full-catalog fallbacks (F10/T62). One entry per
 * routed turn; warns once each time the rate crosses the threshold upwards and
 * re-arms when it drops back. No Redis, no persistence: a restart empties it.
 */
export class FullCatalogRateMonitor {
  private readonly window: boolean[] = [];
  private fallbacks = 0;
  private alerting = false;

  constructor(private readonly logger: Pick<Logger, 'warn'> = new Logger('ToolRouter')) {}

  record(fallback: boolean, reason: FullCatalogReason | null): void {
    this.window.push(fallback);
    if (fallback) this.fallbacks++;
    if (this.window.length > FULL_CATALOG_RATE_WINDOW && this.window.shift())
      this.fallbacks--;
    const turns = this.window.length;
    const over =
      turns >= FULL_CATALOG_RATE_MIN_SAMPLE &&
      this.fallbacks / turns > FULL_CATALOG_RATE_THRESHOLD;
    if (over && !this.alerting) {
      this.logger.warn(
        `${FULL_CATALOG_RATE_CODE} fallbacks=${this.fallbacks} turns=${turns} ` +
          `rate=${((this.fallbacks / turns) * 100).toFixed(1)}% ` +
          `threshold=${FULL_CATALOG_RATE_THRESHOLD * 100}% last_reason=${reason ?? 'none'}`,
      );
    }
    this.alerting = over;
  }

  snapshot(): { turns: number; fallbacks: number } {
    return { turns: this.window.length, fallbacks: this.fallbacks };
  }
}
