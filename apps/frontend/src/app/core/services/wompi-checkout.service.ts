import { Injectable, inject } from '@angular/core';
import { WompiService } from '../../shared/services/wompi.service';

/**
 * SaaS subscription Wompi widget config returned by the backend on
 * `checkout/commit` and `checkout/retry-payment`. Mirrors the shape backend
 * emits via WompiSubscriptionService.
 */
export interface WompiWidgetConfig {
  public_key: string;
  currency: string;
  amount_in_cents: number;
  reference: string;
  signature_integrity: string;
  redirect_url: string;
  customer_email: string;
}

/**
 * Wompi widget transaction result emitted in the widget callback.
 * `status` discriminates the user-facing outcome.
 */
export interface WompiTransaction {
  id?: string;
  status: 'APPROVED' | 'DECLINED' | 'ERROR' | 'PENDING' | string;
  reference?: string;
  amount_in_cents?: number;
  [key: string]: unknown;
}

export interface WompiCheckoutCallbacks {
  onApproved: (transaction: WompiTransaction) => void;
  onDeclined: (transaction: WompiTransaction) => void;
  onPending?: (transaction: WompiTransaction) => void;
  onClosed?: () => void;
  onError?: (err: unknown) => void;
}

/**
 * Centralised handler for opening the Wompi checkout widget across SaaS
 * subscription flows. Encapsulates script loading, widget instantiation and
 * the result-callback branching so every entry point (initial checkout,
 * retry-payment from `my-subscription`, retry from `pricing-card`) routes
 * through a single, consistent code path.
 *
 * Keeping all branches here is what fixes the historic bug where only the
 * APPROVED branch refreshed the subscription state — every callback path
 * delegates back to the caller via the strongly-typed callbacks object.
 */
@Injectable({ providedIn: 'root' })
export class WompiCheckoutService {
  private wompiService = inject(WompiService);

  async openWidget(
    config: WompiWidgetConfig,
    callbacks: WompiCheckoutCallbacks,
  ): Promise<void> {
    try {
      // Defensive guard: a malformed backend response (missing/empty
      // public_key, currency or signature_integrity) would otherwise reach
      // the Wompi SDK and trigger the noisy `merchants/undefined` 422 from
      // `$wompi.initialize` against the production API, masking the real
      // configuration error. Fail fast with a clear error instead.
      if (
        !config ||
        !config.public_key ||
        !config.currency ||
        !config.signature_integrity ||
        !config.reference
      ) {
        // eslint-disable-next-line no-console
        console.error(
          '[WompiCheckoutService] Invalid widget config received from backend',
          { hasPublicKey: !!config?.public_key, hasCurrency: !!config?.currency },
        );
        callbacks.onError?.(
          new Error('Invalid Wompi widget configuration received from backend'),
        );
        return;
      }

      await this.wompiService.loadWidgetScript();

      // Wompi attaches `WidgetCheckout` to `window` once the script loads.
      const checkout = new (window as any).WidgetCheckout({
        currency: config.currency,
        amountInCents: config.amount_in_cents,
        reference: config.reference,
        publicKey: config.public_key,
        signature: { integrity: config.signature_integrity },
        redirectUrl: config.redirect_url,
        customerData: { email: config.customer_email },
      });

      checkout.open((result: unknown) => {
        const transaction = (result as { transaction?: WompiTransaction })
          ?.transaction;

        // Defensive null-check. The Wompi widget can fire its callback with
        // a null/undefined transaction in two scenarios:
        //   (a) the user closed the modal without paying — legitimate cancel;
        //   (b) the widget completed but the SDK swallowed the transaction
        //       payload due to a redirect race. We CANNOT distinguish these
        //       from the SDK alone. Reading `transaction.status` blindly was
        //       the source of the historic
        //       "Cannot read properties of null (reading 'status')" crash.
        //
        // Strategy: route both cases to the pending handler so the caller
        // starts the pull-fallback polling against the backend. The polling
        // hits the backend gateway-sync endpoint and resolves authoritatively
        // (paid / declined / actually pending). If the user really cancelled
        // without paying, the polling will time out cleanly with a toast.
        if (!transaction || typeof transaction !== 'object') {
          if (callbacks.onPending) {
            callbacks.onPending({} as WompiTransaction);
          } else {
            callbacks.onClosed?.();
          }
          return;
        }

        const status = transaction.status;

        if (status === 'APPROVED') {
          callbacks.onApproved(transaction);
          return;
        }

        if (status === 'DECLINED' || status === 'ERROR') {
          callbacks.onDeclined(transaction);
          return;
        }

        // Treat anything else (PENDING, VOIDED, etc.) as pending so the
        // caller can route the user to a "we'll let you know" surface and
        // start polling.
        if (callbacks.onPending) {
          callbacks.onPending(transaction);
        } else {
          // Fallback: if no pending handler, treat as declined to avoid
          // silent gaps.
          callbacks.onDeclined(transaction);
        }
      });
    } catch (err) {
      callbacks.onError?.(err);
    }
  }
}
