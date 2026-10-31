import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import {
  EmailChannel,
  MessagingChannels,
  SmsChannel,
  UpdateEmailChannelRequest,
  UpdateSmsChannelRequest,
} from './messaging-channels.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/** SMS and email settings under Integraciones → Canales. */
@Injectable({ providedIn: 'root' })
export class MessagingChannelsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/integrations/channels`;

  list(): Observable<MessagingChannels> {
    return this.http
      .get<ApiResponse<MessagingChannels>>(this.baseUrl)
      .pipe(map((response) => response.data));
  }

  updateSms(data: UpdateSmsChannelRequest): Observable<SmsChannel> {
    return this.http
      .put<ApiResponse<SmsChannel>>(`${this.baseUrl}/sms`, data)
      .pipe(map((response) => response.data));
  }

  updateEmail(data: UpdateEmailChannelRequest): Observable<EmailChannel> {
    return this.http
      .put<ApiResponse<EmailChannel>>(`${this.baseUrl}/email`, data)
      .pipe(map((response) => response.data));
  }
}
