import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { HousekeepingStatus } from '../../rooms/interfaces/unit.interface';
import {
  HousekeepingBoard,
  HousekeepingTask,
  HousekeepingTasksDay,
} from '../interfaces/housekeeping.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/** Hospitality Suite (H5.1/H5.2) — `/store/hospitality/housekeeping` client. */
@Injectable({ providedIn: 'root' })
export class LodgingHousekeepingService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/hospitality/housekeeping`;

  board(): Observable<HousekeepingBoard> {
    return this.http
      .get<ApiResponse<HousekeepingBoard>>(this.baseUrl)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** `from` is the status shown on the board: a stale board gets a 409. */
  changeStatus(
    unitId: number,
    from: HousekeepingStatus,
    status: HousekeepingStatus,
  ): Observable<{ id: number; code: string; housekeeping_status: HousekeepingStatus }> {
    return this.http
      .patch<
        ApiResponse<{ id: number; code: string; housekeeping_status: HousekeepingStatus }>
      >(`${this.baseUrl}/units/${unitId}/status`, { from, status })
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** H5.2 — every task of today, with the housekeepers to assign them. */
  tasks(): Observable<HousekeepingTasksDay> {
    return this.http
      .get<ApiResponse<HousekeepingTasksDay>>(`${this.baseUrl}/tasks`)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** H5.2 — only the current user's tasks of today. */
  myTasks(): Observable<HousekeepingTasksDay> {
    return this.http
      .get<ApiResponse<HousekeepingTasksDay>>(`${this.baseUrl}/my-tasks`)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  assignTask(taskId: number, assignedUserId: number | null): Observable<HousekeepingTask> {
    return this.http
      .patch<ApiResponse<HousekeepingTask>>(`${this.baseUrl}/tasks/${taskId}/assign`, {
        assigned_user_id: assignedUserId,
      })
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  completeTask(taskId: number): Observable<HousekeepingTask> {
    return this.http
      .post<ApiResponse<HousekeepingTask>>(`${this.baseUrl}/tasks/${taskId}/complete`, {})
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** Rejects with the user-facing message so screens can toast it as-is. */
  private handleError(error: unknown): Observable<never> {
    return throwError(() => parseApiError(error).userMessage);
  }
}
