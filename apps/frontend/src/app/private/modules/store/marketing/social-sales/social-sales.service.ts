import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  ApiResponse,
  CompleteWhatsappEmbeddedSignupRequest,
  MetaReadiness,
  WhatsappChannel,
} from './social-sales.interface';

@Injectable({ providedIn: 'root' })
export class SocialSalesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/social-sales`;

  getMetaReadiness(): Observable<MetaReadiness> {
    return this.http
      .get<ApiResponse<MetaReadiness>>(`${this.baseUrl}/meta/readiness`)
      .pipe(map((response) => response.data));
  }

  getWhatsappChannel(): Observable<WhatsappChannel> {
    return this.http
      .get<ApiResponse<WhatsappChannel>>(`${this.baseUrl}/channels/whatsapp`)
      .pipe(map((response) => response.data));
  }

  completeWhatsappEmbeddedSignup(
    data: CompleteWhatsappEmbeddedSignupRequest,
  ): Observable<WhatsappChannel> {
    return this.http
      .post<
        ApiResponse<WhatsappChannel>
      >(`${this.baseUrl}/channels/whatsapp/embedded-signup/complete`, data)
      .pipe(map((response) => response.data));
  }

  disconnectWhatsapp(): Observable<WhatsappChannel> {
    return this.http
      .post<
        ApiResponse<WhatsappChannel>
      >(`${this.baseUrl}/channels/whatsapp/disconnect`, {})
      .pipe(map((response) => response.data));
  }
}
