import { Injectable, Logger } from '@nestjs/common';

/**
 * Canonical configuration for the subscription gate system.
 *
 * Default mode is **enforce**: stores without an active/trial subscription are
 * blocked from store writes. The gate can be turned back to observe-only by
 * explicitly setting `STORE_GATE_ENFORCE=false` (deprecated alias
 * `AI_GATE_ENFORCE=false`), e.g. for a temporary incident bypass.
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
    // Enforce by default. Disabled only when explicitly opted out with
    // STORE_GATE_ENFORCE=false (or the deprecated AI_GATE_ENFORCE=false).
    this._enforce =
      process.env.STORE_GATE_ENFORCE !== 'false' &&
      process.env.AI_GATE_ENFORCE !== 'false';
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
   * Default is `true` (enforce); opt out with `STORE_GATE_ENFORCE=false`.
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
