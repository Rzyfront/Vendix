import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

export type ReminderStatus = 'pending' | 'done';
export type ReminderBucket = 'overdue' | 'today' | 'upcoming' | 'no_date' | 'done';
export type ReminderLinkType = 'product' | 'order' | 'customer' | 'supplier' | 'metric';

export interface ReminderLink {
  type: ReminderLinkType;
  id: number | null;
  label: string;
  url: string | null;
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
}

export interface UpdateReminderPayload {
  title?: string;
  note?: string | null;
  remind_at?: string | null;
  status?: ReminderStatus;
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

  list(status: ReminderListFilter): Observable<RemindersList> {
    return this.http
      .get<ApiEnvelope<RemindersList>>(this.baseUrl, { params: { status } })
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

  remove(id: number): Observable<void> {
    return this.http.delete<ApiEnvelope<unknown>>(`${this.baseUrl}/${id}`).pipe(map(() => undefined));
  }
}
