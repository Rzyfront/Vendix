import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';

import { selectStoreSettings } from '../auth/auth.selectors';
import {
  StoreSettings,
  PosSettings,
  NotificationsSettings,
  ReceiptsSettings,
  VexiSettings,
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

  /** Print/delivery preferences for receipts, POS tickets and invoices. */
  readonly receipts = computed<ReceiptsSettings | null>(
    () => this.settings()?.receipts ?? null,
  );

  readonly modules = computed<Record<string, any> | null>(
    () => this.settings()?.module_flows ?? null,
  );

  /** Raw Vexi block. `null` when the store never persisted the switch. */
  readonly vexi = computed<VexiSettings | null>(
    () => this.settings()?.vexi ?? null,
  );

  /**
   * Whether this store switched the Vexi assistant on.
   *
   * Absent block means disabled. Vexi acts on the merchant's own data, so it
   * only shows up where an owner or admin turned it on for that store — never
   * because of a default the tenant never saw. Only an explicit `true` mounts
   * the dock.
   *
   * Must apply the same rule as `VexiEnabledGuard` on the backend. If this side
   * is the more permissive of the two, the dock renders against endpoints that
   * refuse it and the assistant reads as broken rather than off.
   */
  readonly vexiEnabled = computed<boolean>(
    () => this.settings()?.vexi?.enabled === true,
  );

  /**
   * Which engine answers a voice turn.
   *
   * Cae a `pipeline`, no a `realtime` ni a null. El llamador es un manejador de
   * gesto: un valor ausente tiene que enrutar a algún lado, y tiene que ser al
   * motor que puede responder. El realtime necesita un proveedor que exponga el
   * Realtime API, y cuando no hay ninguno configurado el gesto terminaba en un
   * 502; el pipeline sólo necesita las apps de transcripción y dictado, que sí
   * están configuradas. Ver el mismo razonamiento en
   * `default-store-settings.ts`.
   *
   * Este fallback tiene que coincidir con el default del backend. Si divergen,
   * una tienda sin valor propio enruta a un motor en el navegador y a otro en el
   * servidor, y el síntoma aparece lejos de la causa.
   *
   * A separate axis from the interface. This decides *what answers*; the panel's
   * own chat ⇄ voice toggle decides *what the person is looking at*.
   */
  readonly vexiVoiceEngine = computed<'realtime' | 'pipeline'>(() =>
    this.settings()?.vexi?.voice_engine === 'realtime' ? 'realtime' : 'pipeline',
  );
}
