import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  AIEngineConfig,
  CreateAIConfigDto,
  UpdateAIConfigDto,
  AIConfigQueryDto,
  AIEngineStats,
  PaginatedAIConfigResponse,
  AIEngineApp,
  CreateAIAppDto,
  UpdateAIAppDto,
  AIAppQueryDto,
  AIAppStats,
  PaginatedAIAppResponse,
} from '../interfaces';

interface CacheEntry<T> {
  observable: T;
  lastFetch: number;
}

let statsCache: CacheEntry<Observable<any>> | null = null;

@Injectable({
  providedIn: 'root',
})
export class AIEngineService {
  private http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;
  private readonly CACHE_TTL = 30000;

  getConfigs(
    query: AIConfigQueryDto = {},
  ): Observable<PaginatedAIConfigResponse> {
    let params = new HttpParams();
    if (query.page) params = params.set('page', query.page.toString());
    if (query.limit) params = params.set('limit', query.limit.toString());
    if (query.search) params = params.set('search', query.search);
    if (query.sdk_type) params = params.set('sdk_type', query.sdk_type);
    if (query.is_active !== undefined)
      params = params.set('is_active', query.is_active.toString());

    return this.http.get<any>(`${this.apiUrl}/superadmin/ai-engine`, {
      params,
    });
  }

  getStats(): Observable<AIEngineStats> {
    const now = Date.now();

    if (statsCache && now - statsCache.lastFetch < this.CACHE_TTL) {
      return statsCache.observable;
    }

    const observable$ = this.http
      .get<any>(`${this.apiUrl}/superadmin/ai-engine/dashboard`)
      .pipe(
        shareReplay({ bufferSize: 1, refCount: false }),
        tap(() => {
          if (statsCache) {
            statsCache.lastFetch = Date.now();
          }
        }),
      );

    statsCache = {
      observable: observable$,
      lastFetch: now,
    };

    return observable$;
  }

  createConfig(data: CreateAIConfigDto): Observable<AIEngineConfig> {
    return this.http.post<any>(`${this.apiUrl}/superadmin/ai-engine`, data);
  }

  updateConfig(
    id: number,
    data: UpdateAIConfigDto,
  ): Observable<AIEngineConfig> {
    return this.http.patch<any>(
      `${this.apiUrl}/superadmin/ai-engine/${id}`,
      data,
    );
  }

  deleteConfig(id: number): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/superadmin/ai-engine/${id}`,
    );
  }

  testConnection(
    id: number,
  ): Observable<{ success: boolean; message: string }> {
    return this.http.post<any>(
      `${this.apiUrl}/superadmin/ai-engine/${id}/test`,
      {},
    );
  }

  // --- AI Applications ---

  getApps(query: AIAppQueryDto = {}): Observable<PaginatedAIAppResponse> {
    let params = new HttpParams();
    if (query.page) params = params.set('page', query.page.toString());
    if (query.limit) params = params.set('limit', query.limit.toString());
    if (query.search) params = params.set('search', query.search);
    if (query.output_format)
      params = params.set('output_format', query.output_format);
    if (query.is_active !== undefined)
      params = params.set('is_active', query.is_active.toString());

    return this.http.get<any>(
      `${this.apiUrl}/superadmin/ai-engine/applications`,
      { params },
    );
  }

  getAppStats(): Observable<AIAppStats> {
    return this.http.get<any>(
      `${this.apiUrl}/superadmin/ai-engine/applications/dashboard`,
    );
  }

  createApp(data: CreateAIAppDto): Observable<AIEngineApp> {
    return this.http.post<any>(
      `${this.apiUrl}/superadmin/ai-engine/applications`,
      data,
    );
  }

  updateApp(id: number, data: UpdateAIAppDto): Observable<AIEngineApp> {
    return this.http.patch<any>(
      `${this.apiUrl}/superadmin/ai-engine/applications/${id}`,
      data,
    );
  }

  deleteApp(id: number): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/superadmin/ai-engine/applications/${id}`,
    );
  }

  testApp(
    id: number,
  ): Observable<{ success: boolean; content?: string; error?: string }> {
    return this.http.post<any>(
      `${this.apiUrl}/superadmin/ai-engine/applications/${id}/test`,
      {},
    );
  }

  invalidateCache(): void {
    statsCache = null;
  }
}
