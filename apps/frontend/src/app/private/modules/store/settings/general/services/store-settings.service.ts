import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import { Store } from '@ngrx/store';
import {
  ApiResponse,
  StoreSettings,
} from '../../../../../../core/models/store-settings.interface';
import * as AuthActions from '../../../../../../core/store/auth/auth.actions';
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
  [key: string]: unknown;
}

export interface StoreFiscalDataRequestOptions {
  scope?: 'store' | 'organization';
  store_id?: number | null;
}

@Injectable({
  providedIn: 'root',
})
export class StoreSettingsService {
  private http = inject(HttpClient);
  private store = inject(Store);
  private currencyFormatService = inject(CurrencyFormatService);
  private readonly api_base_url = `${environment.apiUrl}/store`;

  getSettings(): Observable<ApiResponse<StoreSettings>> {
    return this.http
      .get<ApiResponse<StoreSettings>>(
        `${this.api_base_url}/settings`,
      )
      .pipe(
        map((response) => response || { success: true, data: null }),
        catchError(this.handleError)
      );
  }

  saveSettingsNow(
    settings: Partial<StoreSettings>,
  ): Observable<ApiResponse<StoreSettings>> {
    return this.update_settings_api(settings);
  }

  resetToDefault(): Observable<ApiResponse<StoreSettings>> {
    return this.http
      .post<ApiResponse<StoreSettings>>(
        `${this.api_base_url}/settings/reset`,
        {},
      )
      .pipe(
        map((response) => response || { success: true, data: null }),
        catchError(this.handleError)
      );
  }

  getFiscalData(
    options?: StoreFiscalDataRequestOptions,
  ): Observable<ApiResponse<StoreFiscalData>> {
    return this.http
      .get<ApiResponse<StoreFiscalData> | { fiscal_data?: StoreFiscalData }>(
        this.fiscalDataUrl(options),
      )
      .pipe(
        map((response) => this.mapFiscalDataResponse(response)),
        catchError(this.handleError)
      );
  }

  updateFiscalData(
    dto: Partial<StoreFiscalData>,
    options?: StoreFiscalDataRequestOptions,
  ): Observable<ApiResponse<StoreFiscalData>> {
    return this.http
      .patch<ApiResponse<StoreFiscalData> | { fiscal_data?: StoreFiscalData }>(
        this.fiscalDataUrl(options),
        dto,
      )
      .pipe(
        map((response) => this.mapFiscalDataResponse(response)),
        catchError(this.handleError)
      );
  }

  getSystemTemplates(): Observable<ApiResponse<any[]>> {
    return this.http
      .get<ApiResponse<any[]>>(
        `${this.api_base_url}/settings/templates`,
      )
      .pipe(
        map((response) => response || { success: true, data: [] }),
        catchError(this.handleError)
      );
  }

  applyTemplate(template_name: string): Observable<ApiResponse<StoreSettings>> {
    return this.http
      .post<ApiResponse<StoreSettings>>(
        `${this.api_base_url}/settings/apply-template`,
        { template_name },
      )
      .pipe(
        map((response) => response || { success: true, data: null }),
        catchError(this.handleError)
      );
  }

  uploadStoreLogo(file: File): Observable<{ key: string; url: string; thumbKey?: string; thumbUrl?: string }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('entityType', 'store_logos');

    return this.http
      .post<any>(`${environment.apiUrl}/upload`, formData)
      .pipe(
        map((response) => response.data ?? response),
        catchError(this.handleError)
      );
  }

  uploadStoreFavicon(file: File): Observable<{ key: string; url: string }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('entityType', 'store_favicons');

    return this.http
      .post<any>(`${environment.apiUrl}/upload`, formData)
      .pipe(
        map((response) => response.data ?? response),
        catchError(this.handleError)
      );
  }

  /**
   * Obtiene el estado de validación del horario del POS
   * Incluye información sobre si el usuario es admin
   */
  getScheduleStatus(): Observable<ApiResponse<{
    isWithinBusinessHours: boolean;
    currentDay: string;
    currentTime: string;
    openTime?: string;
    closeTime?: string;
    nextOpenTime?: string;
    message?: string;
    isAdmin: boolean;
    canBypass: boolean;
  }>> {
    return this.http
      .get<ApiResponse<any>>(`${this.api_base_url}/settings/schedule-status`)
      .pipe(
        map((response) => response || { success: true, data: null }),
        catchError(this.handleError)
      );
  }

  private update_settings_api(
    settings: Partial<StoreSettings>,
  ): Observable<ApiResponse<StoreSettings>> {
    return this.http
      .patch<ApiResponse<StoreSettings>>(
        `${this.api_base_url}/settings`,
        settings,
      )
      .pipe(
        tap((response) => {
          const store_settings = response?.data;
          if (!store_settings) return;

          this.store.dispatch(AuthActions.updateStoreSettingsSuccess({ store_settings }));
          if (store_settings.general?.currency) {
            this.currencyFormatService.refresh();
          }
        }),
        map((response) => response || { success: true, data: null }),
        catchError(this.handleError)
      );
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

  private handleError(error: any): Observable<never> {
    let error_message = 'An unknown error occurred';

    if (error.error instanceof ErrorEvent) {
      error_message = error.error.message;
    } else if (error.error && error.error.message) {
      error_message = error.error.message;
    } else if (error.message) {
      error_message = error.message;
    }

    console.error('StoreSettingsService error:', error);
    return throwError(() => new Error(error_message));
  }
}
