import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  PartnerPlanOverride,
  CreatePlanOverrideDto,
  UpdatePlanOverrideDto,
  ApiResponse,
} from '../interfaces/org-subscription.interface';

@Injectable({ providedIn: 'root' })
export class PartnerMarginsService {
  private http = inject(HttpClient);

  private getApiUrl(endpoint: string): string {
    return `${environment.apiUrl}/organization/reseller/plans${endpoint ? '/' + endpoint : ''}`;
  }

  getPlanOverrides(): Observable<ApiResponse<PartnerPlanOverride[]>> {
    return this.http.get<ApiResponse<PartnerPlanOverride[]>>(this.getApiUrl(''));
  }

  createPlanOverride(dto: CreatePlanOverrideDto): Observable<ApiResponse<PartnerPlanOverride>> {
    return this.http.post<ApiResponse<PartnerPlanOverride>>(this.getApiUrl(''), dto);
  }

  updatePlanOverride(id: string, dto: UpdatePlanOverrideDto): Observable<ApiResponse<PartnerPlanOverride>> {
    return this.http.put<ApiResponse<PartnerPlanOverride>>(this.getApiUrl(id), dto);
  }

  deletePlanOverride(id: string): Observable<ApiResponse<null>> {
    return this.http.delete<ApiResponse<null>>(this.getApiUrl(id));
  }
}
