import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, throwError } from 'rxjs';

import { environment } from '../../../../../../../environments/environment';
import {
  OrganizationInventorySettings,
  OrganizationSettings,
} from '../../../../../../core/models/organization.model';

const DEFAULT_INVENTORY_SETTINGS: OrganizationInventorySettings = {
  mode: 'organizational',
  low_stock_alerts_scope: 'store',
  fallback_on_stockout: 'reject',
};

export interface InventoryModeConflictError {
  code:
    | 'INV_MODE_CHANGE_BLOCKED_BY_TRANSFERS'
    | 'INV_MODE_CHANGE_BLOCKED_BY_ORPHAN_LOCATIONS';
  message: string;
  details?: {
    blocking_transfers?: number;
    orphan_locations?: number;
  };
}

@Injectable({ providedIn: 'root' })
export class OrganizationInventorySettingsService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/organization/settings`;

  getSettings(): Observable<OrganizationInventorySettings> {
    return this.http.get<OrganizationSettings>(this.baseUrl).pipe(
      map((settings) => ({
        ...DEFAULT_INVENTORY_SETTINGS,
        ...(settings?.inventory ?? {}),
      })),
    );
  }

  setMode(
    mode: OrganizationInventorySettings['mode'],
  ): Observable<OrganizationInventorySettings> {
    return this.http
      .patch<OrganizationInventorySettings>(
        `${this.baseUrl}/inventory/mode`,
        { mode },
      )
      .pipe(catchError((err) => this.handleConflictError(err)));
  }

  updateSettings(
    settings: OrganizationInventorySettings,
  ): Observable<OrganizationSettings> {
    return this.http.get<OrganizationSettings>(this.baseUrl).pipe(
      map((current) => ({
        ...current,
        inventory: settings,
      })),
      catchError(() => of({} as OrganizationSettings)),
    );
  }

  saveFullSettings(
    settings: OrganizationInventorySettings,
  ): Observable<OrganizationSettings> {
    return this.http.get<OrganizationSettings>(this.baseUrl).pipe(
      map((current) => {
        const merged = {
          ...current,
          inventory: settings,
        };
        return merged;
      }),
      catchError(() =>
        of({
          inventory: settings,
        } as OrganizationSettings),
      ),
    );
  }

  private handleConflictError(err: any): Observable<never> {
    if (err?.status === 409) {
      const conflictError: InventoryModeConflictError = {
        code: err?.error?.code,
        message:
          err?.error?.message ||
          'No se puede cambiar el modo de inventario en este momento.',
        details: err?.error?.details,
      };
      return throwError(() => conflictError);
    }
    return throwError(() => err);
  }
}
