import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { StoreAppsResponse } from '../interfaces/store-app.interface';

/**
 * Read-only client of the Apps catalog (`GET /store/apps`, permission
 * `store:apps:read`). Activation endpoints arrive in a later phase.
 */
@Injectable({ providedIn: 'root' })
export class StoreAppsService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/store/apps`;

  list(): Observable<StoreAppsResponse> {
    return this.http.get<StoreAppsResponse>(this.apiUrl);
  }
}
