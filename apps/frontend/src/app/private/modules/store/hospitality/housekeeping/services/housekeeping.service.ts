import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import { hospitalityErrorMessage } from '../../shared/hospitality-errors';
import { HousekeepingStatus } from '../../rooms/interfaces/unit.interface';
import {
  HousekeepingBoard,
  HousekeepingTask,
  HousekeepingTaskError,
  HousekeepingTaskField,
  HousekeepingTaskPayload,
  HousekeepingTasksDay,
} from '../interfaces/housekeeping.interface';

/** API refusals of a new task and the form field each one belongs to. */
const TASK_ERROR_FIELDS: Record<string, HousekeepingTaskField> = {
  LODGING_HOUSEKEEPING_TASK_DUP_001: 'type',
  LODGING_HOUSEKEEPING_TASK_DATE_001: 'task_date',
  LODGING_UNIT_FIND_001: 'unit_id',
  LODGING_HOUSEKEEPING_TASK_ASSIGNEE_001: 'assigned_user_id',
};

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

  /** U12 — rejects with the message and the form field it belongs to. */
  createTask(payload: HousekeepingTaskPayload): Observable<HousekeepingTask> {
    return this.http.post<ApiResponse<HousekeepingTask>>(`${this.baseUrl}/tasks`, payload).pipe(
      map((res) => res.data),
      catchError((error: unknown) => {
        const code =
          error instanceof HttpErrorResponse ? (error.error?.error_code as string | undefined) : undefined;
        return throwError(
          (): HousekeepingTaskError => ({
            message: hospitalityErrorMessage(error),
            field: (code && TASK_ERROR_FIELDS[code]) || null,
          }),
        );
      }),
    );
  }

  completeTask(taskId: number): Observable<HousekeepingTask> {
    return this.http
      .post<ApiResponse<HousekeepingTask>>(`${this.baseUrl}/tasks/${taskId}/complete`, {})
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** Rejects with the user-facing message so screens can toast it as-is. */
  private handleError(error: unknown): Observable<never> {
    return throwError((): string => hospitalityErrorMessage(error));
  }
}
