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
import { selectAccessToken } from '../../../../../../core/store/auth/auth.selectors';
import { CurrencyFormatService } from '../../../../../../shared/pipes';

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

export interface StoreSettingsSaveOptions {
  /**
   * QUI-563: store the form was loaded under. The backend answers 409
   * `STORE_SETTINGS_STORE_MISMATCH_001` when it differs from the token store,
   * so settings loaded in store A can never overwrite store B.
   */
  expected_store_id?: number | null;
}

/** Settings response tied to the store whose token requested it (QUI-563). */
interface StoreSettingsCacheEntry {
  store_id: number | null;
  response: ApiResponse<StoreSettings>;
  cached_at: number;
}

@Injectable({
  providedIn: 'root',
})
export class StoreSettingsService {
  private http = inject(HttpClient);
  private store = inject(Store);
  private currencyFormatService = inject(CurrencyFormatService);
  private readonly api_base_url = `${environment.apiUrl}/store`;
  private readonly settings_cache_ttl_ms = 60 * 1000;
  private settings_cache: StoreSettingsCacheEntry | null = null;
  private settings_request?: {
    store_id: number | null;
    request$: Observable<ApiResponse<StoreSettings>>;
  };
  private readonly access_token = this.store.selectSignal(selectAccessToken);

  /**
   * QUI-563: the store the backend will scope the next request to, read from
   * the `store_id` claim of the active access token. A store switch replaces
   * the token without reloading the app, so the tenant resolved by domain can
   * still point at the previous store; the token cannot.
   */
  getActiveStoreId(): number | null {
    const payload = this.access_token()?.split('.')[1];
    if (!payload) return null;
    try {
      const claims = JSON.parse(
        atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
      ) as { store_id?: unknown };
      return typeof claims.store_id === 'number' ? claims.store_id : null;
    } catch {
      return null;
    }
  }

  getSettings(
    options: StoreSettingsRequestOptions = {},
  ): Observable<ApiResponse<StoreSettings>> {
    // The service outlives a store switch, so the cache and the in-flight
    // request are only reused for the store they were requested under.
    const store_id = this.getActiveStoreId();
    const cached = this.cachedSettingsFor(store_id);
    if (
      !options.forceRefresh &&
      cached &&
      Date.now() - cached.cached_at < this.settings_cache_ttl_ms
    ) {
      return of(cached.response);
    }

    if (
      !options.forceRefresh &&
      this.settings_request &&
      this.settings_request.store_id === store_id
    ) {
      return this.settings_request.request$;
    }

    const request$ = this.http
      .get<ApiResponse<StoreSettings>>(`${this.api_base_url}/settings`)
      .pipe(
        map((response) => response || { success: true, data: null }),
        tap((response) => {
          this.cacheSettingsResponse(response, store_id);
          this.publishStoreSettings(response, store_id);
        }),
        catchError((error) => this.handleSettingsReadError(error, store_id)),
        finalize(() => {
          if (this.settings_request?.request$ === request$) {
            this.settings_request = undefined;
          }
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );

    this.settings_request = { store_id, request$ };
    return request$;
  }

  saveSettingsNow(
    settings: Partial<StoreSettings>,
    options: StoreSettingsSaveOptions = {},
  ): Observable<ApiResponse<StoreSettings>> {
    const { expected_store_id } = options;
    return this.update_settings_api(
      expected_store_id == null ? settings : { ...settings, expected_store_id },
    );
  }

  resetToDefault(): Observable<ApiResponse<StoreSettings>> {
    const store_id = this.getActiveStoreId();
    return this.http
      .post<
        ApiResponse<StoreSettings>
      >(`${this.api_base_url}/settings/reset`, {})
      .pipe(
        map((response) => response || { success: true, data: null }),
        tap((response) => {
          this.cacheSettingsResponse(response, store_id);
          this.publishStoreSettings(response, store_id);
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
    const store_id = this.getActiveStoreId();
    return this.http
      .post<
        ApiResponse<StoreSettings>
      >(`${this.api_base_url}/settings/apply-template`, { template_name })
      .pipe(
        map((response) => response || { success: true, data: null }),
        tap((response) => {
          this.cacheSettingsResponse(response, store_id);
          this.publishStoreSettings(response, store_id);
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
    settings: Partial<StoreSettings> & StoreSettingsSaveOptions,
  ): Observable<ApiResponse<StoreSettings>> {
    const store_id = this.getActiveStoreId();
    return this.http
      .patch<
        ApiResponse<StoreSettings>
      >(`${this.api_base_url}/settings`, settings)
      .pipe(
        map((response) => response || { success: true, data: null }),
        tap((response) => {
          this.cacheSettingsResponse(response, store_id);

          const store_settings = response?.data;
          if (!store_settings || !this.isActiveStore(store_id)) return;

          this.store.dispatch(
            AuthActions.updateStoreSettingsSuccess({ store_settings }),
          );
          this.syncCurrencyFromSettings(store_settings);
        }),
        catchError(this.handleError),
      );
  }

  private cacheSettingsResponse(
    response: ApiResponse<StoreSettings>,
    store_id: number | null,
  ): void {
    this.settings_cache = { store_id, response, cached_at: Date.now() };
  }

  private cachedSettingsFor(
    store_id: number | null,
  ): StoreSettingsCacheEntry | null {
    return this.settings_cache?.store_id === store_id
      ? this.settings_cache
      : null;
  }

  /**
   * QUI-563: a response that lands after a store switch belongs to the previous
   * store. It stays cached under that store, but must not reach the session
   * (NgRx + persisted auth state) of the store that is active now.
   */
  private isActiveStore(store_id: number | null): boolean {
    return store_id === this.getActiveStoreId();
  }

  private publishStoreSettings(
    response: ApiResponse<StoreSettings>,
    store_id: number | null,
  ): void {
    const store_settings = response?.data;
    if (!store_settings || !this.isActiveStore(store_id)) return;

    this.store.dispatch(AuthActions.updateStoreSettings({ store_settings }));
    this.syncCurrencyFromSettings(store_settings);
  }

  private syncCurrencyFromSettings(store_settings: StoreSettings): void {
    const currencyCode = store_settings.general?.currency;
    if (!currencyCode) return;

    void this.currencyFormatService.loadCurrencyForCode(currencyCode);
  }

  /**
   * QUI-563: the cached fallback is only valid for the store that failed to
   * load. A read error right after switching to store B must surface, never
   * hand back store A's settings as if they were B's.
   */
  private handleSettingsReadError(
    error: unknown,
    store_id: number | null,
  ): Observable<ApiResponse<StoreSettings>> {
    const cached = this.cachedSettingsFor(store_id);
    if (cached) {
      console.warn(
        'StoreSettingsService: using cached settings after read error',
        error,
      );
      return of(cached.response);
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
