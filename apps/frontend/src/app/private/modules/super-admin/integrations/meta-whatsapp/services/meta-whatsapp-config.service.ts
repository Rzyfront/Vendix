import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import {
  MetaWhatsappConfigView,
  UpdateMetaWhatsappConfigDto,
} from '../interfaces/meta-whatsapp-config.interface';

interface ApiResponse<T> {
  success?: boolean;
  data: T;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class MetaWhatsappConfigService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/superadmin/social-sales/meta/config`;

  getConfig(): Observable<MetaWhatsappConfigView> {
    return this.http
      .get<ApiResponse<MetaWhatsappConfigView>>(this.baseUrl)
      .pipe(map((res) => res.data));
  }

  updateConfig(
    dto: UpdateMetaWhatsappConfigDto,
  ): Observable<MetaWhatsappConfigView> {
    return this.http
      .patch<ApiResponse<MetaWhatsappConfigView>>(this.baseUrl, dto)
      .pipe(map((res) => res.data));
  }

  /** Webhook callback URL Meta must call (derived from the API base URL). */
  webhookUrl(): string {
    return `${environment.apiUrl}/public/meta/whatsapp/webhook`;
  }
}
