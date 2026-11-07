import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../../../environments/environment';
import { ApiResponse } from '../../../interfaces/workflow.interfaces';

export interface HttpTestBody {
  map: Record<string, string | number>;
  output?: Record<string, string>;
  sample_fields?: Record<string, string>;
}

export type HttpTestErrorKind = 'invalid' | 'secret' | 'blocked' | 'timeout' | 'network';

export type HttpTestResult =
  | {
      ok: true;
      status: number;
      headers: Record<string, string>;
      body: string;
      body_truncated: boolean;
      duration_ms: number;
      output: Record<string, unknown>;
    }
  | { ok: false; error: { kind: HttpTestErrorKind; message: string } };

/** `POST store/workflows/http/test`: makes the REAL request of the action. */
@Injectable({ providedIn: 'root' })
export class HttpActionApiService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/store/workflows/http/test`;

  test(body: HttpTestBody): Observable<HttpTestResult> {
    return this.http.post<ApiResponse<HttpTestResult>>(this.url, body).pipe(map((res) => res.data));
  }
}
