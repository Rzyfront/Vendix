import {
  DestroyRef,
  Injectable,
  InjectionToken,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ActiveTenantContextService } from '../../../../../core/services/active-tenant-context.service';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import { SuperadminTenantApiService } from '../services/superadmin-tenant-api.service';
import {
  TENANT_SCOPE_LIST_ROUTE,
  type TenantCapabilities,
  type TenantDianConfig,
  type TenantProfile,
  type TenantResolution,
  type TenantScopeSegment,
  type TenantSubscription,
} from '../interfaces/tenant-profile.interface';

/**
 * Configuración estática de la rama de ruta que monta el perfil.
 *
 * Se provee junto al store para que el guard sepa qué parámetro leer y a qué
 * directorio volver, sin que ninguna de las dos piezas tenga que adivinar en
 * qué árbol está montada.
 */
export interface TenantProfileScopeConfig {
  readonly scope: TenantScopeSegment;
  /** Nombre del parámetro de ruta que porta el id (`storeId`, `organizationId`). */
  readonly idParam: string;
  /** Directorio al que se vuelve al salir. */
  readonly exitRoute: string;
}

export const TENANT_PROFILE_SCOPE =
  new InjectionToken<TenantProfileScopeConfig>('TENANT_PROFILE_SCOPE');

export function createTenantProfileScopeConfig(
  scope: TenantScopeSegment,
  idParam: string,
): TenantProfileScopeConfig {
  return { scope, idParam, exitRoute: TENANT_SCOPE_LIST_ROUTE[scope] };
}

/**
 * Estado del perfil de tenant abierto.
 *
 * **Ámbito: ruta, nunca raíz.** Se provee en `tenant-profile.routes.ts`, de modo
 * que el POS, los ajustes de tienda y el resto del panel no puedan inyectarlo.
 *
 * **Y aun así se resetea en cada siembra.** El router de Angular cachea el
 * `EnvironmentInjector` de una ruta en `routeConfig._injector` y NO lo destruye
 * al desactivarla (`getOrCreateRouteInjectorIfNeeded`, router2.mjs): esta
 * instancia sobrevive a la navegación. Confiar en que "los providers de ruta
 * mueren" dejaría el perfil del tenant anterior en pantalla mientras carga el
 * siguiente — justo el fallo que esta pantalla no se puede permitir. Por eso
 * `seed()` limpia ANTES de pedir, y cada petición lleva un token de secuencia
 * que descarta las respuestas rezagadas del tenant previo.
 */
@Injectable()
export class TenantContextStore {
  private readonly api = inject(SuperadminTenantApiService);
  private readonly activeTenant = inject(ActiveTenantContextService);
  private readonly config = inject(TENANT_PROFILE_SCOPE);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _tenantId = signal<number | null>(null);
  private readonly _profile = signal<TenantProfile | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  /** Descarta respuestas de un tenant que ya no está en pantalla. */
  private requestToken = 0;

  readonly scope: TenantScopeSegment = this.config.scope;
  readonly exitRoute: string = this.config.exitRoute;

  readonly tenantId = this._tenantId.asReadonly();
  readonly profile = this._profile.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly isOrganization = computed(() => this.scope === 'organizations');

  /** Nombre del tenant; cae al id mientras el perfil no ha llegado. */
  readonly tenantName = computed<string>(() => {
    const header = this._profile()?.header;
    if (header) {
      return this.scope === 'stores'
        ? (header.store_name ?? header.organization_name)
        : header.organization_name;
    }
    return this.placeholderLabel(this._tenantId());
  });

  readonly organizationName = computed<string | null>(() => {
    const header = this._profile()?.header;
    if (!header) return null;
    return this.scope === 'stores' ? header.organization_name : null;
  });

  readonly dianConfigs = computed<readonly TenantDianConfig[]>(
    () => this._profile()?.dian_configs ?? [],
  );
  readonly resolutions = computed<readonly TenantResolution[]>(
    () => this._profile()?.resolutions ?? [],
  );
  readonly subscription = computed<TenantSubscription | null>(
    () => this._profile()?.subscription ?? null,
  );
  readonly capabilities = computed<TenantCapabilities | null>(
    () => this._profile()?.capabilities ?? null,
  );

  /**
   * Qué puede escribir el super admin sobre este tenant.
   *
   * Devuelve `false` cuando la clave falta: ofrecer un botón de escritura
   * porque el backend no dijo nada es peor que no ofrecerlo.
   */
  can(capability: string): boolean {
    return this.capabilities()?.[capability] === true;
  }

  /**
   * Punto de entrada del guard. Limpia el tenant anterior, publica el banner
   * con un rótulo provisional y dispara la carga.
   */
  seed(tenantId: number): void {
    if (this._tenantId() === tenantId && this._profile() !== null) {
      // Misma ficha (cambio de pestaña dentro del perfil): no se recarga, pero
      // sí se reafirma el banner por si otra pantalla lo limpió.
      this.publishBanner(tenantId, false);
      return;
    }

    this._tenantId.set(tenantId);
    this._profile.set(null);
    this._error.set(null);
    this.publishBanner(tenantId, true);
    this.load();
  }

  /** Reintento manual desde el estado de error. */
  reload(): void {
    const tenantId = this._tenantId();
    if (tenantId === null) return;
    this._profile.set(null);
    this._error.set(null);
    this.publishBanner(tenantId, true);
    this.load();
  }

  /** El shell lo llama al destruirse: sin ficha abierta no hay banner. */
  release(): void {
    this.requestToken++;
    this.activeTenant.clear();
  }

  private load(): void {
    const tenantId = this._tenantId();
    if (tenantId === null) return;

    const token = ++this.requestToken;
    this._loading.set(true);

    this.api
      .getProfile(this.scope, tenantId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (token !== this.requestToken) return;
          this._loading.set(false);

          const profile = response?.data;
          if (!profile?.header) {
            this._error.set('El perfil del tenant llegó vacío.');
            this.activeTenant.clear();
            return;
          }

          this._profile.set(profile);
          this.activeTenant.resolveLabel(
            this.scope,
            tenantId,
            this.tenantName(),
            this.organizationName(),
          );
        },
        error: (err: unknown) => {
          if (token !== this.requestToken) return;
          this._loading.set(false);
          this._profile.set(null);
          this._error.set(this.describeError(err, tenantId));
          // Sin perfil no hay banner: mostrarlo con un rótulo provisional
          // sugeriría que el super admin está operando sobre algo real.
          this.activeTenant.clear();
        },
      });
  }

  private describeError(err: unknown, tenantId: number): string {
    const status = (err as { status?: number } | null)?.status;
    if (status === 404) {
      return this.scope === 'stores'
        ? `No existe la tienda #${tenantId} o no es accesible desde la consola de tenants.`
        : `No existe la organización #${tenantId} o no es accesible desde la consola de tenants.`;
    }
    if (status === 403) {
      return 'No tienes permiso para consultar la configuración de este tenant.';
    }
    return parseApiError(err).userMessage;
  }

  private publishBanner(tenantId: number, resolving: boolean): void {
    this.activeTenant.set({
      scope: this.scope,
      tenantId,
      label: resolving ? this.placeholderLabel(tenantId) : this.tenantName(),
      organizationName: resolving ? null : this.organizationName(),
      exitRoute: this.exitRoute,
      resolving,
    });
  }

  private placeholderLabel(tenantId: number | null): string {
    const noun = this.scope === 'stores' ? 'Tienda' : 'Organización';
    return tenantId === null ? noun : `${noun} #${tenantId}`;
  }
}
