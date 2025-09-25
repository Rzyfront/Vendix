import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface Permission {
  id: number;
  name: string;
  description?: string;
  resource: string;
  action: string;
  created_at: string;
  updated_at: string;
}

export interface CreatePermissionDto {
  name: string;
  description?: string;
  resource: string;
  action: string;
}

export interface UpdatePermissionDto {
  name?: string;
  description?: string;
  resource?: string;
  action?: string;
}

export interface PermissionsListResponse {
  data: Permission[];
  meta?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface PermissionStatsResponse {
  totalPermissions: number;
  permissionsByResource: { [key: string]: number };
  permissionsByAction: { [key: string]: number };
  recentlyCreated: Permission[];
}

@Injectable({
  providedIn: 'root'
})
export class PermissionService {
  private readonly API_URL = `${environment.apiUrl}/api`;
  private readonly PERMISSIONS_URL = `${this.API_URL}/permissions`;

  constructor(private http: HttpClient) {}

  // Permission CRUD operations
  createPermission(permissionData: CreatePermissionDto): Observable<Permission> {
    return this.http.post<Permission>(this.PERMISSIONS_URL, permissionData);
  }

  getPermissions(params?: {
    page?: number;
    limit?: number;
    search?: string;
    resource?: string;
    action?: string;
  }): Observable<PermissionsListResponse> {
    let httpParams = new HttpParams();
    
    if (params) {
      Object.keys(params).forEach(key => {
        const value = params[key as keyof typeof params];
        if (value !== undefined && value !== null && value !== '') {
          httpParams = httpParams.set(key, value.toString());
        }
      });
    }

    return this.http.get<PermissionsListResponse>(this.PERMISSIONS_URL, { params: httpParams });
  }

  getPermission(permissionId: number): Observable<Permission> {
    return this.http.get<Permission>(`${this.PERMISSIONS_URL}/${permissionId}`);
  }

  updatePermission(permissionId: number, permissionData: UpdatePermissionDto): Observable<Permission> {
    return this.http.patch<Permission>(`${this.PERMISSIONS_URL}/${permissionId}`, permissionData);
  }

  deletePermission(permissionId: number): Observable<any> {
    return this.http.delete(`${this.PERMISSIONS_URL}/${permissionId}`);
  }

  // Permission statistics and analytics
  getPermissionStats(): Observable<PermissionStatsResponse> {
    return this.http.get<PermissionStatsResponse>(`${this.PERMISSIONS_URL}/stats`);
  }

  // Get permissions by resource
  getPermissionsByResource(resource: string): Observable<PermissionsListResponse> {
    return this.getPermissions({ resource });
  }

  // Get permissions by action
  getPermissionsByAction(action: string): Observable<PermissionsListResponse> {
    return this.getPermissions({ action });
  }

  // Search permissions
  searchPermissions(query: string): Observable<PermissionsListResponse> {
    return this.getPermissions({ search: query });
  }

  // Get unique resources
  getUniqueResources(): Observable<string[]> {
    return this.http.get<string[]>(`${this.PERMISSIONS_URL}/resources`);
  }

  // Get unique actions
  getUniqueActions(): Observable<string[]> {
    return this.http.get<string[]>(`${this.PERMISSIONS_URL}/actions`);
  }

  // Bulk operations
  bulkCreatePermissions(permissions: CreatePermissionDto[]): Observable<Permission[]> {
    return this.http.post<Permission[]>(`${this.PERMISSIONS_URL}/bulk`, { permissions });
  }

  bulkDeletePermissions(permissionIds: number[]): Observable<any> {
    return this.http.delete(`${this.PERMISSIONS_URL}/bulk`, { body: { permissionIds } });
  }

  // Permission validation
  validatePermissionName(name: string): Observable<{ isValid: boolean; message?: string }> {
    return this.http.post<{ isValid: boolean; message?: string }>(`${this.PERMISSIONS_URL}/validate-name`, { name });
  }

  // Get permissions that are not assigned to any role
  getUnassignedPermissions(): Observable<PermissionsListResponse> {
    return this.http.get<PermissionsListResponse>(`${this.PERMISSIONS_URL}/unassigned`);
  }

  // Get permissions assigned to a specific role
  getPermissionsByRole(roleId: number): Observable<PermissionsListResponse> {
    return this.http.get<PermissionsListResponse>(`${this.PERMISSIONS_URL}/role/${roleId}`);
  }

  // Export permissions
  exportPermissions(format: 'json' | 'csv' = 'json'): Observable<Blob> {
    return this.http.get(`${this.PERMISSIONS_URL}/export`, {
      params: { format },
      responseType: 'blob'
    });
  }

  // Import permissions
  importPermissions(file: File): Observable<{ imported: number; errors: string[] }> {
    const formData = new FormData();
    formData.append('file', file);
    
    return this.http.post<{ imported: number; errors: string[] }>(`${this.PERMISSIONS_URL}/import`, formData);
  }

  // Permission templates for common resources
  getPermissionTemplates(): Observable<{ [resource: string]: CreatePermissionDto[] }> {
    return this.http.get<{ [resource: string]: CreatePermissionDto[] }>(`${this.PERMISSIONS_URL}/templates`);
  }

  // Create permissions from template
  createFromTemplate(resource: string, actions: string[]): Observable<Permission[]> {
    return this.http.post<Permission[]>(`${this.PERMISSIONS_URL}/from-template`, { resource, actions });
  }
}