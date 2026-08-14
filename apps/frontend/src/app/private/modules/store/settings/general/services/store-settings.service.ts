import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { map, catchError, tap, finalize, shareReplay } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import { Store } from '@ngrx/store';
import {
  ApiResponse,
  StoreSettings,
} from '../../../../../../core/models/store-settings.interface';
import * as AuthActions from '../../../../../../core/store/auth/auth.actions';
import { CurrencyFormatService } from '../../../../../../shared/pipes';
import { StoreScopedCache } from '../../../../../../core/utils/store-scoped-cache';
import { TenantFacade } from '../../../../../../core/store/tenant/tenant.facade';
import { TenantCacheRegistry } from '../../../../../../core/services/tenant-cache-registry.service';

export type StoreFiscalNitType =
  | 'NIT'
  | 'CC'
  | 'CE'
  | 'TI'
  | 'PP'
  | 'NIT_EXTRANJERIA';

export interface StoreFiscalData {
  legal_name?: string | null;
  tax_id?: string | null;
  tax_id_dv?: string | null;
  nit?: string | null;
  nit_dv?: string | null;
  nit_type?: StoreFiscalNitType | null;
  person_type?: 'NATURAL' | 'JURIDICA' | null;
  [key: string]: unknown;
}

export interface StoreFiscalDataRequestOptions {
  scope?: 'store' | 'organization';
  store_id?: number | null;
}

