import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

export interface SettingsSyncErrorItem {
  storeId: number;
  message: string;
}

export interface SettingsSyncResult {
  totalScanned: number;
  totalMigrated: number;
  errors: SettingsSyncErrorItem[];
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class SuperAdminSettingsSyncService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/superadmin/settings`;

  syncAllStores(): Observable<ApiResponse<SettingsSyncResult>> {
    return this.http.post<ApiResponse<SettingsSyncResult>>(
      `${this.apiUrl}/sync-all-stores`,
      {},
    );
  }
}
