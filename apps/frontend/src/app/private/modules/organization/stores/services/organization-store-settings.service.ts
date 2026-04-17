import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { toObservable } from '@angular/core/rxjs-interop';
import { environment } from '../../../../../../environments/environment';
import {
  ApiResponse,
  StoreSettings,
} from '../../../../../core/models/store-settings.interface';

interface UpdateStoreSettingsRequest {
  settings: Partial<StoreSettings>;
}

@Injectable({
  providedIn: 'root',
})
export class OrganizationStoreSettingsService {
  private http = inject(HttpClient);
  private readonly api_base_url = `${environment.apiUrl}/organization/stores`;

  readonly settings = signal<Map<number, StoreSettings>>(new Map());
  readonly settings$ = toObservable(this.settings);

  getStoreSettings(storeId: number): Observable<ApiResponse<StoreSettings>> {
    return this.http
      .get<ApiResponse<StoreSettings>>(
        `${this.api_base_url}/${storeId}/settings`,
      )
      .pipe(
        tap((response: ApiResponse<StoreSettings>) => {
          // Cache the settings
          const currentSettings = this.settings();
          currentSettings.set(storeId, response.data);
          this.settings.set(new Map(currentSettings));
        }),
        map((response) => response || { success: true, data: null }),
        catchError(this.handleError),
      );
  }

  saveSettingsNow(
    storeId: number,
    settings: Partial<StoreSettings>,
  ): Observable<ApiResponse<StoreSettings>> {
    const request: UpdateStoreSettingsRequest = { settings };

    return this.http
      .patch<ApiResponse<StoreSettings>>(
        `${this.api_base_url}/${storeId}/settings`,
        request,
      )
      .pipe(
        tap((response: ApiResponse<StoreSettings>) => {
          // Update cache
          const currentSettings = this.settings();
          currentSettings.set(storeId, response.data);
          this.settings.set(new Map(currentSettings));
        }),
        catchError(this.handleError),
      );
  }

  resetToDefault(
    storeId: number,
  ): Observable<ApiResponse<StoreSettings>> {
    return this.http
      .post<ApiResponse<StoreSettings>>(
        `${this.api_base_url}/${storeId}/settings/reset`,
        {},
      )
      .pipe(
        tap((response: ApiResponse<StoreSettings>) => {
          // Update cache
          const currentSettings = this.settings();
          currentSettings.set(storeId, response.data);
          this.settings.set(new Map(currentSettings));
        }),
        catchError(this.handleError),
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

    console.error('OrganizationStoreSettingsService error:', error);
    return throwError(() => new Error(error_message));
  }
}
