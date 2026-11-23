import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../../../../../environments/environment';
import {
  CreateStoreMemoryPayload,
  StoreMemoryItem,
  StoreMemoryList,
} from './store-memory.interface';

/** Backend responses may arrive wrapped as `{ success, data }`. */
function unwrap<T>(response: unknown): T {
  const body = response as { data?: T } | null;
  return (body && body.data !== undefined ? body.data : response) as T;
}

/**
 * REST client for the store memory of Vex (`/store/ai-agents/memory`).
 * Owner/admin only; limits and secret-content rules are enforced server-side.
 */
@Injectable({ providedIn: 'root' })
export class StoreMemoryService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/ai-agents/memory`;

  list(): Observable<StoreMemoryList> {
    return this.http.get<unknown>(this.baseUrl).pipe(map(unwrap<StoreMemoryList>));
  }

  create(payload: CreateStoreMemoryPayload): Observable<StoreMemoryItem> {
    return this.http
      .post<unknown>(this.baseUrl, payload)
      .pipe(map(unwrap<StoreMemoryItem>));
  }

  update(id: number, content: string): Observable<StoreMemoryItem> {
    return this.http
      .patch<unknown>(`${this.baseUrl}/${id}`, { content })
      .pipe(map(unwrap<StoreMemoryItem>));
  }

  remove(id: number): Observable<{ deleted: number }> {
    return this.http
      .delete<unknown>(`${this.baseUrl}/${id}`)
      .pipe(map(unwrap<{ deleted: number }>));
  }

  removeAll(): Observable<{ deleted: number }> {
    return this.http
      .delete<unknown>(this.baseUrl)
      .pipe(map(unwrap<{ deleted: number }>));
  }
}
