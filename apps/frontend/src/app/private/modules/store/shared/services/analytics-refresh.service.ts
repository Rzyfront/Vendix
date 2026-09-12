import { Injectable, signal, Signal } from '@angular/core';

/**
 * AnalyticsRefreshService
 *
 * Provides a reactive notification trigger across all analytics views and shells.
 * When a refresh action is triggered (via sticky header or external event),
 * components listening to `refreshSignal` or calling through the shell will reload.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsRefreshService {
  private readonly _refreshCount = signal<number>(0);
  readonly refreshSignal: Signal<number> = this._refreshCount.asReadonly();

  triggerRefresh(): void {
    this._refreshCount.update((c) => c + 1);
  }
}
