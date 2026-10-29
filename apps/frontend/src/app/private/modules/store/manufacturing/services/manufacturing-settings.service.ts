import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import { ManufacturingSettings } from '../interfaces';
import { ApiResponse, handleManufacturingError } from './manufacturing-api.util';

/** Configuración de planta (`/store/manufacturing/settings`). */
@Injectable({ providedIn: 'root' })
export class ManufacturingSettingsService {
  private readonly apiUrl = environment.apiUrl;
  private readonly basePath = '/store/manufacturing/settings';
  private readonly http = inject(HttpClient);

  get(): Observable<ManufacturingSettings> {
    return this.http
      .get<ApiResponse<ManufacturingSettings>>(`${this.apiUrl}${this.basePath}`)
      .pipe(
        map((res) => res.data),
        catchError((e) => handleManufacturingError(e)),
      );
  }

  update(dto: Partial<ManufacturingSettings>): Observable<ManufacturingSettings> {
    return this.http
      .patch<ApiResponse<ManufacturingSettings>>(`${this.apiUrl}${this.basePath}`, dto)
      .pipe(
        map((res) => res.data),
        catchError((e) => handleManufacturingError(e)),
      );
  }
}
