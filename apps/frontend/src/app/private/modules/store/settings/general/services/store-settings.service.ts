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
