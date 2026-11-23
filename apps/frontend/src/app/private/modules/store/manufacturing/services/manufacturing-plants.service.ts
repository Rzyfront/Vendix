import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  CreateManufacturingPlantDto,
  ManufacturingPlant,
  ManufacturingPlantManager,
  UpdateManufacturingPlantDto,
} from '../interfaces';
import { ApiResponse, handleManufacturingError } from './manufacturing-api.util';

/** QUI-1013 — production plants (`/store/manufacturing/plants`). */
@Injectable({ providedIn: 'root' })
export class ManufacturingPlantsService {
  private readonly apiUrl = environment.apiUrl;
  private readonly basePath = '/store/manufacturing/plants';
  private readonly http = inject(HttpClient);

  /** Active plants by id (the first one is the main plant); `includeInactive` adds the rest. */
  list(includeInactive = false): Observable<ManufacturingPlant[]> {
    const params = includeInactive
      ? new HttpParams().set('include_inactive', 'true')
      : new HttpParams();
    return this.http
      .get<ApiResponse<ManufacturingPlant[]>>(`${this.apiUrl}${this.basePath}`, { params })
      .pipe(
        map((res) => res.data ?? []),
        catchError((e) => handleManufacturingError(e, 'No se pudieron cargar las plantas')),
      );
  }

  managers(search?: string): Observable<ManufacturingPlantManager[]> {
    let params = new HttpParams().set('limit', '50');
    if (search?.trim()) params = params.set('search', search.trim());
    return this.http
      .get<ApiResponse<ManufacturingPlantManager[]>>(
        `${this.apiUrl}${this.basePath}/managers`,
        { params },
      )
      .pipe(
        map((res) => res.data ?? []),
        catchError((e) => handleManufacturingError(e)),
      );
  }

  create(dto: CreateManufacturingPlantDto): Observable<ManufacturingPlant> {
    return this.http
      .post<ApiResponse<ManufacturingPlant>>(`${this.apiUrl}${this.basePath}`, dto)
      .pipe(
        map((res) => res.data),
        catchError((e) => handleManufacturingError(e, 'No se pudo crear la planta')),
      );
  }

  update(id: number, dto: UpdateManufacturingPlantDto): Observable<ManufacturingPlant> {
    return this.http
      .patch<ApiResponse<ManufacturingPlant>>(`${this.apiUrl}${this.basePath}/${id}`, dto)
      .pipe(
        map((res) => res.data),
        catchError((e) => handleManufacturingError(e, 'No se pudo actualizar la planta')),
      );
  }
}
