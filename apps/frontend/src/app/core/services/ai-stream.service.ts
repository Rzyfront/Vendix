import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface AIStreamEvent {
  type: 'text' | 'done' | 'error';
  content?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class AIStreamService {
  private readonly apiUrl = environment.apiUrl;

  streamRun(
    appKey: string,
    variables?: Record<string, string>,
    token?: string,
  ): Observable<AIStreamEvent> {
    return new Observable<AIStreamEvent>((subscriber) => {
      const params = new URLSearchParams();
      if (token) params.set('token', token);
      if (variables) {
        Object.entries(variables).forEach(([key, value]) => {
          if (value) params.set(key, value);
        });
      }

      const url = `${this.apiUrl}/store/ai/stream/${appKey}?${params.toString()}`;
      const eventSource = new EventSource(url);

      eventSource.addEventListener('ai-chunk', (event: MessageEvent) => {
        try {
          const data: AIStreamEvent = JSON.parse(event.data);
          subscriber.next(data);

          if (data.type === 'done' || data.type === 'error') {
            eventSource.close();
            subscriber.complete();
          }
        } catch {
          subscriber.next({ type: 'error', error: 'Failed to parse stream data' });
          eventSource.close();
          subscriber.complete();
        }
      });

      eventSource.onerror = () => {
        subscriber.next({ type: 'error', error: 'Stream connection lost' });
        eventSource.close();
        subscriber.complete();
      };

      // Cleanup on unsubscribe
      return () => {
        eventSource.close();
      };
    });
  }
}
