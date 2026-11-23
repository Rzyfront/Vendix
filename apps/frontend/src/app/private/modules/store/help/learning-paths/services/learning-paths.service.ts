import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import {
  LearningPathDetail,
  LearningPathSummary,
  LearningProgressPayload,
} from '../models/learning-path.model';

@Injectable({ providedIn: 'root' })
export class LearningPathsService {
  private readonly api_url = `${environment.apiUrl}/store/help`;
  private http = inject(HttpClient);

  list(): Observable<LearningPathSummary[]> {
    return this.http.get<LearningPathSummary[]>(`${this.api_url}/learning-paths`);
  }

  get(id: number): Observable<LearningPathDetail> {
    return this.http.get<LearningPathDetail>(`${this.api_url}/learning-paths/${id}`);
  }

  saveProgress(payload: LearningProgressPayload): Observable<unknown> {
    return this.http.post(`${this.api_url}/learning-progress`, payload);
  }
}