export interface StoreSettingsRequestOptions {
  forceRefresh?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class StoreSettingsService {
  private http = inject(HttpClient);
  private store = inject(Store);
  private currencyFormatService = inject(CurrencyFormatService);
  private tenantFacade = inject(TenantFacade);
  private tenantCacheRegistry = inject(TenantCacheRegistry);
  private readonly api_base_url = `${environment.apiUrl}/store`;
  private readonly settings_cache_ttl_ms = 60 * 1000;
  // QUI-563 Fase 1: cache scoped by active store_id. A TTL-fresh entry
  // from a previous tenant returns null on `get()` — silent miss is the
  // primary defense. Pairs with Fase 2 (TenantCacheRegistry) which evicts
  // it actively on switch.
  private settings_cache = new StoreScopedCache<ApiResponse<StoreSettings>>(
    this.settings_cache_ttl_ms,
  );
  private settings_request$?: Observable<ApiResponse<StoreSettings>>;

  constructor() {
    // QUI-563 Fase 2: register with the bus so the switch service evicts
    // us proactively. Idempotent — re-registering replaces the previous
    // entry, which is desirable for HMR and test re-instantiation.
    this.tenantCacheRegistry.register(
      'store-settings',
      () => this.invalidateCache(),
      'StoreSettingsService',
    );
  }

  /**
   * QUI-563 Fase 1: helper that reads the active store_id from TenantFacade
   * on every call. Centralised so the cache and the request-dedup keys
   * agree on the tenant boundary.
   */
  private get activeStoreId(): number | null {
    return this.tenantFacade.getCurrentStoreId();
  }

  getSettings(
    options: StoreSettingsRequestOptions = {},
  ): Observable<ApiResponse<StoreSettings>> {
    if (!options.forceRefresh) {
      const cached = this.settings_cache.get(this.activeStoreId);
      if (cached) {
        return of(cached);
      }
    }

    if (!options.forceRefresh && this.settings_request$) {
      return this.settings_request$;
    }

    const request$ = this.http
      .get<ApiResponse<StoreSettings>>(`${this.api_base_url}/settings`)
      .pipe(
        map((response) => response || { success: true, data: null }),
        tap((response) => {
          this.cacheSettingsResponse(response);
          this.publishStoreSettings(response);
        }),
        catchError((error) => this.handleSettingsReadError(error)),
        finalize(() => {
          if (this.settings_request$ === request$) {
            this.settings_request$ = undefined;
          }
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );

    this.settings_request$ = request$;
    return request$;
  }

  saveSettingsNow(
    settings: Partial<StoreSettings>,
  ): Observable<ApiResponse<StoreSettings>> {
    return this.update_settings_api(settings);
  }

  resetToDefault(): Observable<ApiResponse<StoreSettings>> {
    return this.http
      .post<
        ApiResponse<StoreSettings>
      >(`${this.api_base_url}/settings/reset`, {})
      .pipe(
        map((response) => response || { success: true, data: null }),
        tap((response) => {
          this.cacheSettingsResponse(response);
          this.publishStoreSettings(response);
        }),
        catchError(this.handleError),
      );
  }

  getFiscalData(
    options?: StoreFiscalDataRequestOptions,
  ): Observable<ApiResponse<StoreFiscalData>> {
    return this.http
      .get<
        ApiResponse<StoreFiscalData> | { fiscal_data?: StoreFiscalData }
      >(this.fiscalDataUrl(options))
      .pipe(
        map((response) => this.mapFiscalDataResponse(response)),
        catchError(this.handleError),
      );
  }

  updateFiscalData(
    dto: Partial<StoreFiscalData>,
    options?: StoreFiscalDataRequestOptions,
  ): Observable<ApiResponse<StoreFiscalData>> {
    return this.http
      .patch<
        ApiResponse<StoreFiscalData> | { fiscal_data?: StoreFiscalData }
      >(this.fiscalDataUrl(options), dto)
      .pipe(
        map((response) => this.mapFiscalDataResponse(response)),
        catchError(this.handleError),
      );
  }

  getSystemTemplates(): Observable<ApiResponse<any[]>> {
    return this.http
      .get<ApiResponse<any[]>>(`${this.api_base_url}/settings/templates`)
      .pipe(
        map((response) => response || { success: true, data: [] }),
        catchError(this.handleError),
      );
  }

  applyTemplate(template_name: string): Observable<ApiResponse<StoreSettings>> {
    return this.http
      .post<
        ApiResponse<StoreSettings>
      >(`${this.api_base_url}/settings/apply-template`, { template_name })
      .pipe(
        map((response) => response || { success: true, data: null }),
        tap((response) => {
          this.cacheSettingsResponse(response);
          this.publishStoreSettings(response);
        }),
        catchError(this.handleError),
      );
  }

  uploadStoreLogo(
    file: File,
  ): Observable<{
    key: string;
    url: string;
    thumbKey?: string;
    thumbUrl?: string;
  }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('entityType', 'store_logos');

    return this.http.post<any>(`${environment.apiUrl}/upload`, formData).pipe(
      map((response) => response.data ?? response),
      catchError(this.handleError),
    );
  }

  uploadStoreFavicon(file: File): Observable<{ key: string; url: string }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('entityType', 'store_favicons');

    return this.http.post<any>(`${environment.apiUrl}/upload`, formData).pipe(
      map((response) => response.data ?? response),
      catchError(this.handleError),
    );
  }

  /**
   * Obtiene el estado de validación del horario del POS
   * Incluye información sobre si el usuario es admin
   */
  getScheduleStatus(): Observable<
    ApiResponse<{
      isWithinBusinessHours: boolean;
      currentDay: string;
      currentTime: string;
      openTime?: string;
      closeTime?: string;
      nextOpenTime?: string;
      message?: string;
      isAdmin: boolean;
      canBypass: boolean;
    }>
  > {
    return this.http
      .get<ApiResponse<any>>(`${this.api_base_url}/settings/schedule-status`)
      .pipe(
        map((response) => response || { success: true, data: null }),
        catchError(this.handleError),
      );
  }

  private update_settings_api(
    settings: Partial<StoreSettings>,
  ): Observable<ApiResponse<StoreSettings>> {
    return this.http
      .patch<
        ApiResponse<StoreSettings>
      >(`${this.api_base_url}/settings`, settings)
      .pipe(
        map((response) => response || { success: true, data: null }),
        tap((response) => {
          this.cacheSettingsResponse(response);

          const store_settings = response?.data;
          if (!store_settings) return;

          this.store.dispatch(
            AuthActions.updateStoreSettingsSuccess({ store_settings }),
          );
          this.syncCurrencyFromSettings(store_settings);
        }),
        catchError(this.handleError),
      );
  }

  private cacheSettingsResponse(response: ApiResponse<StoreSettings>): void {
    this.settings_cache.set(this.activeStoreId, response);
  }

  /**
   * QUI-563 Fase 1/2: drops the in-memory entry. Called by the
   * TenantCacheRegistry on environment switch (active eviction) and by
   * the few existing manual callers that used to clear the previous
   * cache vars.
   */
  invalidateCache(): void {
    this.settings_cache.clear();
  }

  private publishStoreSettings(response: ApiResponse<StoreSettings>): void {
    const store_settings = response?.data;
    if (!store_settings) return;

    this.store.dispatch(AuthActions.updateStoreSettings({ store_settings }));
    this.syncCurrencyFromSettings(store_settings);
  }

  private syncCurrencyFromSettings(store_settings: StoreSettings): void {
    const currencyCode = store_settings.general?.currency;
    if (!currencyCode) return;

    void this.currencyFormatService.loadCurrencyForCode(currencyCode);
  }

  private handleSettingsReadError(
    error: any,
  ): Observable<ApiResponse<StoreSettings>> {
    // QUI-563 Fase 4: only fall back to cache when the cached entry belongs
    // to the SAME tenant that just failed. Cross-tenant fallback was the
    // second window of the bug: even after Fase 0/1/2 closed the happy
    // path, a 403 on store B would still surface store A's settings.
    const cached = this.settings_cache.get(this.activeStoreId);
    if (cached) {
      console.warn(
        'StoreSettingsService: using cached settings after read error',
        error,
      );
      return of(cached);
    }

    return this.handleError(error);
  }

  private fiscalDataUrl(options?: StoreFiscalDataRequestOptions): string {
    const scope = options?.scope ?? 'store';
    const baseUrl =
      scope === 'organization'
        ? `${environment.apiUrl}/organization`
        : this.api_base_url;
    const storeId = options?.store_id;
    const query =
      scope === 'organization' && storeId != null ? `?store_id=${storeId}` : '';

    return `${baseUrl}/settings/fiscal-data${query}`;
  }

  private mapFiscalDataResponse(
    response: ApiResponse<StoreFiscalData> | { fiscal_data?: StoreFiscalData },
  ): ApiResponse<StoreFiscalData> {
    const payload = (response as any)?.data ?? response;
    const fiscalData =
      payload?.fiscal_data ?? payload?.settings?.fiscal_data ?? payload ?? {};

    return {
      success: (response as any)?.success ?? true,
      message: (response as any)?.message,
      data: fiscalData as StoreFiscalData,
    };
  }

  /**
   * QUI-560: re-lanza el error CRUDO.
   *
   * Antes aplanaba el `HttpErrorResponse` a `new Error(message)`. Eso descartaba
   * el cuerpo JSON del backend, así que `parseApiError` — que hace
   * `body = error?.error ?? error` y lee `body.error_code` — recibía un Error
   * pelado y devolvía SIEMPRE `DEFAULT_ERROR_MESSAGE`: el backend respondía
   * `409 CASH_REGISTER_DISABLE_001`, la copy existía en `error-messages.ts`, y
   * el usuario igual veía "ocurrió un error inesperado".
   *
   * Los consumidores NO deben leer `.message` de este error: es el devMessage
   * del backend (o, con el error crudo, el texto técnico de Angular), y el
   * contrato de `error-messages.ts` es que eso nunca se muestra al usuario.
   * Para texto de UI, usar `parseApiError(error).userMessage`.
   */
  private handleError(error: any): Observable<never> {
    console.error('StoreSettingsService error:', error);
    return throwError(() => error);
  }
}
