import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  Vehicle,
  VehicleListQuery,
  VehicleListResponse,
  CreateVehicleDto,
  UpdateVehicleDto,
} from '../interfaces/vehicle.interface';

@Injectable({
  providedIn: 'root',
})
export class FleetService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  list(query: VehicleListQuery = {}): Observable<VehicleListResponse> {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, value.toString());
      }
    });
    const url = `${this.apiUrl}/store/vehicles?${params.toString()}`;
    return this.http.get<any>(url).pipe(
      map((r) => r.data || r),
      catchError((error) =>
        throwError(() => new Error(this.extractErrorMessage(error))),
      ),
    );
  }

  getById(id: number): Observable<Vehicle> {
    const url = `${this.apiUrl}/store/vehicles/${id}`;
    return this.http.get<any>(url).pipe(
      map((r) => r.data || r),
      catchError((error) =>
        throwError(() => new Error(this.extractErrorMessage(error))),
      ),
    );
  }

  create(dto: CreateVehicleDto): Observable<Vehicle> {
    const url = `${this.apiUrl}/store/vehicles`;
    return this.http.post<any>(url, dto).pipe(
      map((r) => r.data || r),
      catchError((error) =>
        throwError(() => new Error(this.extractErrorMessage(error))),
      ),
    );
  }

  update(id: number, dto: UpdateVehicleDto): Observable<Vehicle> {
    const url = `${this.apiUrl}/store/vehicles/${id}`;
    return this.http.patch<any>(url, dto).pipe(
      map((r) => r.data || r),
      catchError((error) =>
        throwError(() => new Error(this.extractErrorMessage(error))),
      ),
    );
  }

  delete(id: number): Observable<void> {
    const url = `${this.apiUrl}/store/vehicles/${id}`;
    return this.http.delete<any>(url).pipe(
      map(() => undefined),
      catchError((error) =>
        throwError(() => new Error(this.extractErrorMessage(error))),
      ),
    );
  }

  private extractErrorMessage(error: any): string {
    return error?.error?.message || error?.message || 'Error desconocido';
  }
}
