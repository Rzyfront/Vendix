import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import {
  AddMenuSectionItemDto,
  AvailabilityWindow,
  CreateAvailabilityWindowDto,
  CreateMenuDto,
  CreateMenuSectionDto,
  Menu,
  MenuFull,
  MenuQuery,
  MenuSection,
  MenuStats,
  MenuEngineeringReport,
  UpdateAvailabilityWindowDto,
  UpdateMenuDto,
  UpdateMenuSectionDto,
} from '../interfaces';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

interface PaginatedApiResponse<T> {
  success: boolean;
  data: T[];
  message?: string;
  meta: {
    pagination: {
      total: number;
      page: number;
      limit: number;
      pages?: number;
    };
  };
}

@Injectable({ providedIn: 'root' })
export class MenusService {
  private readonly apiUrl = environment.apiUrl;
  private readonly basePath = '/store/menus';
  private http = inject(HttpClient);

  // ----------------------------- Menu CRUD -------------------------------

  listPaginated(query: MenuQuery = {}): Observable<PaginatedApiResponse<Menu>> {
    let params = new HttpParams();
    if (query.page != null) params = params.set('page', String(query.page));
    if (query.limit != null) params = params.set('limit', String(query.limit));
    if (query.search) params = params.set('search', query.search);
    if (query.is_active != null) {
      params = params.set('is_active', String(query.is_active));
    }
    return this.http
      .get<PaginatedApiResponse<Menu>>(`${this.apiUrl}${this.basePath}`, { params })
      .pipe(catchError(this.handleError));
  }

  getStats(): Observable<MenuStats> {
    return this.http
      .get<ApiResponse<MenuStats>>(
        `${this.apiUrl}${this.basePath}/stats`,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  getFull(id: number): Observable<MenuFull> {
    return this.http
      .get<ApiResponse<MenuFull>>(`${this.apiUrl}${this.basePath}/${id}/full`)
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  create(dto: CreateMenuDto): Observable<Menu> {
    return this.http
      .post<ApiResponse<Menu>>(`${this.apiUrl}${this.basePath}`, dto)
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  update(id: number, dto: UpdateMenuDto): Observable<Menu> {
    return this.http
      .patch<ApiResponse<Menu>>(
        `${this.apiUrl}${this.basePath}/${id}`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  remove(id: number): Observable<void> {
    return this.http
      .delete<void>(`${this.apiUrl}${this.basePath}/${id}`)
      .pipe(catchError(this.handleError));
  }

  // -------------------------- Sections ------------------------------------

  listSections(menuId: number): Observable<MenuSection[]> {
    return this.http
      .get<ApiResponse<MenuSection[]>>(
        `${this.apiUrl}${this.basePath}/${menuId}/sections`,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  createSection(
    menuId: number,
    dto: CreateMenuSectionDto,
  ): Observable<MenuSection> {
    return this.http
      .post<ApiResponse<MenuSection>>(
        `${this.apiUrl}${this.basePath}/${menuId}/sections`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  updateSection(
    menuId: number,
    sectionId: number,
    dto: UpdateMenuSectionDto,
  ): Observable<MenuSection> {
    return this.http
      .patch<ApiResponse<MenuSection>>(
        `${this.apiUrl}${this.basePath}/${menuId}/sections/${sectionId}`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  removeSection(menuId: number, sectionId: number): Observable<void> {
    return this.http
      .delete<void>(
        `${this.apiUrl}${this.basePath}/${menuId}/sections/${sectionId}`,
      )
      .pipe(catchError(this.handleError));
  }

  sortSections(
    menuId: number,
    sectionIds: number[],
  ): Observable<{ updated: number }> {
    return this.http
      .patch<ApiResponse<{ updated: number }>>(
        `${this.apiUrl}${this.basePath}/${menuId}/sections/sort`,
        { section_ids: sectionIds },
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  // -------------------------- Section items ------------------------------

  addItem(
    menuId: number,
    sectionId: number,
    dto: AddMenuSectionItemDto,
  ): Observable<any> {
    return this.http
      .post<ApiResponse<any>>(
        `${this.apiUrl}${this.basePath}/${menuId}/sections/${sectionId}/items`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  removeItem(
    menuId: number,
    sectionId: number,
    itemId: number,
  ): Observable<void> {
    return this.http
      .delete<void>(
        `${this.apiUrl}${this.basePath}/${menuId}/sections/${sectionId}/items/${itemId}`,
      )
      .pipe(catchError(this.handleError));
  }

  sortItems(
    menuId: number,
    sectionId: number,
    itemIds: number[],
  ): Observable<{ updated: number }> {
    return this.http
      .patch<ApiResponse<{ updated: number }>>(
        `${this.apiUrl}${this.basePath}/${menuId}/sections/${sectionId}/items/sort`,
        { item_ids: itemIds },
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  // -------------------------- Availability windows ------------------------

  listAvailability(menuId: number): Observable<AvailabilityWindow[]> {
    return this.http
      .get<ApiResponse<AvailabilityWindow[]>>(
        `${this.apiUrl}${this.basePath}/${menuId}/availability-windows`,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  createAvailability(
    menuId: number,
    dto: CreateAvailabilityWindowDto,
  ): Observable<AvailabilityWindow> {
    return this.http
      .post<ApiResponse<AvailabilityWindow>>(
        `${this.apiUrl}${this.basePath}/${menuId}/availability-windows`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  updateAvailability(
    menuId: number,
    id: number,
    dto: UpdateAvailabilityWindowDto,
  ): Observable<AvailabilityWindow> {
    return this.http
      .patch<ApiResponse<AvailabilityWindow>>(
        `${this.apiUrl}${this.basePath}/${menuId}/availability-windows/${id}`,
        dto,
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  removeAvailability(menuId: number, id: number): Observable<void> {
    return this.http
      .delete<void>(
        `${this.apiUrl}${this.basePath}/${menuId}/availability-windows/${id}`,
      )
      .pipe(catchError(this.handleError));
  }

  // -------------------------- Engineering ---------------------------------

  engineeringReport(params: {
    from?: string;
    to?: string;
  } = {}): Observable<MenuEngineeringReport> {
    let p = new HttpParams();
    if (params.from) p = p.set('from', params.from);
    if (params.to) p = p.set('to', params.to);
    return this.http
      .get<ApiResponse<MenuEngineeringReport>>(
        `${this.apiUrl}${this.basePath}/engineering-report`,
        { params: p },
      )
      .pipe(
        map((res) => res.data),
        catchError(this.handleError),
      );
  }

  // -------------------------- Error mapping -------------------------------

  private handleError = (error: any): Observable<never> => {
    // eslint-disable-next-line no-console
    console.error('MenusService Error:', error);
    let message = 'Error al procesar la solicitud';
    const apiMessage = error?.error?.message;
    if (apiMessage) {
      message =
        typeof apiMessage === 'string'
          ? apiMessage
          : Array.isArray(apiMessage)
            ? apiMessage.join(', ')
            : message;
    } else if (error?.status === 401) message = 'No autorizado';
    else if (error?.status === 403) message = 'No tienes permisos suficientes';
    else if (error?.status === 404) message = 'Menú no encontrado';
    else if (error?.status === 409) message =
      typeof error?.error?.message === 'string'
        ? error.error.message
        : 'Conflicto: ya existe un registro relacionado';
    else if (error?.status === 422) message =
      typeof error?.error?.message === 'string'
        ? error.error.message
        : 'Operación no permitida';
    else if (typeof error?.status === 'number' && error.status >= 500)
      message = 'Error del servidor. Inténtalo más tarde';
    return throwError(() => message);
  };
}
