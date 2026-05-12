import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  Partner,
  PartnerDetail,
  PartnerStats,
  PaginatedResponse,
  ApiResponse,
  QueryDto,
} from '../interfaces/subscription.interface';

@Injectable({ providedIn: 'root' })
export class PartnersService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/superadmin/subscriptions/partners`;

  getPartners(query?: QueryDto): Observable<PaginatedResponse<Partner>> {
    let params = new HttpParams();
    if (query) {
      if (query.page) params = params.set('page', query.page);
      if (query.limit) params = params.set('limit', query.limit);
      if (query.search) params = params.set('search', query.search);
    }
    return this.http.get<PaginatedResponse<Partner>>(this.apiUrl, { params });
  }

  getPartner(id: number): Observable<ApiResponse<PartnerDetail>> {
    return this.http.get<ApiResponse<PartnerDetail>>(`${this.apiUrl}/${id}`);
  }

  getStats(): Observable<ApiResponse<PartnerStats>> {
    return this.http.get<ApiResponse<PartnerStats>>(`${this.apiUrl}/stats`);
  }
}
