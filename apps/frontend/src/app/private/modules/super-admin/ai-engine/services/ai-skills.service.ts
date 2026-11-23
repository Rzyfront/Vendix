import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  AISkill,
  AISkillQueryDto,
  AISkillSearchResult,
  AISkillVersion,
  AISkillWriteDto,
} from '../interfaces';

/** Responses may arrive as the raw payload or wrapped in `{ data }`. */
function unwrap<T>(response: unknown): T {
  const body = response as { data?: unknown } | null;
  return (body && typeof body === 'object' && 'data' in body
    ? body.data
    : response) as T;
}

@Injectable({ providedIn: 'root' })
export class AISkillsService {
  private http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/superadmin/ai-engine/skills`;

  list(query: AISkillQueryDto = {}): Observable<AISkill[]> {
    let params = new HttpParams();
    if (query.module) params = params.set('module', query.module);
    if (query.status) params = params.set('status', query.status);
    return this.http
      .get<unknown>(this.baseUrl, { params })
      .pipe(map((r) => unwrap<AISkill[]>(r) ?? []));
  }

  get(id: number): Observable<AISkill> {
    return this.http
      .get<unknown>(`${this.baseUrl}/${id}`)
      .pipe(map((r) => unwrap<AISkill>(r)));
  }

  create(dto: AISkillWriteDto): Observable<AISkill> {
    return this.http
      .post<unknown>(this.baseUrl, dto)
      .pipe(map((r) => unwrap<AISkill>(r)));
  }

  update(id: number, dto: AISkillWriteDto): Observable<AISkill> {
    return this.http
      .patch<unknown>(`${this.baseUrl}/${id}`, dto)
      .pipe(map((r) => unwrap<AISkill>(r)));
  }

  publish(id: number): Observable<AISkill> {
    return this.http
      .post<unknown>(`${this.baseUrl}/${id}/publish`, {})
      .pipe(map((r) => unwrap<AISkill>(r)));
  }

  archive(id: number): Observable<AISkill> {
    return this.http
      .post<unknown>(`${this.baseUrl}/${id}/archive`, {})
      .pipe(map((r) => unwrap<AISkill>(r)));
  }

  versions(id: number): Observable<AISkillVersion[]> {
    return this.http
      .get<unknown>(`${this.baseUrl}/${id}/versions`)
      .pipe(map((r) => unwrap<AISkillVersion[]>(r) ?? []));
  }

  restore(id: number, version: number): Observable<AISkill> {
    return this.http
      .post<unknown>(`${this.baseUrl}/${id}/versions/${version}/restore`, {})
      .pipe(map((r) => unwrap<AISkill>(r)));
  }

  searchTest(query: string): Observable<AISkillSearchResult[]> {
    return this.http
      .post<unknown>(`${this.baseUrl}/search-test`, { query })
      .pipe(map((r) => unwrap<AISkillSearchResult[]>(r) ?? []));
  }
}
