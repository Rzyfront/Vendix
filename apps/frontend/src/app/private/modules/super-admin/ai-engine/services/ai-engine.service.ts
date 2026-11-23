import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import { withUserActionTimeout } from '../../../../../core/utils/backend-availability.util';
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
  AIToolCatalogEntry,
  AIQueuesOverview,
  AIJobLookupResult,
  AIAgent,
  CreateAIAgentDto,
  UpdateAIAgentDto,
  AIAgentQueryDto,
  PaginatedAIAgentResponse,
  AIAppHealthQuery,
  AIAppHealthReport,
} from '../interfaces';
import {
  AgentRuntimeSheet,
  AgentVoicePreview,
  UpdateAgentRuntimeDto,
} from '../interfaces/agent-runtime.interface';

interface CacheEntry<T> {
  observable: T;
  lastFetch: number;
}

let statsCache: CacheEntry<Observable<any>> | null = null;

/**
 * Las pruebas llaman al proveedor de IA (el backend corta a los 90 s); el
 * cliente espera un poco más para recibir ese error controlado antes de
 * rendirse. Un guardado/prueba colgado termina en toast, nunca en el gato.
 */
export const AI_TEST_ACTION_TIMEOUT_MS = 120_000;

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
    if (query.model_type) params = params.set('model_type', query.model_type);
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
    return this.http
      .post<any>(`${this.apiUrl}/superadmin/ai-engine`, data)
      .pipe(withUserActionTimeout());
  }

  updateConfig(
    id: number,
    data: UpdateAIConfigDto,
  ): Observable<AIEngineConfig> {
    return this.http
      .patch<any>(`${this.apiUrl}/superadmin/ai-engine/${id}`, data)
      .pipe(withUserActionTimeout());
  }

  deleteConfig(id: number): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/superadmin/ai-engine/${id}`,
    );
  }

  testConnection(
    id: number,
  ): Observable<{ success: boolean; message: string }> {
    return this.http
      .post<any>(`${this.apiUrl}/superadmin/ai-engine/${id}/test`, {})
      .pipe(withUserActionTimeout(AI_TEST_ACTION_TIMEOUT_MS));
  }

  // --- AI Applications ---

  getApps(query: AIAppQueryDto = {}): Observable<PaginatedAIAppResponse> {
    let params = new HttpParams();
    if (query.page) params = params.set('page', query.page.toString());
    if (query.limit) params = params.set('limit', query.limit.toString());
    if (query.search) params = params.set('search', query.search);
    if (query.output_format)
      params = params.set('output_format', query.output_format);
    if (query.model_type) params = params.set('model_type', query.model_type);
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
    return this.http
      .post<any>(`${this.apiUrl}/superadmin/ai-engine/applications`, data)
      .pipe(withUserActionTimeout());
  }

  updateApp(id: number, data: UpdateAIAppDto): Observable<AIEngineApp> {
    return this.http
      .patch<any>(
        `${this.apiUrl}/superadmin/ai-engine/applications/${id}`,
        data,
      )
      .pipe(withUserActionTimeout());
  }

  deleteApp(id: number): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/superadmin/ai-engine/applications/${id}`,
    );
  }

  testApp(
    id: number,
  ): Observable<{ success: boolean; content?: string; error?: string }> {
    return this.http
      .post<any>(
        `${this.apiUrl}/superadmin/ai-engine/applications/${id}/test`,
        {},
      )
      .pipe(withUserActionTimeout(AI_TEST_ACTION_TIMEOUT_MS));
  }

  // --- AI Tools (F5: catálogo vivo, sin paginación) ---

  getTools(): Observable<AIToolCatalogEntry[]> {
    return this.http.get<any>(`${this.apiUrl}/superadmin/ai-engine/tools`);
  }

  // --- AI Queues / Jobs (F5) ---

  getQueues(): Observable<AIQueuesOverview> {
    return this.http.get<any>(`${this.apiUrl}/superadmin/ai-engine/jobs`);
  }

  getJob(queueName: string, jobId: string): Observable<AIJobLookupResult> {
    return this.http.get<any>(
      `${this.apiUrl}/superadmin/ai-engine/jobs/${queueName}/${jobId}`,
    );
  }

  // --- Salud por app (ia-cargas F6): solo lectura ---

  getAppHealth(query: AIAppHealthQuery = {}): Observable<AIAppHealthReport> {
    let params = new HttpParams();
    if (query.date_from) params = params.set('date_from', query.date_from);
    if (query.date_to) params = params.set('date_to', query.date_to);
    return this.http
      .get<
        { data?: AIAppHealthReport } | AIAppHealthReport
      >(`${this.apiUrl}/superadmin/ai-engine/app-health`, { params })
      .pipe(
        map((response) =>
          'apps' in response
            ? response
            : (response.data ?? { date_from: '', date_to: '', apps: [] }),
        ),
      );
  }

  // --- AI Agents (F5: CRUD del endpoint F4) ---

  getAgents(query: AIAgentQueryDto = {}): Observable<PaginatedAIAgentResponse> {
    let params = new HttpParams();
    if (query.page) params = params.set('page', query.page.toString());
    if (query.limit) params = params.set('limit', query.limit.toString());
    if (query.search) params = params.set('search', query.search);
    if (query.app_key) params = params.set('app_key', query.app_key);
    if (query.is_active !== undefined)
      params = params.set('is_active', query.is_active.toString());

    return this.http.get<any>(
      `${this.apiUrl}/superadmin/ai-engine/agents`,
      { params },
    );
  }

  createAgent(data: CreateAIAgentDto): Observable<AIAgent> {
    return this.http.post<any>(
      `${this.apiUrl}/superadmin/ai-engine/agents`,
      data,
    );
  }

  updateAgent(id: number, data: UpdateAIAgentDto): Observable<AIAgent> {
    return this.http.patch<any>(
      `${this.apiUrl}/superadmin/ai-engine/agents/${id}`,
      data,
    );
  }

  deleteAgent(id: number): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/superadmin/ai-engine/agents/${id}`,
    );
  }

  // --- Ficha única del agente (Vex / Vexi): modelo, proveedor y voz ---

  getAgentSheet(agentKey: string): Observable<AgentRuntimeSheet> {
    return this.http
      .get<{ data: AgentRuntimeSheet }>(
        `${this.apiUrl}/superadmin/ai-engine/agent-runtime/${agentKey}`,
      )
      .pipe(map((r) => r.data));
  }

  updateAgentSheet(
    agentKey: string,
    data: UpdateAgentRuntimeDto,
  ): Observable<AgentRuntimeSheet> {
    return this.http
      .patch<{ data: AgentRuntimeSheet }>(
        `${this.apiUrl}/superadmin/ai-engine/agent-runtime/${agentKey}`,
        data,
      )
      .pipe(map((r) => r.data));
  }

  previewAgentVoice(
    agentKey: string,
    text?: string,
  ): Observable<AgentVoicePreview> {
    return this.http
      .post<{ data: AgentVoicePreview }>(
        `${this.apiUrl}/superadmin/ai-engine/agent-runtime/${agentKey}/voice-preview`,
        text ? { text } : {},
      )
      .pipe(map((r) => r.data));
  }

  invalidateCache(): void {
    statsCache = null;
  }
}
