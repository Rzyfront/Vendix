import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../../../../../environments/environment';

export type HistoryAgentFilter = 'all' | 'vex' | 'vexi';

export interface HistoryChangeEvent {
  id: string;
  kind: 'switch' | 'agent_action' | 'conversation_purged' | 'memory_edit';
  agent_key: 'vex' | 'vexi' | null;
  actor: { user_id: number; name: string } | null;
  summary: string;
  created_at: string;
}

export interface HistoryConversation {
  id: number;
  agent_key: 'vex' | 'vexi';
  user: { id: number; name: string } | null;
  title: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
  is_own: boolean;
}

export interface HistoryPage<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

interface PaginatedEnvelope<T> {
  data?: T[];
  meta?: { total?: number; page?: number; limit?: number };
}

/** Read-only client of `GET /store/ai-agents/history/*`. */
@Injectable({ providedIn: 'root' })
export class AgentHistoryApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/ai-agents/history`;

  changes(
    page: number,
    limit: number,
    agent: HistoryAgentFilter,
  ): Observable<HistoryPage<HistoryChangeEvent>> {
    return this.get<HistoryChangeEvent>('changes', page, limit, agent);
  }

  conversations(
    page: number,
    limit: number,
    agent: HistoryAgentFilter,
  ): Observable<HistoryPage<HistoryConversation>> {
    return this.get<HistoryConversation>('conversations', page, limit, agent);
  }

  private get<T>(
    path: string,
    page: number,
    limit: number,
    agent: HistoryAgentFilter,
  ): Observable<HistoryPage<T>> {
    let params = new HttpParams().set('page', page).set('limit', limit);
    if (agent !== 'all') params = params.set('agent', agent);
    return this.http
      .get<PaginatedEnvelope<T>>(`${this.base}/${path}`, { params })
      .pipe(
        map((res) => ({
          items: res?.data ?? [],
          total: res?.meta?.total ?? 0,
          page: res?.meta?.page ?? page,
          limit: res?.meta?.limit ?? limit,
        })),
      );
  }
}
