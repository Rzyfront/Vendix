import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, from, map, switchMap, tap } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import {
  WorkflowFieldDef,
  WorkflowFormStepDef,
} from '../../../../shared/workflows/contract/workflow-contract';
import { CaptchaChallenge, CaptchaProof } from './workflow-captcha';
import { ChunkedUploadAdapter } from './workflow-chunked-upload';

export interface PublicFormDefinition {
  available: boolean;
  reason?: string;
  message?: string;
  store: { name: string };
  flow: { name: string; description: string | null };
  privacy_notice: string | null;
  fields: WorkflowFieldDef[];
  /** Presentational pages of the form (the server validates the whole form). */
  steps?: WorkflowFormStepDef[];
  captcha_required?: boolean;
}

export interface PublicFormSubmission {
  submission_id: string;
  values: Record<string, unknown>;
  contact: { name: string; email?: string; phone?: string };
  accept_privacy: true;
  captcha?: CaptchaProof;
}

export interface PublicFormResult {
  reference: string;
  tracking_url: string | null;
}

/** What a captcha link asks before opening an upload: the grant of an earlier one or a fresh proof. */
export interface UploadAccess {
  credentials(): Promise<{ upload_grant?: string; captcha?: CaptchaProof }>;
  remember(grant: string): void;
}

const OCTET_STREAM = new HttpHeaders({ 'Content-Type': 'application/octet-stream' });

/** Anonymous client of `ecommerce/workflows/forms/:token` (store resolved by the domain). */
@Injectable({ providedIn: 'root' })
export class WorkflowPublicFormService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/ecommerce/workflows/forms`;

  private url(token: string, path = ''): string {
    return `${this.base}/${encodeURIComponent(token)}${path}`;
  }

  get(token: string): Observable<PublicFormDefinition> {
    return this.http
      .get<{ data: PublicFormDefinition }>(this.url(token))
      .pipe(map((res) => res.data));
  }

  captcha(token: string): Observable<CaptchaChallenge> {
    return this.http
      .get<{ data: CaptchaChallenge }>(this.url(token, '/captcha'))
      .pipe(map((res) => res.data));
  }

  submit(token: string, body: PublicFormSubmission): Observable<PublicFormResult> {
    return this.http
      .post<{ data: PublicFormResult }>(this.url(token), body)
      .pipe(map((res) => res.data));
  }

  /** Chunked upload of one `file` field of the form. */
  uploader(token: string, fieldKey: string, access?: UploadAccess): ChunkedUploadAdapter {
    return {
      init: (input) =>
        from(access?.credentials() ?? Promise.resolve({})).pipe(
          switchMap((credentials) =>
            this.http.post<{
              data: { upload_id: string; chunk_size: number; total_parts: number; upload_grant?: string };
            }>(this.url(token, '/uploads'), { field_key: fieldKey, ...input, ...credentials }),
          ),
          map((res) => res.data),
          tap((session) => {
            if (session.upload_grant) access?.remember(session.upload_grant);
          }),
        ),
      putPart: (uploadId, n, body) =>
        this.http.put(this.url(token, `/uploads/${encodeURIComponent(uploadId)}/parts/${n}`), body, {
          headers: OCTET_STREAM,
        }),
      complete: (uploadId) =>
        this.http.post(this.url(token, `/uploads/${encodeURIComponent(uploadId)}/complete`), {}),
    };
  }
}
