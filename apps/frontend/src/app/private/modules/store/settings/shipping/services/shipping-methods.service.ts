import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, throwError, map } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import {
  SystemShippingMethod,
  StoreShippingMethod,
  ShippingMethodStats,
  EnableShippingMethodDto,
  UpdateStoreShippingMethodDto,
  ReorderShippingMethodsDto,
} from '../interfaces/shipping-methods.interface';
import {
  ShippingZone,
  ShippingRate,
  ZoneStats,
  CreateZoneDto,
  UpdateZoneDto,
  CreateRateDto,
  UpdateRateDto,
  ShippingRateMethod,
  SystemZoneUpdate,
  SyncResult,
} from '../interfaces/shipping-zones.interface';

@Injectable({
  providedIn: 'root',
})
export class ShippingMethodsService {
  private readonly api_base_url = `${environment.apiUrl}/store`;

  constructor(private http: HttpClient) {}

  getStoreShippingMethods(): Observable<StoreShippingMethod[]> {
    return this.http
      .get<any>(`${this.api_base_url}/shipping-methods`)
      .pipe(
        map((response: any) => {
          if (response.success && response.data) {
            return response.data;
          }
          return response;
        }),
        catchError(this.handleError)
      );
  }

  getAvailableShippingMethods(): Observable<SystemShippingMethod[]> {
    return this.http
      .get<any>(`${this.api_base_url}/shipping-methods/available`)
      .pipe(
        map((response: any) => {
          if (response.success && response.data) {
            return response.data;
          }
          return response;
        }),
        catchError(this.handleError)
      );
  }

