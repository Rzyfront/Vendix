import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  BoardAllData,
  BoardAllQuery,
  BoardFilterOption,
  BoardFilters,
} from '../interfaces/workflow-board.interfaces';

interface DataResponse<T> {
  data: T;
}

/** Client of the general board (`/store/workflows/board`) and its filter lists. */
@Injectable({ providedIn: 'root' })
export class WorkflowBoardApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/workflows/board`;

  getBoard(query: BoardAllQuery = {}): Observable<BoardAllData> {
    return this.http
      .get<DataResponse<BoardAllData>>(this.base, { params: this.params(query) })
      .pipe(map((res) => res.data));
  }

  getFilters(): Observable<BoardFilters> {
    return this.http
      .get<DataResponse<BoardFilters>>(`${this.base}/filters`)
      .pipe(map((res) => res.data));
  }

  /** Branches of the store, for the "Sede" select of the start dialog. */
  listLocations(): Observable<BoardFilterOption[]> {
    return this.http
      .get<DataResponse<BoardFilterOption[]>>(`${this.base}/locations`)
      .pipe(map((res) => res.data));
  }

  private params(query: object): HttpParams {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      params = params.set(key, String(value));
    }
    return params;
  }
}
