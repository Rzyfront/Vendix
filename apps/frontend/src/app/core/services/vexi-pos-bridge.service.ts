import { Injectable, signal } from '@angular/core';

export interface VexiPosCartLine {
  name: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export interface VexiPosCartSnapshot {
  lines: VexiPosCartLine[];
  subtotal: number;
  total: number;
  customer: string | null;
}

/**
 * Outcome of a POS action Vexi asked for.
 *
 * `needs_user_input` is a first-class result, not a failure: variant choice,
 * weight entry, prepared-vs-stock sourcing and reservations are decisions the
 * product deliberately leaves to a human. Vexi reports them and asks.
 */
export interface VexiPosActionResult {
  status: 'ok' | 'needs_user_input' | 'not_found' | 'error';
  message: string;
  detail?: unknown;
}

/**
 * The live POS screen, as far as Vexi is concerned.
 *
 * Declared as an interface rather than importing `PosComponent` so the command
 * service does not depend on a lazily-loaded module — and so the POS keeps
 * owning its own cart rules.
 */
export interface VexiPosHost {
  vexiAddProductByName(
    query: string,
    quantity: number,
  ): Promise<VexiPosActionResult>;
  vexiRemoveLineByName(query: string): Promise<VexiPosActionResult>;
  vexiSetCustomerByQuery(query: string): Promise<VexiPosActionResult>;
  vexiReadCart(): VexiPosCartSnapshot;
  vexiCheckout(): Promise<VexiPosActionResult>;
}

/**
 * Handle on the POS screen while it is mounted.
 *
 * The POS registers itself on init and clears on destroy, so "is the user in
 * the POS" is answered by whether a host is present rather than by parsing the
 * URL — the two can disagree during a route transition, and adding an item to
 * a screen that is tearing down silently loses it.
 */
@Injectable({ providedIn: 'root' })
export class VexiPosBridgeService {
  private readonly host = signal<VexiPosHost | null>(null);

  readonly isActive = () => this.host() !== null;

  register(host: VexiPosHost): void {
    this.host.set(host);
  }

  unregister(host: VexiPosHost): void {
    // Compared before clearing: on a POS→POS navigation the new instance
    // registers before the old one destroys, and an unconditional clear would
    // drop the handle to the screen that is actually on display.
    if (this.host() === host) this.host.set(null);
  }

  current(): VexiPosHost | null {
    return this.host();
  }
}
