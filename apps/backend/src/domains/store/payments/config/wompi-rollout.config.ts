/**
 * Wompi recurrent-charges rollout flag.
 *
 * Controls the migration ramp from the legacy inline-token charge path
 * (single-use Wompi tokens stored as `provider_token` on
 * `subscription_payment_methods`) to the new COF / `payment_source_id` +
 * `recurrent: true` flow introduced in Wompi Phases 1-6.
 *
 * Rollout pattern mirrors `subscription-gate.config.ts` (`STORE_GATE_ENFORCE`):
 * default is **log-only** so legacy PMs keep working with a structured
 * `WOMPI_LEGACY_TOKEN_USED` warning, and **enforce** is opt-in via the
 * env flag — flipping it forces re-tokenization for any PM that has not
 * been migrated to a payment_source yet.
 *
 * The flag is intentionally global (kill-switch), not per-store. We read
 * `process.env` on every call so the value can be flipped at runtime
 * without redeploying (e.g. via the EC2 maintenance flow). For perf-
 * sensitive call sites the read is O(1) and uncontended.
 */

export type WompiRolloutMode = 'log_only' | 'enforce';

/**
 * Returns `true` when `WOMPI_RECURRENT_ENFORCE === 'true'`.
 *
 * In enforce mode, payment methods without `provider_payment_source_id`
 * are rejected with `PAYMENT_METHOD_NOT_MIGRATED` — forcing the user to
 * re-tokenize through the Wompi widget before the next charge.
 */
export function isWompiRecurrentEnforced(): boolean {
  return process.env.WOMPI_RECURRENT_ENFORCE === 'true';
}

/**
 * Inverse of {@link isWompiRecurrentEnforced}. Used by `chargeInvoice`
 * to decide whether to tolerate the legacy inline-token flow. In log-only
 * mode legacy PMs keep working but the charge path emits a structured
 * `WOMPI_LEGACY_TOKEN_USED` warning so ops can monitor migration progress.
 */
export function isLegacyInlineTokenAllowed(): boolean {
  return !isWompiRecurrentEnforced();
}

/**
 * Convenience accessor for telemetry / dashboards. Returns the canonical
 * mode label so log lines and metrics can tag charges consistently.
 */
export function getWompiRolloutMode(): WompiRolloutMode {
  return isWompiRecurrentEnforced() ? 'enforce' : 'log_only';
}
