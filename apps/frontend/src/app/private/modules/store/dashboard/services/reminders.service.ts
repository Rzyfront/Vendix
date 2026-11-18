import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

export type ReminderStatus = 'pending' | 'done';
export type ReminderBucket = 'overdue' | 'today' | 'upcoming' | 'no_date' | 'done';
export type ReminderLinkType =
  | 'product'
  | 'order'
  | 'customer'
  | 'supplier'
  | 'purchase_order'
  | 'quotation'
  | 'invoice'
  | 'metric';

export interface ReminderLink {
  type: ReminderLinkType;
  /** Spanish name of the record type, e.g. "Producto". */
  type_label: string;
  id: number | null;
  label: string;
  /** False when the record was deleted or the user may not read its module. */
  available: boolean;
  /** Admin route; null when not available. */
  url: string | null;
}

/** A record the user may link, as `GET /store/reminders/link-search` returns it. */
export interface ReminderLinkOption {
  type: ReminderLinkType;
  type_label: string;
  id: number;
  label: string;
  url: string;
}

export interface Reminder {
  id: number;
  title: string;
  note: string | null;
  /** ISO instant (UTC). */
  remind_at: string | null;
  status: ReminderStatus;
  bucket: ReminderBucket;
  link: ReminderLink | null;
  source: 'manual' | 'vex';
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RemindersList {
  items: Reminder[];
  timezone: string;
}

export type ReminderListFilter = 'pending' | 'done' | 'all';

export interface CreateReminderPayload {
  title: string;
  note?: string | null;
  /** Store-local wall clock `YYYY-MM-DDTHH:mm`, no timezone. */
  remind_at?: string | null;
  /** The server checks the record exists in the store and the user may read it. */
  link_type?: ReminderLinkType | null;
  link_id?: number | null;
}

export interface UpdateReminderPayload {
  title?: string;
  note?: string | null;
  remind_at?: string | null;
  status?: ReminderStatus;
  /** Omitted: the link stays as is. `null`: the link is removed. */
  link_type?: ReminderLinkType | null;
  link_id?: number | null;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class RemindersService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/reminders`;

  /** `limit` is optional (server default 100, max 200). */
  list(status: ReminderListFilter, limit?: number): Observable<RemindersList> {
    const params: Record<string, string> = { status };
    if (limit !== undefined) params['limit'] = String(limit);
    return this.http
      .get<ApiEnvelope<RemindersList>>(this.baseUrl, { params })
      .pipe(map((res) => res.data));
  }

  create(payload: CreateReminderPayload): Observable<Reminder> {
    return this.http
      .post<ApiEnvelope<Reminder>>(this.baseUrl, payload)
      .pipe(map((res) => res.data));
  }

  update(id: number, payload: UpdateReminderPayload): Observable<Reminder> {
    return this.http
      .patch<ApiEnvelope<Reminder>>(`${this.baseUrl}/${id}`, payload)
      .pipe(map((res) => res.data));
  }

  /** Records of the current store the user may open, matching `q` (2+ characters). */
  searchLinks(q: string): Observable<ReminderLinkOption[]> {
    return this.http
      .get<ApiEnvelope<ReminderLinkOption[]>>(`${this.baseUrl}/link-search`, { params: { q } })
      .pipe(map((res) => res.data));
  }

  remove(id: number): Observable<void> {
    return this.http.delete<ApiEnvelope<unknown>>(`${this.baseUrl}/${id}`).pipe(map(() => undefined));
  }
}
