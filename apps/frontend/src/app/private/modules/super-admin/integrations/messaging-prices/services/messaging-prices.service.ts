import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import {
  MessagingPricesView,
  UpdateMessagingPricesDto,
} from '../interfaces/messaging-prices.interface';

interface ApiResponse<T> {
  success?: boolean;
  data: T;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class MessagingPricesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/superadmin/messaging/prices`;

  getPrices(): Observable<MessagingPricesView> {
    return this.http
      .get<ApiResponse<MessagingPricesView>>(this.baseUrl)
      .pipe(map((res) => res.data));
  }

  updatePrices(dto: UpdateMessagingPricesDto): Observable<MessagingPricesView> {
    return this.http
      .patch<ApiResponse<MessagingPricesView>>(this.baseUrl, dto)
      .pipe(map((res) => res.data));
  }
}
