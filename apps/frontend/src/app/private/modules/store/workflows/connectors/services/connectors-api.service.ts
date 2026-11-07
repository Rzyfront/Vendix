import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import { ApiResponse } from '../../interfaces/workflow.interfaces';
import {
  ConnectorKey,
  ConnectorTestResult,
  ConnectorView,
  WhatsappTestBody,
} from '../interfaces/connectors.interfaces';

/** Typed client of `store/workflows/connectors` (list needs `design`, test needs `manage`). */
@Injectable({ providedIn: 'root' })
export class ConnectorsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/workflows/connectors`;

  list(): Observable<ConnectorView[]> {
    return this.http
      .get<ApiResponse<ConnectorView[]>>(this.base)
      .pipe(map((res) => res.data ?? []));
  }

  test(key: ConnectorKey, body?: WhatsappTestBody): Observable<ConnectorTestResult> {
    return this.http
      .post<ApiResponse<ConnectorTestResult>>(`${this.base}/${key}/test`, body ?? {})
      .pipe(map((res) => res.data));
  }
}
