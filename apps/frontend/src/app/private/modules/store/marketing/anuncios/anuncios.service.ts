import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { ERROR_MESSAGES } from '../../../../../core/utils/error-messages';
import {
  AdCreativeStreamEvent,
  ApiResponse,
  CreateManualMarketingAdCreativeDto,
  CreateMarketingAdCreativeDto,
  MarketingAdEcommerceDomain,
  MarketingAdCreative,
  MarketingAdCreativeSummary,
  SuggestedMarketingAdPrompt,
  SuggestMarketingAdPromptDto,
  UpdateMarketingAdCreativeDetailsDto,
} from './anuncios.interface';

@Injectable({ providedIn: 'root' })
export class AnunciosService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/store/marketing/ad-creatives`;

  getAnuncios(query: Record<string, string | number | undefined> = {}) {
    const params: Record<string, string | number> = {};
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== '') params[key] = value;
    });

    return this.http.get<ApiResponse<MarketingAdCreative[]>>(this.apiUrl, {
      params,
    });
  }

  getSummary(): Observable<ApiResponse<MarketingAdCreativeSummary>> {
    return this.http.get<ApiResponse<MarketingAdCreativeSummary>>(
      `${this.apiUrl}/summary`,
    );
  }

  getEcommerceDomain(): Observable<
    ApiResponse<MarketingAdEcommerceDomain | null>
  > {
    return this.http.get<ApiResponse<MarketingAdEcommerceDomain | null>>(
      `${this.apiUrl}/ecommerce-domain`,
    );
  }

  createAnuncio(dto: CreateMarketingAdCreativeDto) {
    return this.http.post<ApiResponse<MarketingAdCreative>>(this.apiUrl, dto);
  }

  createManualAnuncio(dto: CreateManualMarketingAdCreativeDto) {
    return this.http.post<ApiResponse<MarketingAdCreative>>(
      `${this.apiUrl}/manual`,
      dto,
    );
  }

  suggestPrompt(dto: SuggestMarketingAdPromptDto) {
    return this.http.post<ApiResponse<SuggestedMarketingAdPrompt>>(
      `${this.apiUrl}/suggest-prompt`,
      dto,
    );
  }

  updateAnuncioDetails(id: number, dto: UpdateMarketingAdCreativeDetailsDto) {
    return this.http.patch<ApiResponse<MarketingAdCreative>>(
      `${this.apiUrl}/${id}`,
      dto,
    );
  }

  deleteAnuncio(id: number) {
    return this.http.delete<ApiResponse<null>>(`${this.apiUrl}/${id}`);
  }

  getImageBlob(
    id: number,
    variant: 'full' | 'thumb' = 'full',
  ): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.apiUrl}/${id}/image`, {
      params: { variant },
      responseType: 'blob',
      observe: 'response',
    });
  }

  productImageProxyUrl(imageId: number): string {
    const params = new URLSearchParams();
    const token = this.getAccessToken();
    if (token) params.set('token', token);

    const query = params.toString();
    return `${this.apiUrl}/product-images/${imageId}/proxy${query ? `?${query}` : ''}`;
  }

  streamGenerate(
    id: number,
    correction?: string,
  ): Observable<AdCreativeStreamEvent> {
    return new Observable<AdCreativeStreamEvent>((subscriber) => {
      const params = new URLSearchParams();
      const token = this.getAccessToken();
      if (token) params.set('token', token);
      params.set('request_id', this.createRequestId(id));
      if (correction?.trim()) {
        params.set('correction', correction.trim());
      }

      const eventSource = new EventSource(
        `${this.apiUrl}/${id}/generate-stream?${params.toString()}`,
      );

      eventSource.addEventListener('ai-chunk', (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data) as AdCreativeStreamEvent;
          subscriber.next(this.withMappedStreamError(data));

          if (data.type === 'done' || data.type === 'error') {
            eventSource.close();
            subscriber.complete();
          }
        } catch {
          subscriber.next({
            type: 'error',
            error: 'No se pudo leer el stream de generacion.',
          });
          eventSource.close();
          subscriber.complete();
        }
      });

      eventSource.onerror = () => {
        subscriber.next({
          type: 'error',
          error: 'Se perdio la conexion con el stream.',
        });
        eventSource.close();
        subscriber.complete();
      };

      return () => eventSource.close();
    });
  }

  private getAccessToken(): string | null {
    try {
      const authState = localStorage.getItem('vendix_auth_state');
      if (!authState) return null;
      const parsed = JSON.parse(authState);
      return parsed.tokens?.access_token || null;
    } catch {
      return null;
    }
  }

  private withMappedStreamError(
    event: AdCreativeStreamEvent,
  ): AdCreativeStreamEvent {
    if (event.type !== 'error' || !event.error_code) return event;
    return {
      ...event,
      error: ERROR_MESSAGES[event.error_code] || event.error,
    };
  }

  private createRequestId(id: number): string {
    const randomId = globalThis.crypto?.randomUUID?.();
    if (randomId) return randomId;
    return `ad-creative-${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}
