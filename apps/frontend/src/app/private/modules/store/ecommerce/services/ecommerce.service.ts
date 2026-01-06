import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, throwError, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  EcommerceSettings,
  SettingsResponse,
  UploadImageResponse,
  UpdateEcommerceSettingsDto,
} from '../interfaces';

@Injectable({ providedIn: 'root' })
export class EcommerceService {
  private readonly apiBaseUrl = `${environment.apiUrl}/store/ecommerce`;

  constructor(private http: HttpClient) {}

  /**
   * Get e-commerce settings
   * Returns response with exists flag to determine mode (setup vs edit)
   */
  getSettings(): Observable<SettingsResponse> {
    return this.http
      .get<any>(`${this.apiBaseUrl}/settings`)
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  /**
   * Get default template (basic or advanced)
   * Used in setup mode to load default configuration
   */
  getTemplate(type: 'basic' | 'advanced' = 'basic'): Observable<EcommerceSettings> {
    return this.http
      .get<any>(`${this.apiBaseUrl}/template/${type}`)
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  /**
   * Upload slider image to S3
   * Returns the uploaded image key and thumbnail key
   */
  uploadSliderImage(file: File): Observable<UploadImageResponse> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http
      .post<any>(`${this.apiBaseUrl}/upload-slider-image`, formData)
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  /**
   * Update e-commerce settings
   * Creates or updates the ecommerce domain configuration
   */
  updateSettings(settings: EcommerceSettings): Observable<EcommerceSettings> {
    const payload: UpdateEcommerceSettingsDto = { ecommerce: settings };
    return this.http
      .patch<any>(`${this.apiBaseUrl}/settings`, payload)
      .pipe(
        map((response) => response.data?.config || response.data || response),
        catchError(this.handleError)
      );
  }

  private handleError(error: any): Observable<never> {
    const message = error.error?.message || error.message || 'Unknown error';
    console.error('EcommerceService error:', error);
    return throwError(() => new Error(message));
  }
}
