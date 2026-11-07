import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

/** Where the store industries are edited (Configuración → General → Negocio). */
export const INDUSTRY_SETTINGS_ROUTE = '/admin/settings/general/negocio';

/**
 * Industry paywall (flujos-documental S6): opened by the route guard when an
 * always-enforced module (`flows`, `documents`) is closed by the store
 * industries. Unlike the plan paywall it is not throttled per session: the
 * module is simply not available and every attempt explains why.
 */
@Injectable({ providedIn: 'root' })
export class IndustryPaywallService {
  private readonly router = inject(Router);

  /** Key that triggered the paywall, or `null` when closed. */
  readonly key = signal<string | null>(null);
  readonly isOpen = computed(() => this.key() !== null);

  show(key: string): void {
    this.key.set(key);
  }

  close(): void {
    this.key.set(null);
  }

  goToSettings(): void {
    this.close();
    this.router.navigateByUrl(INDUSTRY_SETTINGS_ROUTE);
  }
}
