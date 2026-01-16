import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

import {
  Template,
  TemplateListItem,
  CreateTemplateDto,
  UpdateTemplateDto,
  TemplateQueryDto,
  TemplateStats,
} from '../interfaces/template.interface';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

// Re-export DTOs for convenience
export type { CreateTemplateDto, UpdateTemplateDto, TemplateQueryDto, TemplateStats } from '../interfaces/template.interface';

@Injectable({
  providedIn: 'root',
})
export class TemplatesService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getTemplates(
    query?: TemplateQueryDto,
  ): Observable<PaginatedResponse<TemplateListItem>> {
    let params = new HttpParams();

    if (query?.page) params = params.set('page', query.page.toString());
    if (query?.limit) params = params.set('limit', query.limit.toString());
    if (query?.search) params = params.set('search', query.search);
    if (query?.configuration_type)
      params = params.set('configuration_type', query.configuration_type);
    if (query?.is_active !== undefined)
      params = params.set('is_active', query.is_active.toString());
    if (query?.is_system !== undefined)
      params = params.set('is_system', query.is_system.toString());
    if (query?.sort_by) params = params.set('sort_by', query.sort_by);
    if (query?.sort_order)
      params = params.set('sort_order', query.sort_order);

    return this.http.get<PaginatedResponse<TemplateListItem>>(
      `${this.apiUrl}/superadmin/templates`,
      { params },
    );
  }

  getTemplateById(id: number): Observable<ApiResponse<Template>> {
    return this.http.get<ApiResponse<Template>>(
      `${this.apiUrl}/superadmin/templates/${id}`,
    );
  }

  createTemplate(
    data: CreateTemplateDto,
  ): Observable<ApiResponse<Template>> {
    return this.http.post<ApiResponse<Template>>(
      `${this.apiUrl}/superadmin/templates`,
      data,
    );
  }

  updateTemplate(
    id: number,
    data: UpdateTemplateDto,
  ): Observable<ApiResponse<Template>> {
    return this.http.patch<ApiResponse<Template>>(
      `${this.apiUrl}/superadmin/templates/${id}`,
      data,
    );
  }

  deleteTemplate(id: number): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(
      `${this.apiUrl}/superadmin/templates/${id}`,
    );
  }

  getTemplateStats(): Observable<ApiResponse<TemplateStats>> {
    return this.http.get<ApiResponse<TemplateStats>>(
      `${this.apiUrl}/superadmin/templates/dashboard`,
    );
  }
}