  getShippingMethod(method_id: number): Observable<StoreShippingMethod> {
    return this.http
      .get<any>(`${this.api_base_url}/shipping-methods/${method_id}`)
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  enableShippingMethod(
    system_method_id: number,
    data: EnableShippingMethodDto
  ): Observable<StoreShippingMethod> {
    return this.http
      .post<any>(
        `${this.api_base_url}/shipping-methods/enable/${system_method_id}`,
        data
      )
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  updateStoreShippingMethod(
    method_id: number,
    data: UpdateStoreShippingMethodDto
  ): Observable<StoreShippingMethod> {
    return this.http
      .patch<any>(`${this.api_base_url}/shipping-methods/${method_id}`, data)
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  disableShippingMethod(method_id: number): Observable<StoreShippingMethod> {
    return this.http
      .patch<any>(
        `${this.api_base_url}/shipping-methods/${method_id}/disable`,
        {}
      )
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  enableStoreShippingMethod(method_id: number): Observable<StoreShippingMethod> {
    return this.http
      .patch<any>(
        `${this.api_base_url}/shipping-methods/${method_id}/enable`,
        {}
      )
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  deleteShippingMethod(method_id: number): Observable<void> {
    return this.http
      .delete<any>(`${this.api_base_url}/shipping-methods/${method_id}`)
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  reorderShippingMethods(
    data: ReorderShippingMethodsDto
  ): Observable<StoreShippingMethod[]> {
    return this.http
      .post<any>(`${this.api_base_url}/shipping-methods/reorder`, data)
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  getShippingMethodStats(): Observable<ShippingMethodStats> {
    return this.http
      .get<any>(`${this.api_base_url}/shipping-methods/stats`)
      .pipe(
        map((response: any) => {
          if (response.success && response.data) {
            return response.data;
          }
          return response;
        }),
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

    console.error('ShippingMethodsService error:', error);
    return throwError(() => new Error(error_message));
  }

  getShippingMethodIcon(type: string): string {
    const icon_map: Record<string, string> = {
      custom: 'package',
      pickup: 'store',
      own_fleet: 'truck',
      carrier: 'send',
      third_party_provider: 'globe',
    };
    return icon_map[type] || 'truck';
  }

  getShippingMethodTypeLabel(type: string): string {
    const label_map: Record<string, string> = {
      custom: 'Personalizado',
      pickup: 'Recogida en tienda',
      own_fleet: 'Flota propia',
      carrier: 'Transportadora',
      third_party_provider: 'Proveedor externo',
    };
    return label_map[type] || type;
  }

  getShippingMethodStateLabel(is_active: boolean): string {
    return is_active ? 'Activo' : 'Inactivo';
  }

  getShippingMethodStateColor(is_active: boolean): string {
    return is_active ? 'success' : 'warning';
  }

  formatDeliveryTime(min_days?: number, max_days?: number): string {
    if (!min_days && !max_days) return '-';
    if (min_days === max_days) return `${min_days} días`;
    if (!max_days) return `${min_days}+ días`;
    return `${min_days}-${max_days} días`;
  }

  // ===== ZONAS DEL SISTEMA (Solo lectura) =====

  getSystemZones(): Observable<ShippingZone[]> {
    return this.http
      .get<any>(`${this.api_base_url}/shipping-zones/system`)
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  getSystemZoneRates(zone_id: number): Observable<ShippingRate[]> {
    return this.http
      .get<any>(`${this.api_base_url}/shipping-zones/system/${zone_id}/rates`)
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  /**
   * Duplicate a system zone to create an editable copy.
   * Creates a new zone with source_type='custom'.
   */
  duplicateSystemZone(zone_id: number): Observable<ShippingZone> {
    return this.http
      .post<any>(`${this.api_base_url}/shipping-zones/system/${zone_id}/duplicate`, {})
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  /**
   * Duplicate a specific system rate to a target store zone.
   */
  duplicateSystemRate(rate_id: number, target_zone_id: number): Observable<ShippingRate> {
    return this.http
      .post<any>(`${this.api_base_url}/shipping-zones/system/rates/${rate_id}/duplicate`, {
        target_zone_id
      })
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  // ===== ZONAS DE TIENDA (CRUD) =====

  getZoneStats(): Observable<ZoneStats> {
    return this.http
      .get<any>(`${this.api_base_url}/shipping-zones/stats`)
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  getStoreZones(): Observable<ShippingZone[]> {
    return this.http
      .get<any>(`${this.api_base_url}/shipping-zones`)
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  createZone(dto: CreateZoneDto): Observable<ShippingZone> {
    return this.http
      .post<any>(`${this.api_base_url}/shipping-zones`, dto)
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  updateZone(id: number, dto: UpdateZoneDto): Observable<ShippingZone> {
    return this.http
      .patch<any>(`${this.api_base_url}/shipping-zones/${id}`, dto)
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  deleteZone(id: number): Observable<void> {
    return this.http
      .delete<any>(`${this.api_base_url}/shipping-zones/${id}`)
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  // ===== SINCRONIZACIÓN CON SISTEMA =====

  /**
   * Get pending updates for a store zone that was copied from system.
   * Only works for zones with source_type='system_copy'.
   */
  getSystemZoneUpdates(zone_id: number): Observable<SystemZoneUpdate[]> {
    return this.http
      .get<any>(`${this.api_base_url}/shipping-zones/${zone_id}/updates`)
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  /**
   * Sync a store zone with its source system zone.
   * Updates the zone and rates with the latest system values.
   */
  syncZoneWithSystem(zone_id: number): Observable<SyncResult> {
    return this.http
      .post<any>(`${this.api_base_url}/shipping-zones/${zone_id}/sync`, {})
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  // ===== TARIFAS DE TIENDA (CRUD) =====

  getStoreZoneRates(zone_id: number): Observable<ShippingRate[]> {
    return this.http
      .get<any>(`${this.api_base_url}/shipping-zones/${zone_id}/rates`)
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  createRate(dto: CreateRateDto): Observable<ShippingRate> {
    return this.http
      .post<any>(`${this.api_base_url}/shipping-zones/rates`, dto)
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  updateRate(id: number, dto: UpdateRateDto): Observable<ShippingRate> {
    return this.http
      .patch<any>(`${this.api_base_url}/shipping-zones/rates/${id}`, dto)
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  deleteRate(id: number): Observable<void> {
    return this.http
      .delete<any>(`${this.api_base_url}/shipping-zones/rates/${id}`)
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  // ===== MÉTODOS DE ENVÍO PARA TARIFAS =====

  getAvailableMethodsForRates(): Observable<ShippingRateMethod[]> {
    return this.http
      .get<any>(`${this.api_base_url}/shipping-zones/shipping-methods`)
      .pipe(
        map((response) => response.data || response),
        catchError(this.handleError)
      );
  }

  // ===== UTILIDADES ZONAS =====

  getZoneRateTypeLabel(type: string): string {
    const label_map: Record<string, string> = {
      flat: 'Tarifa fija',
      weight_based: 'Por peso',
      price_based: 'Por precio',
      carrier_calculated: 'Calculado por transportadora',
      free: 'Envío gratis',
    };
    return label_map[type] || type;
  }

  getZoneRateTypeColor(type: string): string {
    const color_map: Record<string, string> = {
      flat: 'primary',
      weight_based: 'warning',
      price_based: 'info',
      carrier_calculated: 'secondary',
      free: 'success',
    };
    return color_map[type] || 'neutral';
  }

  formatCountries(countries: string[]): string {
    if (!countries || countries.length === 0) return '-';
    if (countries.length === 1) {
      return this.getCountryName(countries[0]);
    }
    return `${this.getCountryName(countries[0])} +${countries.length - 1}`;
  }

  getCountryName(code: string): string {
    const country_map: Record<string, string> = {
      DO: 'República Dominicana',
      US: 'Estados Unidos',
      PR: 'Puerto Rico',
      CO: 'Colombia',
      MX: 'México',
      ES: 'España',
      VE: 'Venezuela',
      PA: 'Panamá',
    };
    return country_map[code] || code;
  }

  getCountryFlag(code: string): string {
    // Convert country code to flag emoji
    const codePoints = code
      .toUpperCase()
      .split('')
      .map((char) => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
  }
}
