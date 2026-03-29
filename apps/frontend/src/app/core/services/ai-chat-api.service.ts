import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface AIConversation {
  id: number;
  store_id: number;
  organization_id: number;
  user_id: number;
  title: string | null;
  summary: string | null;
  app_key: string | null;
  status: string;
  metadata: any;
  created_at: string;
  updated_at: string;
  messages?: AIMessage[];
}

export interface AIMessage {
  id: number;
  conversation_id: number;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls: any;
  tokens_used: number;
  cost_usd: number;
  metadata: any;
  created_at: string;
}

export interface SendMessageResponse {
  user_message: { role: string; content: string };
  assistant_message: {
    id: number;
    role: string;
    content: string;
    tokens_used: number;
  };
}

export interface PaginatedConversations {
  data: AIConversation[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

@Injectable({ providedIn: 'root' })
export class AIChatApiService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/store/ai-chat`;

  createConversation(data: {
    app_key?: string;
    title?: string;
  }): Observable<AIConversation> {
    return this.http
      .post<{ data: AIConversation }>(`${this.baseUrl}/conversations`, data)
      .pipe(map((res) => res.data));
  }

  getConversations(params?: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
  }): Observable<PaginatedConversations> {
    return this.http
      .get<{ data: PaginatedConversations }>(`${this.baseUrl}/conversations`, {
        params: params as any,
      })
      .pipe(map((res) => res.data));
  }

  getConversation(id: number): Observable<AIConversation> {
    return this.http
      .get<{ data: AIConversation }>(`${this.baseUrl}/conversations/${id}`)
      .pipe(map((res) => res.data));
  }

  sendMessage(
    conversationId: number,
    content: string,
  ): Observable<SendMessageResponse> {
    return this.http
      .post<{ data: SendMessageResponse }>(
        `${this.baseUrl}/conversations/${conversationId}/messages`,
        { content },
      )
      .pipe(map((res) => res.data));
  }

  archiveConversation(id: number): Observable<AIConversation> {
    return this.http
      .patch<{ data: AIConversation }>(
        `${this.baseUrl}/conversations/${id}/archive`,
        {},
      )
      .pipe(map((res) => res.data));
  }

  getStreamUrl(conversationId: number): string {
    const auth_state = localStorage.getItem('vendix_auth_state');
    if (!auth_state) {
      return '';
    }
    const token = JSON.parse(auth_state)?.tokens?.access_token;
    if (!token) {
      return '';
    }
    return `${this.baseUrl}/conversations/${conversationId}/stream?token=${token}`;
  }
}
