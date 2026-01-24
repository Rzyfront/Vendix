import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ShippingMethod, ShippingZone, ShippingRate } from '../interfaces/shipping.interface';
import { environment } from '../../../../../../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class ShippingService {
    private http = inject(HttpClient);
    private apiUrl = `${environment.apiUrl}/shipping`;

    // --- METHODS ---
    getMethods(): Observable<ShippingMethod[]> {
        return this.http.get<ShippingMethod[]>(`${this.apiUrl}/methods`);
    }

    createMethod(data: Partial<ShippingMethod>): Observable<ShippingMethod> {
        return this.http.post<ShippingMethod>(`${this.apiUrl}/methods`, data);
    }

    updateMethod(id: number, data: Partial<ShippingMethod>): Observable<ShippingMethod> {
        return this.http.put<ShippingMethod>(`${this.apiUrl}/methods/${id}`, data);
    }

    deleteMethod(id: number): Observable<void> {
        return this.http.delete<void>(`${this.apiUrl}/methods/${id}`);
    }

    // --- ZONES ---
    getZones(): Observable<ShippingZone[]> {
        return this.http.get<ShippingZone[]>(`${this.apiUrl}/zones`);
    }

    createZone(data: Partial<ShippingZone>): Observable<ShippingZone> {
        return this.http.post<ShippingZone>(`${this.apiUrl}/zones`, data);
    }

    updateZone(id: number, data: Partial<ShippingZone>): Observable<ShippingZone> {
        return this.http.put<ShippingZone>(`${this.apiUrl}/zones/${id}`, data);
    }

    deleteZone(id: number): Observable<void> {
        return this.http.delete<void>(`${this.apiUrl}/zones/${id}`);
    }

    // --- RATES ---
    getRates(zoneId: number): Observable<ShippingRate[]> {
        return this.http.get<ShippingRate[]>(`${this.apiUrl}/zones/${zoneId}/rates`);
    }

    createRate(data: Partial<ShippingRate>): Observable<ShippingRate> {
        return this.http.post<ShippingRate>(`${this.apiUrl}/rates`, data);
    }

    updateRate(id: number, data: Partial<ShippingRate>): Observable<ShippingRate> {
        return this.http.put<ShippingRate>(`${this.apiUrl}/rates/${id}`, data);
    }

    deleteRate(id: number): Observable<void> {
        return this.http.delete<void>(`${this.apiUrl}/rates/${id}`);
    }
}
