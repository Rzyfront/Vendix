import { Injectable, Logger } from '@nestjs/common';

/**
 * Canonical configuration for the subscription gate system.
 *
 * Default mode is **log-only** (observe without blocking).
 * Enforce mode is activated only when `STORE_GATE_ENFORCE === 'true'`.
 *
 * Backwards-compat alias `AI_GATE_ENFORCE` is still honored for one release
 * but emits a deprecation warning on startup.
 *
 * Configuration is read once at construction time and cached for immutability.
 * Call `reload()` to re-read env vars for dynamic rollout without a process restart.
 */
@Injectable()
export class SubscriptionGateConfig {
  private readonly logger = new Logger(SubscriptionGateConfig.name);

  private _enforce: boolean;
  private _logOnly: boolean;
  private _cronDryRun: boolean;

  constructor() {
    this._loadConfig();
  }

  private _loadConfig(): void {
    this._enforce =
      process.env.STORE_GATE_ENFORCE === 'true' ||
      process.env.AI_GATE_ENFORCE === 'true';
    this._logOnly = !this._enforce;
    this._cronDryRun = process.env.SUBSCRIPTION_CRON_DRY_RUN === 'true';

    if (process.env.AI_GATE_ENFORCE !== undefined) {
      this.logger.warn(
        'AI_GATE_ENFORCE is deprecated and will be removed in a future release. Use STORE_GATE_ENFORCE instead.',
      );
    }
  }

  /**
   * Returns `true` when the gate should actively block requests.
   * Default is `false` (log-only) to preserve UX during rollout.
   */
  isEnforce(): boolean {
    return this._enforce;
  }

  /**
   * Returns `true` when the gate is in observability / log-only mode.
   */
  isLogOnly(): boolean {
    return this._logOnly;
  }

  /**
   * Returns `true` when subscription cron jobs should skip all writes
   * and only emit structured log entries for observability.
   *
   * Activated by setting `SUBSCRIPTION_CRON_DRY_RUN=true` in the
   * environment. Safe to use in production to verify what the crons
   * would process without side effects.
   */
  isCronDryRun(): boolean {
    return this._cronDryRun;
  }

  /**
   * Re-reads env vars and updates the cached configuration.
   * Use this for dynamic rollout (flip `STORE_GATE_ENFORCE` without a full restart).
   */
  reload(): void {
    this._loadConfig();
    this.logger.log(
      `SubscriptionGateConfig reloaded — enforce=${this._enforce}, cronDryRun=${this._cronDryRun}`,
    );
  }
}
