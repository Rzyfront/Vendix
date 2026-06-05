import { Injectable } from '@angular/core';

/**
 * Bridges the FiscalCoreShell's sticky-header action buttons to the
 * concrete `FiscalOperationsComponent` instance currently mounted via
 * the router-outlet.
 *
 * Why this exists: the new shell is the parent of all 7 fiscal tabs and
 * owns the sticky header (refresh + generate-month). The tab content
 * (`FiscalOperationsComponent`) keeps the actual data-loading methods
 * (`reloadCurrentTab`, `generateCurrentMonthObligations`) and the
 * loading/working state. Direct DI between parent and child is awkward
 * when the child is loaded through a router-outlet, so we use a tiny
 * service-as-event-bus pattern: the component registers its handlers
 * on construction, the shell calls them by action id.
 */
@Injectable({ providedIn: 'root' })
export class FiscalOperationsHeaderActionsService {
  private handlers = new Map<string, () => void>();

  register(actionId: string, handler: () => void): void {
    if (typeof handler === 'function') {
      this.handlers.set(actionId, handler);
    }
  }

  unregister(actionId: string): void {
    this.handlers.delete(actionId);
  }

  trigger(actionId: string): boolean {
    const handler = this.handlers.get(actionId);
    if (!handler) return false;
    try {
      handler();
      return true;
    } catch {
      return false;
    }
  }

  has(actionId: string): boolean {
    return this.handlers.has(actionId);
  }
}
