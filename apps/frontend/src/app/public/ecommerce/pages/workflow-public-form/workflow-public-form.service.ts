import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { WorkflowFieldDef } from '../../../../shared/workflows/contract/workflow-contract';

export interface PublicFormDefinition {
  available: boolean;
  reason?: string;
  message?: string;
  store: { name: string };
  flow: { name: string; description: string | null };
  privacy_notice: string | null;
  fields: WorkflowFieldDef[];
}

export interface PublicFormSubmission {
  submission_id: string;
  values: Record<string, unknown>;
  contact: { name: string; email?: string; phone?: string };
  accept_privacy: true;
}

/** Anonymous client of `ecommerce/workflows/forms/:token` (store resolved by the domain). */
@Injectable({ providedIn: 'root' })
export class WorkflowPublicFormService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/ecommerce/workflows/forms`;

  get(token: string): Observable<PublicFormDefinition> {
    return this.http
      .get<{ data: PublicFormDefinition }>(`${this.base}/${encodeURIComponent(token)}`)
      .pipe(map((res) => res.data));
  }

  submit(token: string, body: PublicFormSubmission): Observable<{ reference: string }> {
    return this.http
      .post<{ data: { reference: string } }>(`${this.base}/${encodeURIComponent(token)}`, body)
      .pipe(map((res) => res.data));
  }
}
