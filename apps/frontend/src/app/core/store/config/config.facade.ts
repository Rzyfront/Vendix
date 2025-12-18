import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { take } from 'rxjs/operators';
import { ConfigState } from './config.reducer';
import * as ConfigSelectors from './config.selectors';
import { AppConfig } from '../../services/app-config.service';

@Injectable({
  providedIn: 'root',
})
export class ConfigFacade {
  private store = inject(Store<ConfigState>);

  readonly appConfig$ = this.store.select(ConfigSelectors.selectAppConfig);
  readonly isLoading$ = this.store.select(ConfigSelectors.selectIsLoading);
  readonly error$ = this.store.select(ConfigSelectors.selectError);
  readonly domainConfig$ = this.store.select(
    ConfigSelectors.selectDomainConfig,
  );

  getCurrentConfig(): AppConfig | null {
    let config: AppConfig | null = null;
    this.appConfig$.pipe(take(1)).subscribe((c) => (config = c));
    return config;
  }
}
