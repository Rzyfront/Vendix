import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../../../../../../environments/environment';
import {
  OrganizationAccountType,
  OrganizationOperatingScope,
  OrganizationSettings,
} from '../../../../../../core/models/organization.model';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface OrganizationOperationsConfig {
  organization: {
    id: number;
    name: string;
    account_type: OrganizationAccountType;
    operating_scope: OrganizationOperatingScope;
    stores_count: number;
  };
  settings: Partial<OrganizationSettings>;
}

export interface OperatingScopeUpdateResult {
  organization?: {
    id: number;
    account_type: OrganizationAccountType;
    operating_scope: OrganizationOperatingScope;
  };
  previous_scope?: OrganizationOperatingScope;
  operating_scope: OrganizationOperatingScope;
  changed: boolean;
}

@Injectable({ providedIn: 'root' })
export class OrganizationOperationsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/organization/organizations`;

  getConfig(): Observable<OrganizationOperationsConfig> {
    return this.http
      .get<ApiResponse<OrganizationOperationsConfig>>(`${this.baseUrl}/config`)
      .pipe(map((response) => response.data));
  }

  updateOperatingScope(
    operating_scope: OrganizationOperatingScope,
  ): Observable<OperatingScopeUpdateResult> {
    return this.http
      .patch<
        ApiResponse<OperatingScopeUpdateResult>
      >(`${this.baseUrl}/operating-scope`, { operating_scope })
      .pipe(map((response) => response.data));
  }
}
