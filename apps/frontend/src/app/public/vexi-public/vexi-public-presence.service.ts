import { Injectable, signal } from '@angular/core';

/**
 * Vexi público F2: whether the Vexi bubble is showing on this page. Vexi is
 * dressed as the WhatsApp button, so a page that has its own floating
 * WhatsApp button hides it while this is `true` (never two bubbles).
 */
@Injectable({ providedIn: 'root' })
export class VexiPublicPresenceService {
  private readonly active_ = signal(false);
  readonly active = this.active_.asReadonly();

  setActive(active: boolean): void {
    this.active_.set(active);
  }
}
