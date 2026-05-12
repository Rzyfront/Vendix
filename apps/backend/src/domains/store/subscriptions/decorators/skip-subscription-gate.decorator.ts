import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key consumed by `StoreOperationsGuard` to bypass the subscription
 * gate on a specific handler or controller (e.g. subscription management
 * endpoints, payment-of-subscription, notification reads).
 */
export const SKIP_SUBSCRIPTION_GATE = 'skip_subscription_gate';

/**
 * Marks a controller class or handler as exempt from the global
 * `StoreOperationsGuard`. Use when the endpoint must remain reachable for
 * stores in blocked/suspended states (typical case: managing the subscription
 * itself, or read-only flows that we never want to gate).
 */
export const SkipSubscriptionGate = () =>
  SetMetadata(SKIP_SUBSCRIPTION_GATE, true);
