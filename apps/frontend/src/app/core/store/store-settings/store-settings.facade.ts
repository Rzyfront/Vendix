import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';

import { selectStoreSettings } from '../auth/auth.selectors';
import {
  StoreSettings,
  PosSettings,
  NotificationsSettings,
} from '../../models/store-settings.interface';

/**
 * Runtime-reactive view of the active store's settings.
 *
 * Single subscription to `selectStoreSettings` is bridged to a signal here so
 * components can read derived slices via `computed()` without each one piping
 * its own observable. NgRx remains the source of truth; this facade only
 * provides ergonomic, zoneless-friendly access.
 *
 * The shape stored in NgRx is the JSON returned by the settings endpoint, which
 * may include keys not yet typed in `StoreSettings` (e.g. `branding`,
 * `publication`, `ecommerce`, `module_flows`). We accept that and expose them
 * as loose `Record<string, any>` slices.
 */
type ExtendedStoreSettings = StoreSettings & {
  branding?: Record<string, any> | null;
  publication?: Record<string, any> | null;
  ecommerce?: Record<string, any> | null;
  module_flows?: Record<string, any> | null;
};

@Injectable({ providedIn: 'root' })
export class StoreSettingsFacade {
  private store = inject(Store);

  readonly settings = toSignal<ExtendedStoreSettings | null>(
    this.store.select(selectStoreSettings) as any,
    { initialValue: null },
  );

  readonly pos = computed<PosSettings | null>(
    () => this.settings()?.pos ?? null,
  );

  readonly branding = computed<Record<string, any> | null>(
    () => this.settings()?.branding ?? null,
  );

  readonly publication = computed<Record<string, any> | null>(
    () => this.settings()?.publication ?? null,
  );

  readonly ecommerce = computed<Record<string, any> | null>(
    () => this.settings()?.ecommerce ?? null,
  );

  readonly notifications = computed<NotificationsSettings | null>(
    () => this.settings()?.notifications ?? null,
  );

  readonly modules = computed<Record<string, any> | null>(
    () => this.settings()?.module_flows ?? null,
  );
}
