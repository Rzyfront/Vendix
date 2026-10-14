import type { Observable, Subscription } from 'rxjs';
import type { Invoice } from '../interfaces/invoice.interface';

type FullInvoiceResponse = { data?: Invoice | null } | null | undefined;

export interface InvoiceNoteSourceLoadCallbacks {
  loading: (isLoading: boolean) => void;
  success: (invoice: Invoice) => void;
  error: (error: unknown) => void;
}

/** Owns the cancellable/stale-safe request that loads a full source invoice. */
export class InvoiceNoteSourceLoader {
  private subscription: Subscription | null = null;
  private callbacks: InvoiceNoteSourceLoadCallbacks | null = null;
  private epoch = 0;

  loadFullSource(
    id: number,
    request: (id: number) => Observable<FullInvoiceResponse>,
    callbacks: InvoiceNoteSourceLoadCallbacks,
  ): void {
    this.cancel();
    const requestEpoch = this.epoch;
    this.callbacks = callbacks;
    callbacks.loading(true);

    let response$: Observable<FullInvoiceResponse>;
    try {
      response$ = request(id);
    } catch (error) {
      this.finishError(requestEpoch, error);
      return;
    }

    let settled = false;
    const subscription = response$.subscribe({
      next: (response) => {
        if (requestEpoch !== this.epoch || settled) return;
        settled = true;
        const currentCallbacks = this.finish(requestEpoch);
        if (!currentCallbacks) return;

        const source = response?.data;
        if (
          !source ||
          source.id !== id ||
          !Array.isArray(source.invoice_items)
        ) {
          currentCallbacks.error(
            'No se pudo cargar la factura completa. Actualiza la lista e inténtalo de nuevo.',
          );
          return;
        }
        currentCallbacks.success(source);
      },
      error: (error: unknown) => {
        if (settled) return;
        settled = true;
        this.finishError(requestEpoch, error);
      },
      complete: () => {
        if (settled || requestEpoch !== this.epoch) return;
        settled = true;
        this.finishError(
          requestEpoch,
          'No se pudo cargar la factura completa. Actualiza la lista e inténtalo de nuevo.',
        );
      },
    });

    if (requestEpoch === this.epoch && !settled && !subscription.closed) {
      this.subscription = subscription;
    } else {
      subscription.unsubscribe();
    }
  }

  cancel(): void {
    this.epoch += 1;
    this.subscription?.unsubscribe();
    this.subscription = null;
    const callbacks = this.callbacks;
    this.callbacks = null;
    callbacks?.loading(false);
  }

  private finish(
    requestEpoch: number,
  ): InvoiceNoteSourceLoadCallbacks | null {
    if (requestEpoch !== this.epoch) return null;
    this.subscription?.unsubscribe();
    this.subscription = null;
    const callbacks = this.callbacks;
    this.callbacks = null;
    callbacks?.loading(false);
    return callbacks;
  }

  private finishError(requestEpoch: number, error: unknown): void {
    const callbacks = this.finish(requestEpoch);
    callbacks?.error(error);
  }
}
