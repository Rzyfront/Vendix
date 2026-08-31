import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  CrmLandingDocument,
} from '../blocks/landing-blocks.types';

export interface CrmPublicLandingResponse {
  success: boolean;
  message?: string;
  data: {
    document: CrmLandingDocument | null;
    ecommerce_base_url: string | null;
  };
}

export interface CrmContactPayload {
  first_name: string;
  last_name?: string;
  email?: string;
  phone?: string;
  message: string;
}

export interface CrmContactResponse {
  success: boolean;
  message?: string;
  data: { customer_created: boolean; customer_id: number | null };
}

/**
 * HTTP público de la CRM Landing (STORE_LANDING). Sin auth: la tienda la
 * resuelve el backend por hostname del dominio. Base: `/ecommerce/crm`.
 */
@Injectable({ providedIn: 'root' })
export class CrmLandingService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/ecommerce/crm`;

  getLanding(): Observable<CrmPublicLandingResponse> {
    return this.http.get<CrmPublicLandingResponse>(`${this.base}/landing`);
  }

  submitContact(payload: CrmContactPayload): Observable<CrmContactResponse> {
    return this.http.post<CrmContactResponse>(`${this.base}/contact`, payload);
  }
}
