import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { ConfigState } from './config.reducer';
import * as ConfigSelectors from './config.selectors';
import { AppConfig } from '../../services/app-config.service';

@Injectable({
  providedIn: 'root',
})
export class ConfigFacade {
  private store = inject(Store<ConfigState>);

  // ─── Observables (backward compatible) ────────────────────────────────────

  readonly appConfig$ = this.store.select(ConfigSelectors.selectAppConfig);
  readonly isLoading$ = this.store.select(ConfigSelectors.selectIsLoading);
  readonly error$ = this.store.select(ConfigSelectors.selectError);
  readonly domainConfig$ = this.store.select(
    ConfigSelectors.selectDomainConfig,
  );

  // ─── Signal parallels (Angular 20 — backward compatible) ──────────────────

  readonly appConfig = toSignal(this.appConfig$, { initialValue: null as AppConfig | null });
  readonly isLoading = toSignal(this.isLoading$, { initialValue: false });
  readonly error = toSignal(this.error$, { initialValue: null });
  readonly domainConfig = toSignal(this.domainConfig$, { initialValue: null as import('../../models/domain-config.interface').DomainConfig | null });

  // ─── Synchronous getters — powered by signals (no take(1) antipattern) ────

  getCurrentConfig(): AppConfig | null {
    return this.appConfig() ?? null;
  }
}
